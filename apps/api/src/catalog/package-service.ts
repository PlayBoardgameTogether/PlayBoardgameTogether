import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { packageArtworkKindSchema, packagePresentationSchema } from './package-art.js';
import { z } from 'zod';
import { DeterministicRng } from '@boardgame/game-sdk';
import { gamePackageResultSchema, gamePackageReviewSchema } from '@boardgame/protocol';
import type { AuthContext } from '../auth.js';
import type { Database } from '../db/index.js';
import type { GameRegistry } from '../registry/index.js';
import { PackageRuntime } from '../registry/package-runtime.js';
import { readGamePackage } from './game-package.js';
import { AppError } from '../errors.js';
import { compareGameVersions } from './official-source.js';
import {
  packagePublicResultContractSchema,
  type PackagePublicResultContract,
} from '../registry/package-public-result.js';

type Row = {
  game_id: string;
  game_version: string;
  package_hash: string;
  server_source: string;
  public_rules: string;
  public_result_contract: PackagePublicResultContract | null;
};

export class GamePackageService {
  private readonly loaded = new Map<string, string>();
  private constructor(private readonly db: Database, private readonly registry: GameRegistry, private readonly runtime: PackageRuntime) {}
  static async create(db: Database, registry: GameRegistry) {
    const service = new GamePackageService(db, registry, await PackageRuntime.create());
    return service;
  }
  private register(row: Row) {
    const key = `${row.game_id}@${row.game_version}`;
    if (this.loaded.get(key) === row.package_hash) return;
    if (this.registry.get(row.game_id, row.game_version)) {
      throw new AppError('STATE_CONFLICT', '游戏包与已注册版本冲突', 409);
    }
    const extension = this.runtime.extension(row.server_source);
    if (extension.manifest.id !== row.game_id || extension.manifest.version !== row.game_version) {
      throw new AppError('GAME_VERSION_UNAVAILABLE', '持久游戏包版本不匹配', 422);
    }
    const contract = packagePublicResultContractSchema.nullable().parse(row.public_result_contract);
    // Prepare every fallible optional adapter before registering the immutable version.
    const resultSummary = contract ? this.runtime.publicResult(row.server_source) : undefined;
    const source = `boardgame-package-v1:quickjs-0.31.0:${row.package_hash}:${JSON.stringify({
      server: row.server_source, rules: row.public_rules,
    })}`;
    this.registry.register(extension, {
      ...extension.manifest.defaultAssetPack, language: 'zh-CN', assets: [],
    }, [], Buffer.from(source + (contract ? `:public-result:${contract}` : '')));
    if (resultSummary) this.registry.resultSummaries.set(key, resultSummary);
    this.registry.rules.set(key, row.public_rules);
    this.loaded.set(key, row.package_hash);
  }
  async refresh() {
    const exists = await this.db.query<{ exists: boolean }>("SELECT to_regclass('public.game_packages') IS NOT NULL AS exists");
    if (!exists.rows[0]?.exists) return;
    const versions = await this.db.query<{ game_id: string; game_version: string; package_hash: string }>('SELECT game_id,game_version,package_hash FROM game_packages');
    for (const row of versions.rows) {
      if (this.loaded.get(`${row.game_id}@${row.game_version}`) === row.package_hash) continue;
      const source = await this.db.query<Row>(
        'SELECT game_id,game_version,package_hash,server_source,public_rules,public_result_contract FROM game_packages WHERE game_id=$1 AND game_version=$2',
        [row.game_id, row.game_version],
      );
      this.register(source.rows[0]!);
    }
  }
  private validate(bytes: Buffer) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const packageData = readGamePackage(bytes);
    const extension = this.runtime.extension(packageData.server), manifest = extension.manifest;
    const resultSummary = packageData.publicResult
      ? this.runtime.publicResult(packageData.server)
      : undefined;
    packageVersionParams.parse({ id: manifest.id, version: manifest.version });
    // Smoke-test the actual SDK lifecycle without altering any existing match or RNG.
    for (const count of new Set([manifest.players.min, manifest.players.max])) {
      const seats = Array.from({ length: count }, (_, i) => `seat-${i + 1}`);
      const initial = extension.setup({ seats, options: extension.validateOptions({}), rng: new DeterministicRng(12345) });
      const recovered = extension.deserialize(extension.serialize(initial.state));
      for (const seatId of seats) {
        const viewer = { kind: 'seat' as const, seatId };
        const view = extension.getView(recovered, viewer);
        const decision = extension.getDecisionContext?.(recovered, viewer);
        if (decision) {
          // Keep installation smoke checks bounded; every chosen action is revalidated by matches.
          extension.validateAction(recovered, { kind: 'seat', seatId, controllerEpoch: 0 },
            extension.parseAction(decision.legalActions[0]));
          const fallback = extension.getFallbackAction(view, extension.getActionSpec(recovered, viewer));
          if (!decision.legalActions.some(action => isDeepStrictEqual(action, fallback))) {
            throw new AppError('VALIDATION_ERROR', 'AI 兜底动作必须是合法候选之一', 400);
          }
        }
        extension.getActionSpec(recovered, viewer);
        extension.projectEvents(initial.events, viewer);
      }
      const outcome = extension.getOutcome(recovered);
      const status = z.object({ status: z.enum(['ongoing', 'finished']) }).parse(outcome).status;
      if (status === 'finished') resultSummary?.(outcome, seats);
    }
    const result = gamePackageResultSchema.parse({ gameId: manifest.id, version: manifest.version, name: manifest.name, hash });
    return { hash, packageData, manifest, result };
  }
  private async catalog(client: Pick<Database, 'query'>, id: string, lock = false) {
    const versions = await client.query<{ game_version: string; enabled: boolean; admin_revision: number }>(
      `SELECT game_version,enabled,admin_revision FROM game_installations WHERE game_id=$1 ORDER BY game_version${lock ? ' FOR UPDATE' : ''}`, [id]);
    return {
      versions: versions.rows.map(row => row.game_version),
      hash: createHash('sha256').update(JSON.stringify(versions.rows)).digest('hex'),
    };
  }
  async review(bytes: Buffer) {
    const { manifest, hash, result } = this.validate(bytes);
    const catalog = await this.catalog(this.db, manifest.id);
    const known = await this.db.query<{ package_hash: string }>(
      'SELECT package_hash FROM game_packages WHERE game_id=$1 AND game_version=$2', [manifest.id, manifest.version]);
    if (catalog.versions.includes(manifest.version) && known.rows[0]?.package_hash !== hash) {
      throw new AppError('STATE_CONFLICT', '此版本已存在，请提升版本号后上传', 409);
    }
    return gamePackageReviewSchema.parse({ ...result, catalogHash: catalog.hash,
      installedVersions: catalog.versions,
      kind: known.rowCount ? 'installed' : catalog.versions.length ? 'update' : 'new',
    });
  }
  async install(current: AuthContext, requestId: string, bytes: Buffer, expectedCatalogHash?: string) {
    return this.installAuthorized({ kind: 'session', current }, requestId, bytes, expectedCatalogHash);
  }
  async installSubscribed(revision: number, requestId: string, bytes: Buffer, expectedCatalogHash: string) {
    return this.installAuthorized({ kind: 'subscription', revision }, requestId, bytes, expectedCatalogHash);
  }
  private async installAuthorized(
    authorization: { kind: 'session'; current: AuthContext } | { kind: 'subscription'; revision: number },
    requestId: string, bytes: Buffer, expectedCatalogHash?: string,
  ) {
    const { hash, packageData, manifest, result } = this.validate(bytes);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(73418, 2)');
      const owner = authorization.kind === 'subscription'
        ? (await client.query<{ authorized_by: string }>('SELECT authorized_by FROM game_subscription WHERE singleton=true')).rows[0]?.authorized_by
        : authorization.current.account.id;
      const account = await client.query<{ role: string }>("SELECT role FROM accounts WHERE id=$1 AND status='active' FOR UPDATE", [owner]);
      if (!account.rowCount) throw new AppError('UNAUTHENTICATED', '安装授权已失效', 401);
      if (account.rows[0]?.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
      if (authorization.kind === 'session') {
        const current = authorization.current;
        const session = await client.query(`SELECT 1 FROM sessions WHERE id=$1 AND account_id=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`, [current.sessionId, owner, current.tokenHash]);
        if (!session.rowCount) throw new AppError('UNAUTHENTICATED', '会话已失效', 401);
      } else {
        const settings = await client.query<{ revision: number; authorized_by: string; auto_add: boolean; auto_update: boolean }>('SELECT * FROM game_subscription WHERE singleton=true FOR SHARE');
        const policy = settings.rows[0]!;
        const installed = await client.query<{ game_version: string; enabled: boolean; online: boolean }>(
          `SELECT i.game_version,i.enabled,p.game_id IS NOT NULL AS online FROM game_installations i
           LEFT JOIN game_packages p USING(game_id,game_version) WHERE i.game_id=$1`, [manifest.id]);
        if (policy.revision !== authorization.revision || policy.authorized_by !== owner ||
          (installed.rows.length ? !policy.auto_update : !policy.auto_add) ||
          installed.rows.some(row => !row.online || compareGameVersions(row.game_version, manifest.version) >= 0) ||
          (installed.rows.length && !installed.rows.some(row => row.enabled))) {
          throw new AppError('STATE_CONFLICT', '订阅授权或游戏状态已变化，本次安装已取消', 409);
        }
      }
      const previous = await client.query<{ package_hash: string; result: unknown }>('SELECT package_hash,result FROM game_package_receipts WHERE account_id=$1 AND request_id=$2', [owner, requestId]);
      if (previous.rows[0]) {
        if (previous.rows[0].package_hash !== hash) throw new AppError('REQUEST_ID_CONFLICT', '同一请求 ID 不能上传不同游戏包', 409);
        await client.query('COMMIT');
        await this.refresh();
        return gamePackageResultSchema.parse(previous.rows[0].result);
      }
      const receipts = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM game_package_receipts');
      if (receipts.rows[0]!.count >= 10000) throw new AppError('RATE_LIMITED', '安装请求存储配额已满，请联系维护者', 429);
      const known = await client.query<{ package_hash: string }>('SELECT package_hash FROM game_packages WHERE game_id=$1 AND game_version=$2', [manifest.id, manifest.version]);
      if (known.rows[0] && known.rows[0].package_hash !== hash) throw new AppError('STATE_CONFLICT', '此版本已存在，请提升版本号后上传', 409);
      if (!known.rowCount) {
        const catalog = await this.catalog(client, manifest.id, true);
        if ((catalog.versions.length && !expectedCatalogHash) ||
          (expectedCatalogHash && expectedCatalogHash !== catalog.hash)) {
          throw new AppError('STATE_CONFLICT', '游戏版本或上架状态已变化，请重新检查并审核游戏包', 409);
        }
        const counts = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM game_packages');
        if (counts.rows[0]!.count >= 100) throw new AppError('RATE_LIMITED', '已达到 100 个在线安装版本，请联系维护者', 429);
        const existing = await client.query('SELECT 1 FROM game_installations WHERE game_id=$1 AND game_version=$2', [manifest.id, manifest.version]);
        if (existing.rowCount || this.registry.get(manifest.id, manifest.version)) throw new AppError('STATE_CONFLICT', '不能覆盖已安装游戏版本', 409);
        // Replace catalog availability atomically; immutable old rules remain recoverable.
        await client.query('UPDATE game_installations SET enabled=false WHERE game_id=$1 AND enabled=true', [manifest.id]);
        await client.query('INSERT INTO game_installations(game_id,game_version,content_version,sdk_range,manifest,enabled) VALUES($1,$2,$3,$4,$5,true)', [manifest.id, manifest.version, manifest.contentVersion, manifest.sdkRange, manifest]);
        await client.query(
          'INSERT INTO game_packages(game_id,game_version,package_hash,server_source,client_html,public_rules,installed_by,presentation,public_result_contract) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [manifest.id, manifest.version, hash, packageData.server, packageData.client,
            packageData.rules, owner, packageData.presentation ?? {}, packageData.publicResult ?? null],
        );
      }
      await client.query('INSERT INTO game_package_receipts(account_id,request_id,package_hash,result) VALUES($1,$2,$3,$4)', [owner, requestId, hash, result]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    await this.refresh();
    return result;
  }
  async artwork(id: string, version: string, rawKind: unknown) {
    const kind = packageArtworkKindSchema.parse(rawKind);
    const result = await this.db.query<{ presentation: unknown }>(
      'SELECT presentation FROM game_packages WHERE game_id=$1 AND game_version=$2', [id, version]);
    const data = result.rows[0] && packagePresentationSchema.parse(result.rows[0].presentation)[kind];
    if (!data) throw new AppError('GAME_NOT_FOUND', '游戏展示图片不存在', 404);
    return Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
  }
  async desktop(id: string, version: string) {
    const row = await this.db.query<{ client_html: string }>('SELECT client_html FROM game_packages WHERE game_id=$1 AND game_version=$2', [id, version]);
    if (!row.rows[0]) throw new AppError('GAME_NOT_FOUND', '在线游戏桌面不存在', 404);
    return row.rows[0].client_html;
  }
}

export const packageVersionParams = z.object({ id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(128), version: z.string().regex(/^\d+\.\d+\.\d+$/).max(32) }).strict();
