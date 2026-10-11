import { MatchService } from '../../apps/api/src/matches.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { installUpdateDrain } from '../../apps/api/src/update-drain.js';
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { colorMatchExtension } from '../../games/color-match/src/server/index.js';
import { DeterministicRng } from '../../packages/game-sdk/src/index.js';
import { winningPosition } from '../fixtures/color-match-win.js';
import { readFile } from 'node:fs/promises';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
type Session = { cookie: string; csrf: string };

describe.skipIf(!url)('Color Match formal action flow', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  const send = vi.fn();
  const updateIpc = Object.assign(new EventEmitter(), { send });
  beforeAll(async () => {
    db = createDatabase(url!);
    app = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001,
      DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false,
      LOG_LEVEL: 'error', PRESENCE_GRACE_MS: 100,
    }, db, registry: createRegistry(false) });
    installUpdateDrain(app, updateIpc);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    for (const username of ['alice', 'bob', 'carol', 'dave']) await createAccount(db, {
      username, displayName: username, password: 'correct horse battery', role: 'user',
    });
  });
it('reads the match and all controller metadata from one snapshot during a control change', async () => {
    const { matchId } = await start();
    const accountId = (
      await db.query<{ id: string }>("SELECT id FROM accounts WHERE username_canonical='alice'")
    ).rows[0]!.id;
    const firstRead = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let paused = false;
    function intercept<T extends object>(target: T): T {
      return new Proxy(target, {
        get(object, property) {
          const value: unknown = Reflect.get(object, property);
          if (property === 'query' && typeof value === 'function')
            return async (...args: unknown[]) => {
              const result: unknown = await Reflect.apply(value, object, args);
              if (
                !paused &&
                typeof args[0] === 'string' &&
                args[0].includes('SELECT m.*, p.seat_id')
              ) {
                paused = true;
                firstRead.resolve();
                await resume.promise;
              }
              return result;
            };
          if (property === 'connect' && typeof value === 'function')
            return async () => intercept(await Reflect.apply(value, object, []));
          return typeof value === 'function' ? value.bind(object) : value;
        },
      });
    }
    const service = new MatchService(intercept(db), createRegistry(false));
    const pending = service.view(accountId, matchId);
    await firstRead.promise;
    try {
      await db.query(
        'UPDATE match_participants SET controller_epoch=controller_epoch+1,controller_version=controller_version+1 WHERE match_id=$1 AND account_id=$2',
        [matchId, accountId],
      );
    } finally {
      resume.resolve();
    }
    const snapshot = await pending;
    const own = snapshot.controllers.find((player) => player.seatIndex === snapshot.seatIndex)!;
    expect(own.controllerVersion).toBe(snapshot.controller.controllerVersion);
    expect(own.controllerEpoch).toBe(snapshot.controller.controllerEpoch);
    expect(snapshot.controller.controllerVersion).toBe(0);
    const after = await service.view(accountId, matchId);
    expect(after.controller.controllerVersion).toBe(1);
  });
  async function login(username: string): Promise<Session> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin },
      payload: { username, password: 'correct horse battery' } });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [String(raw)];
    return { cookie: cookies.map(value => value.split(';')[0]).join('; '), csrf: response.json().data.csrfToken };
  }
  const write = (urlPath: string, session: Session, payload: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST') =>
    app.inject({ method, url: urlPath, headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf }, payload });
  const read = (urlPath: string, session: Session) => app.inject({ url: urlPath, headers: { cookie: session.cookie } });
  async function start(seatCount = 2) {
    const sessions = await Promise.all(['alice', 'bob', 'carol', 'dave'].map(login));
    const [alice, bob, carol] = sessions as [Session, Session, Session, Session];
    const created = await write('/api/v1/rooms', alice, { requestId: 'create', name: 'Colors',
      gameId: 'color-match', version: '1.0.0', options: {}, seatCount });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    let roomRevision = 0;
    for (let index = 1; index < seatCount; index++) {
      const joined = await write('/api/v1/rooms/join', sessions[index]!, { requestId: `join-${index}`, inviteCode });
      expect(joined.statusCode).toBe(200);
      roomRevision = joined.json().data.roomRevision;
      const seated = await write(`/api/v1/rooms/${roomId}/my-seat`, sessions[index]!,
        { requestId: `seat-${index}`, expectedRoomRevision: roomRevision, seatIndex: index }, 'PUT');
      expect(seated.statusCode).toBe(200);
      roomRevision = seated.json().data.roomRevision;
    }
    for (let index = 0; index < seatCount; index++) {
      const readied = await write(`/api/v1/rooms/${roomId}/my-ready`, sessions[index]!,
        { requestId: `ready-${index}`, expectedRoomRevision: roomRevision, ready: true }, 'PUT');
      expect(readied.statusCode).toBe(200);
      roomRevision = readied.json().data.roomRevision;
    }
    const launched = await write(`/api/v1/rooms/${roomId}/start`, alice, { requestId: 'start', expectedRoomRevision: roomRevision });
    expect(launched.statusCode).toBe(200);
    return { alice, bob, carol, sessions, roomId, matchId: launched.json().data.matchId as string };
  }
  it('replays committed frames only to original participants without revealing opposing hands', async () => {
    const { alice, bob, carol, roomId, matchId } = await start();
    const endpoint = `/api/v1/matches/${matchId}`;
    const initialA = (await read(`${endpoint}/view`, alice)).json().data.view;
    const initialB = (await read(`${endpoint}/view`, bob)).json().data.view;
    expect((await read(`${endpoint}/replay`, alice)).statusCode).toBe(422);
    expect((await read(`${endpoint}/replay`, carol)).statusCode).toBe(404);
    const command = { requestId: 'replay-draw', expectedRevision: 0, action: { type: 'draw_card' } };
    const changed = await write(`${endpoint}/actions`, alice, command);
    expect(changed.statusCode).toBe(200);
    expect((await write(`${endpoint}/actions`, alice, command)).statusCode).toBe(200);
    expect((await write(`${endpoint}/actions`, alice, { ...command, requestId: 'stale-replay' })).statusCode).toBe(409);
    expect((await db.query('SELECT revision FROM match_replay_frames WHERE match_id=$1 ORDER BY revision', [matchId])).rows)
      .toEqual([{ revision: 0 }, { revision: 1 }]);
    const afterB = (await read(`${endpoint}/view`, bob)).json().data.view;
    const room = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    expect((await write(`/api/v1/rooms/${roomId}/close`, alice, {
      requestId: 'replay-close', expectedRoomRevision: room.roomRevision,
    })).statusCode).toBe(200);
    const a = await read(`${endpoint}/replay`, alice);
    expect(a.statusCode).toBe(200);
    expect(a.headers['cache-control']).toBe('no-store');
    expect(a.json().data).toMatchObject({ firstRevision: 0, lastRevision: 1, revision: 0, status: 'aborted', view: initialA });
    expect((await read(`${endpoint}/replay?revision=0`, bob)).json().data.view).toEqual(initialB);
    expect((await read(`${endpoint}/replay?revision=1`, alice)).json().data.view).toEqual(changed.json().data.view);
    const b = (await read(`${endpoint}/replay?revision=1`, bob)).json().data;
    expect(b.view).toEqual(afterB);
    expect(b.events.every((event: { eventId: string }) => event.eventId.startsWith(`${matchId}:1:`))).toBe(true);
    expect(b).not.toHaveProperty('state');
    expect(b).not.toHaveProperty('action');
    expect(b).not.toHaveProperty('internal_events');
    expect(b.view).not.toHaveProperty('deck');
    expect(JSON.stringify(b)).not.toContain(changed.json().data.view.myHand.at(-1).id);
    for (const query of ['revision=2', 'revision=-1', 'revision=1.5', 'seatId=other']) {
      expect((await read(`${endpoint}/replay?${query}`, alice)).statusCode).toBe(400);
    }
    expect((await read(`${endpoint}/replay`, carol)).statusCode).toBe(404);
    expect((await app.inject({ url: `${endpoint}/replay` })).statusCode).toBe(401);
    // Emulate a legacy retained frame: report the actual available range.
    await db.query('DELETE FROM match_replay_frames WHERE match_id=$1 AND revision=0', [matchId]);
    expect((await read(`${endpoint}/replay`, alice)).json().data).toMatchObject({ firstRevision: 1, lastRevision: 1, revision: 1 });
    // Exact version integrity remains mandatory for historical reads.
    await db.query("UPDATE matches SET rule_digest='changed' WHERE id=$1", [matchId]);
    expect((await read(`${endpoint}/replay`, alice)).json().error.code).toBe('RECOVERY_BLOCKED');
  });

  it('updates with an active match and restores sessions, private views, RNG and command receipts', async () => {
    const { alice, bob, matchId } = await start();
    const endpoint = `/api/v1/matches/${matchId}`;
    const command = { requestId: 'update-recovery-command', expectedRevision: 0, action: { type: 'draw_card' } };
    const response = await write(`${endpoint}/actions`, alice, command);
    expect(response.statusCode).toBe(200);
    const before = await db.query('SELECT state,rng_state,revision,status FROM matches WHERE id=$1', [matchId]);
    expect(before.rows[0].status).toBe('active');
    const aliceView = (await read(`${endpoint}/view`, alice)).json().data;
    const bobView = (await read(`${endpoint}/view`, bob)).json().data;
    send.mockClear();
    updateIpc.emit('message', 'update.drain');
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: 'update.drained', idle: true }));
    expect((await read(`${endpoint}/view`, alice)).statusCode).toBe(503);
    await app.close();
    db = createDatabase(url!);
    app = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001,
      DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false,
      LOG_LEVEL: 'error', PRESENCE_GRACE_MS: 100,
    }, db, registry: createRegistry(false) });
    installUpdateDrain(app, updateIpc);
    expect((await read(`${endpoint}/view`, alice)).json().data).toEqual(aliceView);
    expect((await read(`${endpoint}/view`, bob)).json().data).toEqual(bobView);
    const retry = await write(`${endpoint}/actions`, alice, command);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toEqual({ ...response.json().data, events: [] });
    expect((await db.query('SELECT count(*)::int AS count FROM match_actions WHERE match_id=$1', [matchId])).rows[0].count).toBe(1);
    expect((await db.query('SELECT state,rng_state,revision,status FROM matches WHERE id=$1', [matchId])).rows).toEqual(before.rows);
    expect((await write(`${endpoint}/actions`, bob, {
      requestId: 'after-update', expectedRevision: 1, action: { type: 'draw_card' },
    })).statusCode).toBe(200);
  });

  it('isolates private views, rejects forged actions, serializes concurrent requests and reaches a persisted win', async () => {
    const { alice, bob, carol, roomId, matchId } = await start();
    const endpoint = `/api/v1/matches/${matchId}`;
    const a = (await read(`${endpoint}/view`, alice)).json().data;
    const b = (await read(`${endpoint}/view`, bob)).json().data;
    expect(a.view.myHand).toHaveLength(5);
    expect(b.view.myHand).toHaveLength(5);
    expect(a.view.deck).toBeUndefined();
    expect(a.view.hands).toBeUndefined();
    expect(JSON.stringify(a.view)).not.toContain(b.view.myHand[0].id);
    expect((await read(`${endpoint}/view`, carol)).statusCode).toBe(404);
    const forged = await write(`${endpoint}/actions`, alice, { requestId: 'forged', expectedRevision: 0,
      action: { type: 'play_card', cardId: b.view.myHand[0].id } });
    expect(forged.statusCode).toBe(422);
    expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1',[matchId])).rows[0]!.revision).toBe(0);
    const first = { requestId: 'parallel-1', expectedRevision: 0, action: { type: 'draw_card' } };
    const second = { requestId: 'parallel-2', expectedRevision: 0, action: { type: 'draw_card' } };
    const parallel = await Promise.all([write(`${endpoint}/actions`, alice, first), write(`${endpoint}/actions`, alice, second)]);
    expect(parallel.map(item => item.statusCode).sort()).toEqual([200, 409]);
    const winner = parallel[0]!.statusCode === 200 ? first : second;
    const replay = await write(`${endpoint}/actions`, alice, winner);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.revision).toBe(1);
    expect((await write(`${endpoint}/actions`, alice, { ...winner, action: { type: 'play_card', cardId: 'x' } })).json().error.code).toBe('REQUEST_ID_CONFLICT');
    let finalCommand: { session: Session; payload: { requestId: string; expectedRevision: number; action: unknown } } | undefined;
    for (let turn = 0; turn < 1000; turn++) {
      const av = (await read(`${endpoint}/view`, alice)).json().data;
      const bv = (await read(`${endpoint}/view`, bob)).json().data;
      if (av.status === 'finished') break;
      const active = av.view.currentPlayerId === av.view.viewingSeatId ? { session: alice, view: av.view } : { session: bob, view: bv.view };
      const action = active.view.phase === 'choose_target' ?
        { type: 'choose_target', targetSeatId: active.view.targetSeatIds[0] } :
        active.view.legalCardIds.length ? { type: 'play_card', cardId: active.view.legalCardIds[0] } : { type: 'draw_card' };
      const payload = { requestId: `turn-${turn}`, expectedRevision: av.revision, action };
      const result = await write(`${endpoint}/actions`, active.session, payload);
      expect(result.statusCode).toBe(200);
      if (result.json().data.status === 'finished') finalCommand = { session: active.session, payload };
    }
    const ended = (await read(`${endpoint}/view`, alice)).json().data;
    expect(ended.status).toBe('finished');
    expect(ended.view.winner).toBeTruthy();
    const finalReplay = await read(`${endpoint}/replay?revision=${ended.revision}`, alice);
    expect(finalReplay.statusCode).toBe(200);
    expect(finalReplay.json().data.view).toEqual(ended.view);
    expect((await db.query('SELECT count(*)::int AS count FROM match_replay_frames WHERE match_id=$1', [matchId])).rows[0].count).toBe(ended.revision + 1);
    expect((await db.query<{status:string;revision:number}>('SELECT status,revision FROM matches WHERE id=$1',[matchId])).rows[0]!.status).toBe('finished');
    const finalAction = await db.query<{actor_events:Array<{type:string}>}>(
      'SELECT actor_events FROM match_actions WHERE match_id=$1 ORDER BY revision DESC LIMIT 1', [matchId]);
    expect(finalAction.rows[0]!.actor_events.at(-1)?.type).toBe('game.win');
    expect((await write(`${endpoint}/actions`, alice, { requestId: 'after-win', expectedRevision: ended.revision,
      action: { type: 'draw_card' } })).statusCode).toBe(422);
    let room = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    expect(room).toMatchObject({ status: 'waiting', activeMatchId: null, matchStatus: null });
    expect(room.seats.every((seat: { ready: boolean }) => !seat.ready)).toBe(true);
    expect(room.permissions.canStart).toBe(false);
    for (const [index, session] of [alice, bob].entries()) {
      const ready = await write(`/api/v1/rooms/${roomId}/my-ready`, session,
        { requestId: `next-ready-${index}`, expectedRoomRevision: room.roomRevision, ready: true }, 'PUT');
      expect(ready.statusCode).toBe(200);
      room = ready.json().data;
    }
    const next = await write(`/api/v1/rooms/${roomId}/start`, alice,
      { requestId: 'next-start', expectedRoomRevision: room.roomRevision });
    expect(next.statusCode).toBe(200);
    expect(next.json().data.matchId).not.toBe(matchId);
    expect((await read(`${endpoint}/view`, alice)).json().data).toEqual(ended);
    expect((await write(`${endpoint}/actions`, alice, winner)).statusCode).toBe(200);
    expect(finalCommand).toBeDefined();
    const repeatedWin = await write(`${endpoint}/actions`, finalCommand!.session, finalCommand!.payload);
    expect(repeatedWin.statusCode).toBe(200);
    expect(repeatedWin.json().data).toMatchObject({status:'finished',revision:ended.revision,events:[]});
    expect((await read(`/api/v1/rooms/${roomId}`, alice)).json().data).toMatchObject({
      status: 'in_game', activeMatchId: next.json().data.matchId,
    });
  }, 60_000);

  it('sends each participant a separate live snapshot after a committed action', async () => {
    const { alice, bob, roomId, matchId } = await start();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('TCP address expected');
    const open = async (session: Session) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`, { origin, headers: { cookie: session.cookie } });
      const messages: unknown[] = [];
      socket.on('message', value => messages.push(JSON.parse(value.toString())));
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
      return { socket, messages };
    };
    const a = await open(alice), b = await open(bob);
    const wait = async (messages: unknown[], predicate: (message: any) => boolean) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found as any;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Live snapshot timed out');
    };
    try {
      await Promise.all([wait(a.messages, item => item.type === 'room.snapshot'), wait(b.messages, item => item.type === 'room.snapshot')]);
      const initial = await wait(a.messages, item => item.type === 'match.snapshot' && item.revision === 0);
      expect(initial.snapshot.delivery).toBe('snapshot');
      expect(initial.snapshot.events).toBeUndefined();
      const action = await write(`/api/v1/matches/${matchId}/actions`, alice,
        { requestId: 'live', expectedRevision: 0, action: { type: 'draw_card' } });
      expect(action.statusCode).toBe(200);
      const [av, bv] = await Promise.all([
        wait(a.messages, item => item.type === 'match.snapshot' && item.revision === 1),
        wait(b.messages, item => item.type === 'match.snapshot' && item.revision === 1),
      ]);
      expect(av.snapshot.view.myHand).toHaveLength(6);
      expect(bv.snapshot.view.myHand).toHaveLength(5);
      expect(av.snapshot.events[0].type).toBe('card.draw');
      expect(av.snapshot.events[0].eventId).toBe(`${matchId}:1:0`);
      expect(bv.snapshot.events[0].eventId).toBe(`${matchId}:1:0`);
      expect(JSON.stringify(bv)).not.toContain(av.snapshot.view.myHand.at(-1).id);
      expect(bv.snapshot.view.deck).toBeUndefined();
      const saved = (await db.query<{state:unknown}>('SELECT state FROM matches WHERE id=$1', [matchId])).rows[0]!;
      const win = winningPosition(saved.state);
      await db.query('UPDATE matches SET state=$2 WHERE id=$1', [matchId, win.state]);
      expect((await write(`/api/v1/matches/${matchId}/actions`, bob,
        { requestId: 'live-win', expectedRevision: 1, action: win.action })).statusCode).toBe(200);
      for (const client of [a, b]) {
        const finished = await wait(client.messages, item => item.type === 'match.snapshot' && item.snapshot.status === 'finished');
        expect(finished.snapshot.view.winner).toBeTruthy();
        const waiting = await wait(client.messages, item => item.type === 'room.snapshot' && item.snapshot.status === 'waiting');
        expect(waiting.snapshot.activeMatchId).toBeNull();
        expect(waiting.snapshot.seats.every((seat: {ready:boolean}) => !seat.ready)).toBe(true);
      }
    } finally { a.socket.terminate(); b.socket.terminate(); }
  });

  it('retains action receipts, returns them only to the actor, and never replays an old result', async () => {
    const { alice, bob, carol, matchId } = await start();
    const endpoint = `/api/v1/matches/${matchId}`;
    const request = { requestId: 'receipt-kept', expectedRevision: 0, action: { type: 'draw_card' } };
    const first = await write(`${endpoint}/actions`, alice, request);
    expect(first.statusCode).toBe(200);
    expect((await read(`${endpoint}/commands/receipt-kept`, alice)).json().data).toEqual({
      outcome: 'accepted', requestId: 'receipt-kept', appliedRevision: 1,
    });
    expect((await read(`${endpoint}/commands/receipt-kept`, bob)).json().data.outcome).toBe('not_found');
    expect((await read(`${endpoint}/commands/receipt-kept`, carol)).statusCode).toBe(404);
    await db.query("UPDATE command_receipts SET expires_at=now()-interval '1 day' WHERE operation=$1 AND request_id=$2", [
      `match.action:${matchId}`, 'receipt-kept',
    ]);
    const bobTurn = await write(`${endpoint}/actions`, bob, {
      requestId: 'receipt-kept', expectedRevision: 1, action: { type: 'draw_card' },
    });
    expect(bobTurn.statusCode).toBe(200);
    expect((await read(`${endpoint}/commands/receipt-kept`, bob)).json().data.appliedRevision).toBe(2);
    const repeated = await write(`${endpoint}/actions`, alice, request);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.revision).toBe(1);
    expect(repeated.json().data.events).toEqual([]);
    expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(2);
    expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1', [matchId])).rows[0]!.count).toBe('2');
  });

  it('blocks a match when its locked rule digest changes and preserves saved data', async () => {
    const { alice, matchId } = await start();
    await db.query('UPDATE matches SET rule_digest=$2 WHERE id=$1', [matchId, 'different-build']);
    const response = await read(`/api/v1/matches/${matchId}/view`, alice);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('RECOVERY_BLOCKED');
    expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(0);
  });

  it('does not substitute a different game build when the exact extension is unavailable', async () => {
    const { alice, matchId } = await start();
    const missing = createRegistry(false);
    missing.entries.delete('color-match@1.0.0');
    const separateDb = createDatabase(url!);
    const separate = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
      ENABLE_DEV_LAB: false, LOG_LEVEL: 'error',
    }, db: separateDb, registry: missing });
    try {
      const response = await separate.inject({ url: `/api/v1/matches/${matchId}/view`, headers: { cookie: alice.cookie } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('GAME_VERSION_UNAVAILABLE');
      expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(0);
    } finally { await separate.close(); }
  });

  it('serializes independent duplicate requests and a close racing an action', async () => {
    const { alice, bob, roomId, matchId } = await start();
    const endpoint = `/api/v1/matches/${matchId}`;
    const request = { requestId: 'same-concurrent', expectedRevision: 0, action: { type: 'draw_card' } };
    const duplicates = await Promise.all([
      write(`${endpoint}/actions`, alice, request),
      write(`${endpoint}/actions`, alice, request),
    ]);
    expect(duplicates.map(response => response.statusCode)).toEqual([200, 200]);
    expect(duplicates[0]!.json().data.revision).toBe(duplicates[1]!.json().data.revision);
    expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1', [matchId])).rows[0]!.count).toBe('1');
    const room = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    expect((await write(`/api/v1/rooms/${roomId}/close`, bob, {
      requestId: 'guest-close', expectedRoomRevision: room.roomRevision,
    })).statusCode).toBe(403);
    expect((await write(`/api/v1/rooms/${roomId}/leave`, bob, {
      requestId: 'guest-leave', expectedRoomRevision: room.roomRevision,
    })).statusCode).toBe(409);
    const closing = write(`/api/v1/rooms/${roomId}/close`, alice, {
      requestId: 'close-race', expectedRoomRevision: room.roomRevision,
    });
    const acting = write(`${endpoint}/actions`, bob, {
      requestId: 'action-race', expectedRevision: 1, action: { type: 'draw_card' },
    });
    const [closed, action] = await Promise.all([closing, acting]);
    expect(closed.statusCode).toBe(200);
    expect([200,422]).toContain(action.statusCode);
    const saved = await db.query<{status:string;revision:number}>('SELECT status,revision FROM matches WHERE id=$1', [matchId]);
    expect(saved.rows[0]!.status).toBe('aborted');
    expect(saved.rows[0]!.revision).toBe(action.statusCode === 200 ? 2 : 1);
    expect((await write(`${endpoint}/actions`, alice, {
      requestId: 'after-close', expectedRevision: saved.rows[0]!.revision, action: { type: 'draw_card' },
    })).statusCode).toBe(422);
    const repeated=await write(`/api/v1/rooms/${roomId}/close`,alice,{
      requestId:'close-race',expectedRoomRevision:room.roomRevision,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.roomRevision).toBe(closed.json().data.roomRevision);
  });

  it('isolates a damaged RNG snapshot without resetting the match', async () => {
    const { alice, matchId } = await start();
    await db.query('UPDATE matches SET rng_state=$2 WHERE id=$1', [matchId, { algorithm: 'unknown', state: 1 }]);
    const response = await read(`/api/v1/matches/${matchId}/view`, alice);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('RECOVERY_BLOCKED');
    expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(0);
  });

  it('returns retryable 503 during a database connection fault and resumes from persisted state', async () => {
    const { alice, matchId } = await start();
    const separateDb = createDatabase(url!);
    let unavailable = false;
    const failingDb = new Proxy(separateDb, {
      get(target, property) {
        if (property === 'query' || property === 'connect') return (...args: unknown[]) => {
          if (unavailable) return Promise.reject(Object.assign(new Error('connection unavailable'), { code: 'ECONNREFUSED' }));
          return Reflect.apply(Reflect.get(target, property), target, args);
        };
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const separate = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
      ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent',
    }, db: failingDb, registry: createRegistry(false) });
    try {
      unavailable = true;
      const denied = await separate.inject({ method: 'POST', url: `/api/v1/matches/${matchId}/actions`,
        headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf },
        payload: { requestId: 'outage-action', expectedRevision: 0, action: { type: 'draw_card' } },
      });
      expect(denied.statusCode).toBe(503);
      expect(denied.json().error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
      expect((await db.query<{revision:number}>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(0);
      unavailable = false;
      const recovered = await separate.inject({ url: `/api/v1/matches/${matchId}/view`, headers: { cookie: alice.cookie } });
      expect(recovered.json().data.revision).toBe(0);
      const retried = await separate.inject({ method: 'POST', url: `/api/v1/matches/${matchId}/actions`,
        headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf },
        payload: { requestId: 'outage-action', expectedRevision: 0, action: { type: 'draw_card' } },
      });
      expect(retried.statusCode).toBe(200);
      expect(retried.json().data.revision).toBe(1);
    } finally { await separate.close(); }
  });

  it('restores an aborted terminal match and rejects new actions after reloading', async () => {
    const { alice, roomId, matchId } = await start();
    const room = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    // Historical aborted saves remain recoverable; players cannot create new aborts.
    await db.query("UPDATE matches SET status='aborted' WHERE id=$1",[matchId]);
    const closed=await write(`/api/v1/rooms/${roomId}/close`,alice,{requestId:'terminal-close',expectedRoomRevision:room.roomRevision});
    expect(closed.statusCode).toBe(200);
    const separateDb = createDatabase(url!);
    const separate = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
      ENABLE_DEV_LAB: false, LOG_LEVEL: 'error',
    }, db: separateDb, registry: createRegistry(false) });
    try {
      const view = await separate.inject({ url: `/api/v1/matches/${matchId}/view`, headers: { cookie: alice.cookie } });
      expect(view.json().data.status).toBe('aborted');
      const denied = await separate.inject({ method: 'POST', url: `/api/v1/matches/${matchId}/actions`,
        headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf },
        payload: { requestId: 'terminal-action', expectedRevision: 0, action: { type: 'draw_card' } },
      });
      expect(denied.statusCode).toBe(422);
    } finally { await separate.close(); }
  });

  it('restores the pending target phase without replaying the card effect', async () => {
    const { alice, bob, matchId } = await start();
    const saved = await db.query<{state:any}>('SELECT state FROM matches WHERE id=$1', [matchId]);
    const state = saved.rows[0]!.state;
    const activeSeat = state.currentPlayerId as string;
    const topColor = state.discardPile.at(-1).color;
    if (!state.hands[activeSeat].some((card: any) => card.number === 5 && card.color === topColor)) {
      const index = state.deck.findIndex((card: any) => card.number === 5 && card.color === topColor);
      const source = index >= 0 ? state.deck : Object.values(state.hands).find((hand: any) =>
        hand !== state.hands[activeSeat] && hand.some((card: any) => card.number === 5 && card.color === topColor)) as any[] | undefined;
      if (!source) throw new Error('Expected another color-matching five');
      const sourceIndex = index >= 0 ? index : source.findIndex(card => card.number === 5 && card.color === topColor);
      [state.hands[activeSeat][0], source[sourceIndex]] = [source[sourceIndex], state.hands[activeSeat][0]];
      await db.query('UPDATE matches SET state=$2 WHERE id=$1', [matchId, state]);
    }
    const view = (await read(`/api/v1/matches/${matchId}/view`, alice)).json().data;
    const five = view.view.myHand.find((card: any) => card.number === 5 && card.color === topColor);
    const played = await write(`/api/v1/matches/${matchId}/actions`, alice, {
      requestId: 'play-five', expectedRevision: 0, action: { type: 'play_card', cardId: five.id },
    });
    expect(played.statusCode).toBe(200);
    expect(played.json().data.view.phase).toBe('choose_target');
    const separateDb = createDatabase(url!);
    const separate = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
      ENABLE_DEV_LAB: false, LOG_LEVEL: 'error',
    }, db: separateDb, registry: createRegistry(false) });
    try {
      const restored = await separate.inject({ url: `/api/v1/matches/${matchId}/view`, headers: { cookie: alice.cookie } });
      expect(restored.json().data.view.phase).toBe('choose_target');
      expect(restored.json().data.view.targetSeatIds).toHaveLength(1);
      const targetBefore = (await read(`/api/v1/matches/${matchId}/view`, bob)).json().data.view.myHand.length;
      const chosen = await separate.inject({ method: 'POST', url: `/api/v1/matches/${matchId}/actions`,
        headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf },
        payload: { requestId: 'choose-after-restore', expectedRevision: 1,
          action: { type: 'choose_target', targetSeatId: restored.json().data.view.targetSeatIds[0] } },
      });
      expect(chosen.statusCode).toBe(200);
      expect(chosen.json().data.revision).toBe(2);
      expect((await read(`/api/v1/matches/${matchId}/view`, bob)).json().data.view.myHand.length).toBe(targetBefore + 1);
    } finally { await separate.close(); }
  });

  it('restores the RNG before a reshuffle and matches deterministic continuation', async () => {
    const { alice, matchId } = await start();
    const row = (await db.query<{state:any;rng_state:unknown}>('SELECT state,rng_state FROM matches WHERE id=$1', [matchId])).rows[0]!;
    const state = row.state;
    state.discardPile.unshift(...state.deck);
    state.deck = [];
    await db.query('UPDATE matches SET state=$2 WHERE id=$1', [matchId, state]);
    const expectedRng = DeterministicRng.restore(row.rng_state);
    const expected = colorMatchExtension.applyAction(colorMatchExtension.deserialize(state),
      { kind: 'seat', seatId: state.currentPlayerId, controllerEpoch: 0 },
      { type: 'draw_card' }, expectedRng);
    const separateDb = createDatabase(url!);
    const separate = await createApp({ config: {
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
      ENABLE_DEV_LAB: false, LOG_LEVEL: 'error',
    }, db: separateDb, registry: createRegistry(false) });
    try {
      const result = await separate.inject({ method: 'POST', url: `/api/v1/matches/${matchId}/actions`,
        headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf },
        payload: { requestId: 'reshuffle-after-restore', expectedRevision: 0, action: { type: 'draw_card' } },
      });
      expect(result.statusCode).toBe(200);
      const actual = (await db.query<{state:unknown;rng_state:unknown}>('SELECT state,rng_state FROM matches WHERE id=$1', [matchId])).rows[0]!;
      expect(actual.state).toEqual(colorMatchExtension.serialize(expected.state));
      expect(actual.rng_state).toEqual(expectedRng.snapshot());
    } finally { await separate.close(); }
  });

  it('rolls back state, RNG, action and receipt when action storage fails', async () => {
    const { alice, roomId, matchId } = await start();
    const original = (await db.query<{state:unknown}>('SELECT state FROM matches WHERE id=$1', [matchId])).rows[0]!;
    const win = winningPosition(original.state);
    await db.query('UPDATE matches SET state=$2 WHERE id=$1', [matchId, win.state]);
    const roomBefore = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    const before = (await db.query<{state:unknown;rng_state:unknown;revision:number}>(
      'SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]!;
    await db.query(`CREATE FUNCTION stage4_fail_action_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'stage4 injected storage failure'; END $$`);
    await db.query('CREATE TRIGGER stage4_fail_action BEFORE INSERT ON match_actions FOR EACH ROW EXECUTE FUNCTION stage4_fail_action_write()');
    try {
      const failed = await write(`/api/v1/matches/${matchId}/actions`, alice, {
        requestId: 'failed-storage', expectedRevision: 0, action: win.action,
      });
      expect(failed.statusCode).toBe(500);
      const after = (await db.query<{state:unknown;rng_state:unknown;revision:number}>(
        'SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]!;
      expect(after).toEqual(before);
      expect((await db.query('SELECT revision FROM match_replay_frames WHERE match_id=$1', [matchId])).rows).toEqual([{ revision: 0 }]);
      expect((await read(`/api/v1/rooms/${roomId}`, alice)).json().data).toEqual(roomBefore);
      expect((await read(`/api/v1/matches/${matchId}/commands/failed-storage`, alice)).json().data.outcome).toBe('not_found');
      expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1', [matchId])).rows[0]!.count).toBe('0');
    } finally {
      await db.query('DROP TRIGGER stage4_fail_action ON match_actions');
      await db.query('DROP FUNCTION stage4_fail_action_write()');
    }
  });

  it('repairs a historical finished room and preserves participants when room capacity changes', async () => {
    const { alice, carol, roomId, matchId } = await start(3);
    const before = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    const migration = await readFile('apps/api/src/db/migrations/010_room_match_rounds.sql', 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Recreate the pre-010 constraints within this transaction only.
      await client.query('DROP INDEX matches_one_active_per_room');
      await client.query('DROP INDEX matches_room_history_idx');
      await client.query('ALTER TABLE matches ADD CONSTRAINT matches_room_id_key UNIQUE(room_id)');
      await client.query('ALTER TABLE match_participants ADD CONSTRAINT match_participants_seat_id_fkey FOREIGN KEY(seat_id) REFERENCES seats(id)');
      await client.query("UPDATE matches SET status='finished' WHERE id=$1", [matchId]);
      await client.query(migration);
      const repaired = (await client.query('SELECT status,active_match_id,room_revision FROM rooms WHERE id=$1', [roomId])).rows[0];
      expect(repaired).toEqual({status:'waiting',active_match_id:null,room_revision:before.roomRevision+1});
      expect((await client.query('SELECT ready FROM seats WHERE room_id=$1', [roomId])).rows.every(row=>!row.ready)).toBe(true);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    const historical = (await read(`/api/v1/matches/${matchId}/view`, carol)).json().data;
    expect((await write(`/api/v1/rooms/${roomId}/leave`, carol,
      {requestId:'leave-third',expectedRoomRevision:before.roomRevision+1})).statusCode).toBe(200);
    const room = (await read(`/api/v1/rooms/${roomId}`, alice)).json().data;
    const configured = await write(`/api/v1/rooms/${roomId}/config`, alice,
      {requestId:'shrink',expectedRoomRevision:room.roomRevision,name:'Next round',gameId:'color-match',version:'1.0.0',options:{},seatCount:2}, 'PATCH');
    expect(configured.statusCode).toBe(200);
    expect((await read(`/api/v1/matches/${matchId}/view`, carol)).json().data).toEqual(historical);
  });

  it('returns not_found during an in-flight command and applies same-ID retries once', async () => {
    const { alice, matchId } = await start();
    const account = await db.query<{id:string}>("SELECT id FROM accounts WHERE username_canonical='alice'");
    const requestId = 'in-flight-retry';
    const key = `request:${account.rows[0]!.id}:match.action:${matchId}:${requestId}`;
    const lock = await db.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
      const body = { requestId, expectedRevision: 0, action: { type: 'draw_card' } };
      const original = write(`/api/v1/matches/${matchId}/actions`, alice, body);
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (Date.now() < deadline) {
        const activity = await db.query<{count:string}>(
          "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_advisory_xact_lock%' AND wait_event_type='Lock'");
        waiting = Number(activity.rows[0]!.count) > 0;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect((await read(`/api/v1/matches/${matchId}/commands/${requestId}`, alice)).json().data.outcome).toBe('not_found');
      const retry = write(`/api/v1/matches/${matchId}/actions`, alice, body);
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
      const both = await Promise.all([original, retry]);
      expect(both.map(response => response.statusCode)).toEqual([200, 200]);
      expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1', [matchId])).rows[0]!.count).toBe('1');
    } finally {
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
      lock.release();
    }
  });

  it.each(['before', 'after'] as const)('recovers an action after a real API process exits %s COMMIT', async phase => {
    const { alice, matchId } = await start();
    const launch = async (crashPhase: string): Promise<{ child: ChildProcess; port: number }> => {
      const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tests/fixtures/match-crash-server.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, TEST_DATABASE_URL: url!, MATCH_CRASH_PHASE: crashPhase },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Child API did not become ready')), 10000);
        child.once('message', message => {
          clearTimeout(timeout);
          if (message && typeof message === 'object' && 'port' in message && typeof message.port === 'number') resolve(message.port);
          else reject(new Error('Child API returned an invalid address'));
        });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Child API exited before startup: ${code}`)));
      });
      return { child, port };
    };
    const payload = { requestId: `crash-${phase}`, expectedRevision: 0, action: { type: 'draw_card' } };
    const call = (port: number) => fetch(`http://127.0.0.1:${port}/api/v1/matches/${matchId}/actions`, {
      method: 'POST', headers: { origin, cookie: alice.cookie, 'x-csrf-token': alice.csrf, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const first = await launch(phase);
    try {
      const crashResponse = await call(first.port).catch(() => undefined);
      if (crashResponse) {
        const body = await crashResponse.json();
        throw new Error(`Crash action returned ${crashResponse.status} ${body.error?.code ?? 'unexpected response'}`);
      }
      await new Promise<void>((resolve, reject) => {
        if (first.child.exitCode !== null) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Crash hook was not reached')), 5000);
        first.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      const saved = await db.query<{ revision: number; rng_state: unknown }>('SELECT revision,rng_state FROM matches WHERE id=$1', [matchId]);
      expect(saved.rows[0]!.revision).toBe(phase === 'before' ? 0 : 1);
      const actionCount = await db.query<{ count: string }>('SELECT count(*) FROM match_actions WHERE match_id=$1', [matchId]);
      expect(actionCount.rows[0]!.count).toBe(phase === 'before' ? '0' : '1');
      const restarted = await launch('none');
      try {
        const receipt = await fetch(`http://127.0.0.1:${restarted.port}/api/v1/matches/${matchId}/commands/${payload.requestId}`, {
          headers: { cookie: alice.cookie },
        });
        expect((await receipt.json()).data.outcome).toBe(phase === 'before' ? 'not_found' : 'accepted');
        const retried = await call(restarted.port);
        expect(retried.status).toBe(200);
        expect((await retried.json()).data.revision).toBe(1);
        expect((await db.query<{ revision: number }>('SELECT revision FROM matches WHERE id=$1', [matchId])).rows[0]!.revision).toBe(1);
      } finally { restarted.child.kill(); }
    } finally { first.child.kill(); }
  }, 30000);

  it('runs a four-account game through the same authenticated action endpoint', async () => {
    const { sessions, matchId } = await start(4);
    const endpoint = `/api/v1/matches/${matchId}`;
    const four = sessions.slice(0, 4);
    for (let turn = 0; turn < 1000; turn++) {
      const snapshots = await Promise.all(four.map(session => read(`${endpoint}/view`, session)));
      const views = snapshots.map(response => response.json().data);
      if (views[0].status === 'finished') {
        expect(views[0].view.winners.length).toBeGreaterThan(0);
        expect((await db.query<{status:string}>('SELECT status FROM matches WHERE id=$1', [matchId])).rows[0]!.status).toBe('finished');
        return;
      }
      const index = views.findIndex(view => view.view.viewingSeatId === view.view.currentPlayerId);
      expect(index).toBeGreaterThanOrEqual(0);
      const active = views[index].view;
      const action = active.phase === 'choose_target'
        ? { type: 'choose_target', targetSeatId: active.targetSeatIds[0] }
        : active.legalCardIds.length
          ? { type: 'play_card', cardId: active.legalCardIds[0] }
          : { type: 'draw_card' };
      const response = await write(`${endpoint}/actions`, four[index]!,
        { requestId: `four-${turn}`, expectedRevision: views[index].revision, action });
      expect(response.statusCode).toBe(200);
    }
    throw new Error('Four-player game did not finish within 1000 actions');
  }, 60_000);
});

