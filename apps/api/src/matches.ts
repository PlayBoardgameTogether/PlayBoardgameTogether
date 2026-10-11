import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DeterministicRng } from '@boardgame/game-sdk';
import { controllerCommandSchema, matchActionSchema } from '@boardgame/protocol';
import type { Database } from './db/index.js';
import type { GameRegistry } from './registry/index.js';
import { AppError } from './errors.js';

type MatchRow = {
  id: string;
  room_id: string;
  game_id: string;
  game_version: string;
  content_version: string;
  resource_pack_id: string;
  resource_pack_version: string;
  state_schema_version: string | null;
  rule_digest: string | null;
  resource_digest: string | null;
  asset_version_id: string | null;
  asset_manifest_hash: string | null;
  asset_contract_version: string | null;
  state: unknown;
  rng_state: unknown;
  revision: number;
  status: 'active' | 'finished' | 'aborted';
};
type ParticipantRow = {
  seat_id: string;
  seat_index: number;
  account_id?: string | null;
  occupant_kind?: 'human' | 'bot';
  controller_type: 'human' | 'script' | 'model';
  controller_epoch: number;
  controller_version: number;
  ai_status_version: number;
  ai_status: 'idle' | 'queued' | 'running' | 'submitting' | 'blocked';
  ai_error_code: string | null;
  policy_id: string | null;
  policy_version: string | null;
  policy_hash: string | null;
  model_profile_id?: string | null;
  model_owner_account_id?: string | null;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class MatchService {
  private listeners = new Set<
    (
      roomId: string,
      matchId: string,
      revision: number,
      events: unknown[],
      roomChanged?: boolean,
    ) => void
  >();
  constructor(
    private db: Database,
    private registry: GameRegistry,
    private testFaults?: { beforeCommit?: () => void; afterCommit?: () => void },
  ) {}

  onChanged(
    listener: (
      roomId: string,
      matchId: string,
      revision: number,
      events: unknown[],
      roomChanged?: boolean,
    ) => void,
  ) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Called under the room -> match locks, in the action's transaction.
  private async finishRoom(client: PoolClient, roomId: string, matchId: string) {
    const updated = await client.query(
      `
      UPDATE rooms SET status='waiting', active_match_id=NULL, room_revision=room_revision+1
      WHERE id=$1 AND status='in_game' AND active_match_id=$2`,
      [roomId, matchId],
    );
    if (!updated.rowCount) return false;
    await client.query("UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'", [
      roomId,
    ]);
    return true;
  }
  async notifyStatus(matchId: string) {
    const row = await this.db.query<{ room_id: string; revision: number }>(
      'SELECT room_id,revision FROM matches WHERE id=$1',
      [matchId],
    );
    if (row.rowCount)
      for (const listener of this.listeners)
        listener(row.rows[0]!.room_id, matchId, row.rows[0]!.revision, []);
  }

  private extension(row: MatchRow) {
    const extension = this.registry.get(row.game_id, row.game_version);
    if (
      !extension ||
      extension.manifest.contentVersion !== row.content_version ||
      (!row.asset_version_id &&
        (extension.manifest.defaultAssetPack.id !== row.resource_pack_id ||
          extension.manifest.defaultAssetPack.version !== row.resource_pack_version)) ||
      !this.registry.hasResourcePack(row.game_id, row.game_version)
    ) {
      throw new AppError('GAME_VERSION_UNAVAILABLE', 'Match game version is unavailable', 503);
    }
    const digest = this.registry.digest(row.game_id, row.game_version);
    if (
      (row.state_schema_version && row.state_schema_version !== '1') ||
      (row.rule_digest && row.rule_digest !== digest?.rule) ||
      (!row.asset_version_id && row.resource_digest && row.resource_digest !== digest?.resource)
    ) {
      throw new AppError('RECOVERY_BLOCKED', 'Match version differs from its saved version', 503);
    }
    return extension;
  }

  async replay(accountId: string, matchId: string, requestedRevision?: number) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const found = await client.query<MatchRow & { seat_id: string; seat_index: number }>(
        `
        SELECT m.*, p.seat_id, p.seat_index FROM matches m
        JOIN match_participants p ON p.match_id=m.id
        WHERE m.id=$1 AND p.account_id=$2`,
        [matchId, accountId],
      );
      if (!found.rowCount) throw new AppError('MATCH_NOT_FOUND', '对局不存在', 404);
      const match = found.rows[0]!;
      if (match.status === 'active')
        throw new AppError('ACTION_NOT_ALLOWED', '对局结束后可以查看回放', 422);
      const bounds = (
        await client.query<{ first: number; last: number }>(
          `
        SELECT min(revision) AS first, max(revision) AS last
        FROM match_replay_frames WHERE match_id=$1`,
          [matchId],
        )
      ).rows[0]!;
      if (bounds.first === null || bounds.last !== match.revision) {
        throw new AppError('RECOVERY_BLOCKED', '回放存档不完整', 503);
      }
      const revision = requestedRevision ?? bounds.first;
      const frame = (
        await client.query<{
          state: unknown;
          internal_events: unknown[];
          actor_seat_id: string | null;
          created_at: Date;
        }>('SELECT * FROM match_replay_frames WHERE match_id=$1 AND revision=$2', [
          matchId,
          revision,
        ])
      ).rows[0];
      if (!frame) throw new AppError('VALIDATION_ERROR', '该步骤没有回放存档', 400);
      const extension = this.extension(match);
      const viewer = { kind: 'seat' as const, seatId: match.seat_id };
      let view: unknown;
      let events: unknown[];
      try {
        view = extension.getView(extension.deserialize(frame.state), viewer);
        events = extension
          .projectEvents(frame.internal_events, viewer)
          .map((event: Record<string, unknown>, index: number) => ({
            ...event,
            eventId: `${matchId}:${revision}:${index}`,
          }));
      } catch {
        throw new AppError('RECOVERY_BLOCKED', '此游戏版本的回放无法恢复', 503);
      }
      const players = await client.query<{
        seat_id: string;
        seat_index: number;
        display_name: string | null;
        occupant_kind: 'human' | 'bot';
      }>(
        `
        SELECT p.seat_id,p.seat_index,p.occupant_kind,COALESCE(a.display_name,p.display_name) AS display_name
        FROM match_participants p LEFT JOIN accounts a ON a.id=p.account_id
        WHERE p.match_id=$1 ORDER BY p.seat_index`,
        [matchId],
      );
      await client.query('COMMIT');
      return {
        matchId,
        gameId: match.game_id,
        gameVersion: match.game_version,
        status: match.status,
        firstRevision: bounds.first,
        lastRevision: bounds.last,
        revision,
        seatIndex: match.seat_index,
        actorSeatId: frame.actor_seat_id,
        recordedAt: frame.created_at.toISOString(),
        assetBinding: match.asset_version_id
          ? {
              versionId: match.asset_version_id,
              manifestHash: match.asset_manifest_hash!,
              contractVersion: match.asset_contract_version!,
            }
          : null,
        players: players.rows.map((player) => ({
          seatId: player.seat_id,
          seatIndex: player.seat_index,
          displayName: player.display_name ?? `AI ${player.seat_index + 1}`,
          occupantKind: player.occupant_kind,
        })),
        view,
        events,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async commandReceipt(accountId: string, matchId: string, requestId: string) {
    const participant = await this.db.query(
      'SELECT 1 FROM match_participants WHERE match_id=$1 AND account_id=$2',
      [matchId, accountId],
    );
    if (!participant.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
    const receipt = await this.db.query<{ result_ref: { actionId?: string } }>(
      'SELECT result_ref FROM command_receipts WHERE account_id=$1 AND operation=$2 AND request_id=$3',
      [accountId, `match.action:${matchId}`, requestId],
    );
    if (!receipt.rowCount) return { outcome: 'not_found' as const, requestId };
    const action = await this.db.query<{ revision: number }>(
      'SELECT revision FROM match_actions WHERE id=$1 AND match_id=$2 AND account_id=$3',
      [receipt.rows[0]!.result_ref.actionId, matchId, accountId],
    );
    if (!action.rowCount)
      throw new AppError('RECOVERY_BLOCKED', 'Saved action result is unavailable', 503);
    return { outcome: 'accepted' as const, requestId, appliedRevision: action.rows[0]!.revision };
  }

  async view(accountId: string, matchId: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await this.viewWithClient(accountId, matchId, client);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async viewWithClient(accountId: string, matchId: string, client: PoolClient) {
    const result = await client.query<MatchRow & ParticipantRow>(
      `
      SELECT m.*, p.seat_id, p.seat_index, p.controller_type, p.controller_epoch,
        p.controller_version,p.ai_status_version,p.ai_status,p.ai_error_code,p.policy_id,p.policy_version,p.policy_hash,p.model_profile_id
      FROM matches m JOIN match_participants p ON p.match_id = m.id
      WHERE m.id = $1 AND p.account_id = $2`,
      [matchId, accountId],
    );
    if (!result.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
    const row = result.rows[0]!;
    const extension = this.extension(row);
    let view: unknown;
    try {
      DeterministicRng.restore(row.rng_state);
      view = extension.getView(extension.deserialize(row.state), {
        kind: 'seat',
        seatId: row.seat_id,
      });
    } catch {
      throw new AppError('RECOVERY_BLOCKED', 'Saved match state cannot be restored', 503);
    }
    const controllers = await client.query<
      ParticipantRow & { display_name: string | null; occupant_kind: 'human' | 'bot' }
    >(
      `SELECT p.*, COALESCE(a.display_name, p.display_name) AS display_name
       FROM match_participants p LEFT JOIN accounts a ON a.id=p.account_id
       WHERE p.match_id=$1 ORDER BY p.seat_index`,
      [matchId],
    );
    return {
      matchId,
      roomId: row.room_id,
      gameId: row.game_id,
      gameVersion: row.game_version,
      assetBinding: row.asset_version_id
        ? {
            versionId: row.asset_version_id,
            manifestHash: row.asset_manifest_hash!,
            contractVersion: row.asset_contract_version!,
          }
        : null,
      revision: row.revision,
      status: row.status,
      seatIndex: row.seat_index,
      controller: {
        type: row.controller_type,
        controllerEpoch: row.controller_epoch,
        controllerVersion: row.controller_version,
        policyId: row.policy_id,
        profileId: row.model_profile_id ?? null,
      },
      aiStatus: {
        status: row.ai_status,
        version: row.ai_status_version,
        safeErrorCode: row.ai_error_code,
      },
      players: controllers.rows.map((item) => ({
        seatId: item.seat_id,
        seatIndex: item.seat_index,
        occupantKind: item.occupant_kind,
        displayName: item.display_name ?? `AI ${item.seat_index + 1}`,
      })),
      controllers: controllers.rows.map((item) => ({
        seatIndex: item.seat_index,
        type: item.controller_type,
        controllerEpoch: item.controller_epoch,
        controllerVersion: item.controller_version,
        aiStatus: item.ai_status,
        aiStatusVersion: item.ai_status_version,
        safeErrorCode: item.ai_error_code,
      })),
      view,
      delivery: 'snapshot' as const,
    };
  }

  async liveView(accountId: string, matchId: string, revision: number, events: unknown[]) {
    const snapshot = await this.view(accountId, matchId);
    if (snapshot.revision !== revision) return snapshot;
    const participant = await this.db.query<{ seat_id: string }>(
      'SELECT seat_id FROM match_participants WHERE match_id=$1 AND account_id=$2',
      [matchId, accountId],
    );
    if (!participant.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
    const extension = this.registry.get(snapshot.gameId, snapshot.gameVersion);
    if (!extension)
      throw new AppError('GAME_VERSION_UNAVAILABLE', 'Match game version is unavailable', 503);
    const projected = extension.projectEvents(events, {
      kind: 'seat',
      seatId: participant.rows[0]!.seat_id,
    });
    const safeEvents = projected.map((event: Record<string, unknown>, index: number) => ({
      ...event,
      eventId: `${matchId}:${revision}:${index}`,
    }));
    return {
      ...snapshot,
      delivery: 'live' as const,
      events: safeEvents,
      cues: this.registry.presentation.get(snapshot.gameId)?.(safeEvents, snapshot.view) ?? [],
    };
  }

  // Both principals enter here only after authorization, receipt lookup and room -> match locks.
  // The caller owns COMMIT/ROLLBACK and publishes only after COMMIT succeeds.
  private async applyLockedAction(
    client: PoolClient,
    row: MatchRow,
    player: ParticipantRow,
    raw: unknown,
    command: {
      accountId: string | null;
      principal: string;
      operation: string;
      requestId: string;
      hash: string;
    },
  ) {
    const extension = this.extension(row);
    const automation = command.accountId === null;
    let state: ReturnType<typeof extension.deserialize>;
    let rng: DeterministicRng;
    try {
      state = extension.deserialize(row.state);
      rng = DeterministicRng.restore(row.rng_state);
    } catch {
      if (automation) throw new AppError('AI_TASK_STALE', 'AI proposal is no longer legal', 409);
      throw new AppError('RECOVERY_BLOCKED', 'Saved match state cannot be restored', 503);
    }
    let action: unknown;
    let applied: ReturnType<typeof extension.applyAction>;
    try {
      action = extension.parseAction(raw);
      const actor = {
        kind: 'seat' as const,
        seatId: player.seat_id,
        controllerEpoch: player.controller_epoch,
      };
      extension.validateAction(state, actor, action);
      applied = extension.applyAction(state, actor, action, rng);
    } catch {
      if (automation) throw new AppError('AI_TASK_STALE', 'AI proposal is no longer legal', 409);
      throw new AppError('ACTION_NOT_ALLOWED', 'Action is not allowed in the current state', 422);
    }
    const serialized = extension.serialize(applied.state);
    extension.deserialize(serialized);
    const outcome = extension.getOutcome(applied.state);
    const finished =
      typeof outcome === 'object' &&
      outcome !== null &&
      !Array.isArray(outcome) &&
      outcome.status === 'finished';
    const status = finished ? ('finished' as const) : ('active' as const);
    const revision = row.revision + 1;
    const viewer = { kind: 'seat' as const, seatId: player.seat_id };
    const actorView: unknown = extension.getView(applied.state, viewer);
    const actorEvents = extension
      .projectEvents(applied.events, viewer)
      .map((event: Record<string, unknown>, index: number) => ({
        ...event,
        eventId: `${row.id}:${revision}:${index}`,
      }));
    const actionId = randomUUID();
    await client.query(
      'UPDATE matches SET state=$2,rng_state=$3,revision=$4,status=$5 WHERE id=$1',
      [row.id, serialized, rng.snapshot(), revision, status],
    );
    await client.query(
      'UPDATE match_replay_frames SET internal_events=$3,actor_seat_id=$4 WHERE match_id=$1 AND revision=$2',
      [row.id, revision, JSON.stringify(applied.events), player.seat_id],
    );
    const roomChanged = finished && (await this.finishRoom(client, row.room_id, row.id));
    await client.query(
      'INSERT INTO match_actions(id,match_id,account_id,principal_key,seat_id,revision,action,actor_view,actor_events) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        actionId,
        row.id,
        command.accountId,
        command.principal,
        player.seat_id,
        revision,
        action,
        actorView,
        JSON.stringify(actorEvents),
      ],
    );
    await client.query(
      `INSERT INTO command_receipts(account_id,principal_key,operation,request_id,request_hash,room_id,result_ref,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'infinity'::timestamptz)`,
      [
        command.accountId,
        command.principal,
        command.operation,
        command.requestId,
        command.hash,
        row.room_id,
        { actionId, status },
      ],
    );
    return {
      revision,
      status,
      actorView,
      actorEvents,
      roomChanged,
      events: applied.events as unknown[],
    };
  }

  async act(accountId: string, matchId: string, raw: unknown, sessionId: string) {
    const body = matchActionSchema.parse(raw);
    const operation = `match.action:${matchId}`;
    const hash = fingerprint(
      body.expectedControllerEpoch === undefined
        ? { matchId, expectedRevision: body.expectedRevision, action: body.action }
        : {
            matchId,
            expectedRevision: body.expectedRevision,
            expectedControllerEpoch: body.expectedControllerEpoch,
            action: body.action,
          },
    );
    const client = await this.db.connect();
    let roomId: string | undefined;
    let result: unknown;
    let changed = false;
    let roomChanged = false;
    let publishedEvents: unknown[] = [];
    let publishedRevision = 0;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `request:${accountId}:${operation}:${body.requestId}`,
      ]);
      const room = await client.query<{ room_id: string }>(
        'SELECT room_id FROM matches WHERE id=$1',
        [matchId],
      );
      if (!room.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
      roomId = room.rows[0]!.room_id;
      await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      const match = await client.query<MatchRow>('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [
        matchId,
      ]);
      const row = match.rows[0]!;
      const participant = await client.query<ParticipantRow>(
        `
        SELECT seat_id, seat_index, controller_type, controller_epoch,controller_version,
          ai_status_version,ai_status,ai_error_code,policy_id,policy_version,policy_hash
        FROM match_participants WHERE match_id=$1 AND account_id=$2`,
        [matchId, accountId],
      );
      if (!participant.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
      const player = participant.rows[0]!;
      const session = await client.query(
        `SELECT 1 FROM sessions s JOIN accounts a ON a.id=s.account_id
        WHERE s.id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
        AND a.status='active' FOR SHARE OF s,a`,
        [sessionId, accountId],
      );
      if (!session.rowCount) throw new AppError('UNAUTHENTICATED', 'Session expired', 401);
      const receipt = await client.query<{
        request_hash: string;
        result_ref: { actionId?: string; status?: MatchRow['status'] };
      }>(
        `
        SELECT request_hash, result_ref FROM command_receipts
        WHERE account_id=$1 AND operation=$2 AND request_id=$3`,
        [accountId, operation, body.requestId],
      );
      if (receipt.rowCount) {
        if (receipt.rows[0]!.request_hash !== hash)
          throw new AppError(
            'REQUEST_ID_CONFLICT',
            'requestId was already used with different content',
            409,
          );
        const prior = await client.query<{
          revision: number;
          actor_view: unknown;
          actor_events: unknown;
        }>(
          `
          SELECT revision, actor_view, actor_events FROM match_actions WHERE id=$1 AND match_id=$2 AND account_id=$3`,
          [receipt.rows[0]!.result_ref.actionId, matchId, accountId],
        );
        if (!prior.rowCount)
          throw new AppError('INTERNAL_ERROR', 'Action receipt is unavailable', 500);
        result = this.response(
          { ...row, status: receipt.rows[0]!.result_ref.status ?? row.status },
          player,
          prior.rows[0]!.revision,
          prior.rows[0]!.actor_view,
          [],
        );
      } else {
        if (row.status !== 'active')
          throw new AppError('ACTION_NOT_ALLOWED', 'Match is not active', 422);
        const roomStatus = await client.query<{ status: string }>(
          'SELECT status FROM rooms WHERE id=$1',
          [row.room_id],
        );
        if (roomStatus.rows[0]?.status !== 'in_game')
          throw new AppError('ACTION_NOT_ALLOWED', 'Room is not in game', 422);
        if (row.revision !== body.expectedRevision)
          throw new AppError('STATE_CONFLICT', 'Match changed; reload and retry', 409, true);
        if (player.controller_type !== 'human')
          throw new AppError('CONTROLLER_NOT_HUMAN', 'Human control is unavailable', 409);
        if ((body.expectedControllerEpoch ?? 0) !== player.controller_epoch)
          throw new AppError(
            'CONTROLLER_CONFLICT',
            'Controller changed; reload and retry',
            409,
            true,
          );
        const applied = await this.applyLockedAction(client, row, player, body.action, {
          accountId,
          principal: `human:${accountId}`,
          operation,
          requestId: body.requestId,
          hash,
        });
        result = this.response(
          { ...row, status: applied.status },
          player,
          applied.revision,
          applied.actorView,
          applied.actorEvents,
        );
        changed = true;
        roomChanged = applied.roomChanged;
        publishedEvents = applied.events;
        publishedRevision = applied.revision;
      }
      if (changed) this.testFaults?.beforeCommit?.();
      await client.query('COMMIT');
      if (changed) this.testFaults?.afterCommit?.();
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A lost connection can make both COMMIT and ROLLBACK fail. Keep the
        // original error so the client can reconcile its unknown result.
      }
      throw error;
    } finally {
      client.release();
    }
    if (changed && roomId)
      for (const listener of this.listeners) {
        try {
          listener(roomId, matchId, publishedRevision, publishedEvents, roomChanged);
        } catch {
          /* Notification failure cannot undo commit. */
        }
      }
    return result;
  }

  async setMyController(accountId: string, matchId: string, raw: unknown) {
    const body = controllerCommandSchema.parse(raw);
    const operation = `match.controller:${matchId}`;
    const hash = fingerprint({ matchId, ...body });
    const client = await this.db.connect();
    let roomId = '';
    let changed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `request:${accountId}:${operation}:${body.requestId}`,
      ]);
      const located = await client.query<{ room_id: string }>(
        'SELECT room_id FROM matches WHERE id=$1',
        [matchId],
      );
      if (!located.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
      roomId = located.rows[0]!.room_id;
      await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      const match = await client.query<MatchRow>('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [
        matchId,
      ]);
      const row = match.rows[0]!;
      const participant = await client.query<ParticipantRow>(
        'SELECT * FROM match_participants WHERE match_id=$1 AND account_id=$2 FOR UPDATE',
        [matchId, accountId],
      );
      if (!participant.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
      const player = participant.rows[0]!;
      const old = await client.query<{ request_hash: string }>(
        'SELECT request_hash FROM command_receipts WHERE principal_key=$1 AND operation=$2 AND request_id=$3',
        [`human:${accountId}`, operation, body.requestId],
      );
      if (old.rowCount) {
        if (old.rows[0]!.request_hash !== hash)
          throw new AppError(
            'REQUEST_ID_CONFLICT',
            'requestId was already used with different content',
            409,
          );
      } else {
        if (row.status !== 'active')
          throw new AppError('ACTION_NOT_ALLOWED', 'Match is not active', 422);
        if (player.controller_epoch !== body.expectedControllerEpoch)
          throw new AppError(
            'CONTROLLER_CONFLICT',
            'Controller changed; reload and retry',
            409,
            true,
          );
        if (body.controllerType === 'script' && player.occupant_kind === 'human')
          throw new AppError('FORBIDDEN', '真人座位不能开启脚本托管，请使用专用 AI 座位。', 403);
        if (
          (body.controllerType === 'script' || body.controllerType === 'model') &&
          !this.extension(row).getDecisionContext
        )
          throw new AppError('AI_NOT_SUPPORTED', 'Game does not support AI', 422);
        if (body.controllerType === 'model') {
          if (!body.profileId)
            throw new AppError('VALIDATION_ERROR', 'Model profile is required', 400);
          const profile = await client.query<{
            id: string;
            protocol: string;
            has_credential: boolean;
          }>(
            `SELECT p.id,e.protocol,(c.id IS NOT NULL AND c.revoked_at IS NULL) AS has_credential FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id LEFT JOIN model_credentials c ON c.id=p.credential_id WHERE p.id=$1 AND p.owner_account_id=$2 AND p.enabled=true AND p.deleted_at IS NULL FOR SHARE OF p`,
            [body.profileId, accountId],
          );
          if (
            !profile.rowCount ||
            (profile.rows[0]!.protocol !== 'mock' && !profile.rows[0]!.has_credential)
          )
            throw new AppError('FORBIDDEN', '模型配置或凭证不可用', 403);
        }
        if (
          player.controller_type !== body.controllerType ||
          (body.controllerType === 'model' && player.model_profile_id !== body.profileId)
        ) {
          const policyId =
            body.controllerType === 'script'
              ? (body.policyId ?? 'basic-v1')
              : body.controllerType === 'model'
                ? 'model'
                : null;
          const policyVersion =
            body.controllerType === 'script' || body.controllerType === 'model' ? '1.0.0' : null;
          const policyHash =
            body.controllerType === 'script' || body.controllerType === 'model'
              ? fingerprint(`${row.game_id}:${policyId}:${policyVersion}:${body.profileId ?? ''}`)
              : null;
          await client.query(
            "UPDATE match_participants SET controller_type=$3,controller_epoch=controller_epoch+1,controller_version=controller_version+1,policy_id=$4,policy_version=$5,policy_hash=$6,model_profile_id=$7,ai_status='idle',ai_error_code=NULL,ai_status_version=ai_status_version+1 WHERE match_id=$1 AND seat_id=$2",
            [
              matchId,
              player.seat_id,
              body.controllerType,
              policyId,
              policyVersion,
              policyHash,
              body.controllerType === 'model' ? body.profileId : null,
            ],
          );
          await client.query(
            "UPDATE ai_tasks SET status='cancelled',updated_at=now() WHERE match_id=$1 AND seat_id=$2 AND status NOT IN ('succeeded','stale','cancelled','blocked')",
            [matchId, player.seat_id],
          );
          changed = true;
        }
        await client.query(
          `INSERT INTO command_receipts(account_id,principal_key,operation,request_id,request_hash,room_id,result_ref,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'infinity')`,
          [
            accountId,
            `human:${accountId}`,
            operation,
            body.requestId,
            hash,
            roomId,
            { controllerType: body.controllerType },
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const snapshot = await this.view(accountId, matchId);
    if (changed)
      for (const listener of this.listeners) listener(roomId, matchId, snapshot.revision, []);
    return snapshot;
  }

  async retryAi(accountId: string, matchId: string, seatId: string) {
    const access = await this.db.query<{ host_account_id: string; account_id: string | null }>(
      'SELECT r.host_account_id,p.account_id FROM matches m JOIN rooms r ON r.id=m.room_id JOIN match_participants p ON p.match_id=m.id WHERE m.id=$1 AND p.seat_id=$2',
      [matchId, seatId],
    );
    if (
      !access.rowCount ||
      (access.rows[0]!.account_id !== accountId && access.rows[0]!.host_account_id !== accountId)
    )
      throw new AppError('FORBIDDEN', 'AI retry permission denied', 403);
    await this.db.query(
      "UPDATE match_participants SET ai_status='idle',ai_error_code=NULL,ai_status_version=ai_status_version+1 WHERE match_id=$1 AND seat_id=$2 AND controller_type='script'",
      [matchId, seatId],
    );
    await this.db.query(
      "UPDATE ai_tasks SET status='stale',updated_at=now() WHERE match_id=$1 AND seat_id=$2 AND status='blocked'",
      [matchId, seatId],
    );
    await this.notifyStatus(matchId);
    return { retried: true };
  }

  async actAutomation(taskId: string, leaseOwner: string, leaseGeneration: number) {
    const hint = await this.db.query<{ match_id: string; seat_id: string }>(
      'SELECT match_id,seat_id FROM ai_tasks WHERE id=$1',
      [taskId],
    );
    if (!hint.rowCount) throw new AppError('AI_TASK_STALE', 'AI task is unavailable', 409);
    const matchId = hint.rows[0]!.match_id;
    const client = await this.db.connect();
    let roomId = '';
    let publishedEvents: unknown[] = [];
    let revision = 0;
    let roomChanged = false;
    try {
      await client.query('BEGIN');
      const located = await client.query<{ room_id: string }>(
        'SELECT room_id FROM matches WHERE id=$1',
        [matchId],
      );
      if (!located.rowCount) throw new AppError('MATCH_NOT_FOUND', 'Match not found', 404);
      roomId = located.rows[0]!.room_id;
      await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      const match = (
        await client.query<MatchRow>('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId])
      ).rows[0]!;
      const player = (
        await client.query<ParticipantRow>(
          'SELECT * FROM match_participants WHERE match_id=$1 AND seat_id=$2 FOR UPDATE',
          [matchId, hint.rows[0]!.seat_id],
        )
      ).rows[0]!;
      const task = (
        await client.query<{
          source_revision: number;
          controller_epoch: number;
          decision_key: string;
          policy_id: string;
          policy_version: string;
          policy_hash: string;
          status: string;
          request_id: string;
          proposed_action: unknown;
          lease_owner: string | null;
          lease_generation: number;
        }>(
          `SELECT source_revision,controller_epoch,decision_key,policy_id,policy_version,policy_hash,status,request_id,proposed_action,lease_owner,lease_generation FROM ai_tasks WHERE id=$1 FOR UPDATE`,
          [taskId],
        )
      ).rows[0]!;
      if (
        task.lease_owner !== leaseOwner ||
        task.lease_generation !== leaseGeneration ||
        !['proposed', 'submitting'].includes(task.status)
      )
        throw new AppError('AI_TASK_STALE', 'AI task lease is stale', 409);
      if (
        (player.occupant_kind === 'human' && player.controller_type === 'script') ||
        match.status !== 'active' ||
        match.revision !== task.source_revision ||
        !['script', 'model'].includes(player.controller_type) ||
        player.controller_epoch !== task.controller_epoch ||
        player.policy_id !== task.policy_id ||
        player.policy_version !== task.policy_version ||
        player.policy_hash !== task.policy_hash
      ) {
        await client.query("UPDATE ai_tasks SET status='stale',updated_at=now() WHERE id=$1", [
          taskId,
        ]);
        await client.query('COMMIT');
        return { stale: true };
      }
      if (player.model_owner_account_id || player.account_id) {
        const active = await client.query(
          "SELECT 1 FROM accounts WHERE id=$1 AND status='active'",
          [player.model_owner_account_id ?? player.account_id],
        );
        if (!active.rowCount) throw new AppError('AI_BLOCKED', 'Seat owner is inactive', 409);
      }
      const principal = `automation:${matchId}:${player.seat_id}:${player.controller_epoch}`;
      const operation = `match.action:${matchId}`;
      const hash = fingerprint({
        matchId,
        expectedRevision: task.source_revision,
        expectedControllerEpoch: task.controller_epoch,
        action: task.proposed_action,
      });
      const receipt = await client.query<{ result_ref: { actionId: string } }>(
        'SELECT result_ref FROM command_receipts WHERE principal_key=$1 AND operation=$2 AND request_id=$3',
        [principal, operation, task.request_id],
      );
      if (receipt.rowCount) {
        const applied = await client.query<{ revision: number }>(
          'SELECT revision FROM match_actions WHERE id=$1',
          [receipt.rows[0]!.result_ref.actionId],
        );
        await client.query(
          "UPDATE ai_tasks SET status='succeeded',applied_revision=$2,updated_at=now() WHERE id=$1",
          [taskId, applied.rows[0]?.revision],
        );
        await client.query('COMMIT');
        return { recovered: true };
      }
      const applied = await this.applyLockedAction(client, match, player, task.proposed_action, {
        accountId: null,
        principal,
        operation,
        requestId: task.request_id,
        hash,
      });
      revision = applied.revision;
      roomChanged = applied.roomChanged;
      await client.query(
        "UPDATE ai_tasks SET status='succeeded',applied_revision=$2,updated_at=now() WHERE id=$1",
        [taskId, revision],
      );
      await client.query(
        "UPDATE match_participants SET ai_status='idle',ai_error_code=NULL,ai_status_version=ai_status_version+1 WHERE match_id=$1 AND seat_id=$2",
        [matchId, player.seat_id],
      );
      publishedEvents = applied.events;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    for (const listener of this.listeners) {
      try {
        listener(roomId, matchId, revision, publishedEvents, roomChanged);
      } catch {
        /* Notification failure cannot undo commit. */
      }
    }
    return { revision };
  }

  private response(
    row: MatchRow,
    player: ParticipantRow,
    revision: number,
    view: unknown,
    events: unknown,
  ) {
    return {
      matchId: row.id,
      roomId: row.room_id,
      gameId: row.game_id,
      gameVersion: row.game_version,
      assetBinding: row.asset_version_id
        ? {
            versionId: row.asset_version_id,
            manifestHash: row.asset_manifest_hash!,
            contractVersion: row.asset_contract_version!,
          }
        : null,
      revision,
      status: row.status,
      seatIndex: player.seat_index,
      controller: {
        type: player.controller_type,
        controllerEpoch: player.controller_epoch,
        controllerVersion: player.controller_version,
        policyId: player.policy_id,
        profileId: player.model_profile_id ?? null,
      },
      aiStatus: {
        status: player.ai_status,
        version: player.ai_status_version,
        safeErrorCode: player.ai_error_code,
      },
      view,
      events,
      delivery: 'live' as const,
    };
  }
}
