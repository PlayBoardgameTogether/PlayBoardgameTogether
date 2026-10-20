import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRoomResponseSchema,
  matchViewSchema,
  roomStartedSchema,
  matchHistorySchema,
} from '../../packages/protocol/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { winningPosition } from '../fixtures/color-match-win.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
type Session = { cookie: string; csrf: string };

describe.skipIf(!url)('computer rooms and public match results', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    db = createDatabase(url!);
    app = await createApp({
      config: {
        NODE_ENV: 'test',
        DATABASE_URL: url!,
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
        AI_SCAN_INTERVAL_MS: 60000,
      },
      db,
      registry: createRegistry(false),
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    for (const username of ['alice', 'bob', 'carol'])
      await createAccount(db, {
        username,
        displayName: username,
        password: 'correct horse battery',
        role: 'user',
      });
  });
  async function login(username = 'alice'): Promise<Session> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'correct horse battery' },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return {
      cookie: (Array.isArray(raw) ? raw : [String(raw)])
        .map((item) => item.split(';')[0])
        .join('; '),
      csrf: response.json().data.csrfToken,
    };
  }
  const write = (method: 'POST' | 'PUT', path: string, session: Session, payload: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf },
      payload,
    });
  const read = (path: string, session: Session) =>
    app.inject({ url: path, headers: { cookie: session.cookie } });
  const input = (requestId: string) => ({
    requestId,
    name: '电脑桌',
    gameId: 'color-match',
    version: '1.0.0',
    options: {},
    seatCount: 3,
    visibility: 'private',
    computerOpponents: true,
  });

  async function start(session: Session, gameId = 'color-match', options = {}) {
    const computer = gameId !== 'demo.counter-room';
    const response = await write('POST', '/api/v1/rooms', session, {
      ...input('create'),
      seatCount: 2,
      gameId,
      options,
      ...(computer ? {} : { computerOpponents: undefined }),
    });
    expect(response.statusCode).toBe(200);
    const created = createRoomResponseSchema.parse(response.json().data);
    let revision = 0;
    if (!computer) {
      const bob = await login('bob');
      expect(
        (
          await write('POST', '/api/v1/rooms/join', bob, {
            requestId: 'join',
            inviteCode: created.inviteCode,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await write('PUT', `/api/v1/rooms/${created.roomId}/my-seat`, bob, {
            requestId: 'seat',
            expectedRoomRevision: 1,
            seatIndex: 1,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await write('PUT', `/api/v1/rooms/${created.roomId}/my-ready`, bob, {
            requestId: 'ready-bob',
            expectedRoomRevision: 2,
            ready: true,
          })
        ).statusCode,
      ).toBe(200);
      revision = 3;
    }
    expect(
      (
        await write('PUT', `/api/v1/rooms/${created.roomId}/my-ready`, session, {
          requestId: 'ready',
          expectedRoomRevision: revision,
          ready: true,
        })
      ).statusCode,
    ).toBe(200);
    const begun = await write('POST', `/api/v1/rooms/${created.roomId}/start`, session, {
      requestId: 'start',
      expectedRoomRevision: revision + 1,
    });
    expect(begun.statusCode).toBe(200);
    return { ...created, ...roomStartedSchema.parse(begun.json().data) };
  }

  it('creates only one private room with script seats, preserves ready/start receipts and rejects forged access', async () => {
    const alice = await login();
    const bob = await login('bob');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/rooms',
          headers: { origin },
          payload: input('unauth'),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await write('POST', '/api/v1/rooms', { ...alice, csrf: 'forged' }, input('csrf')))
        .statusCode,
    ).toBe(403);
    expect(
      (await write('POST', '/api/v1/rooms', alice, { ...input('public'), visibility: 'public' }))
        .statusCode,
    ).toBe(422);
    const responses = await Promise.all([
      write('POST', '/api/v1/rooms', alice, input('same')),
      write('POST', '/api/v1/rooms', alice, input('same')),
    ]);
    const created = responses.map((response) => {
      expect(response.statusCode).toBe(200);
      return createRoomResponseSchema.parse(response.json().data);
    });
    expect(created[0]!.roomId).toBe(created[1]!.roomId);
    const room = created[0]!;
    expect(room.room.seats.map((seat) => seat.occupantKind)).toEqual(['human', 'bot', 'bot']);
    expect(room.room.seats[0]!.ready).toBe(false);
    expect((await read('/api/v1/rooms/lobby', bob)).json().data.items).toEqual([]);
    expect(
      (await write('POST', '/api/v1/rooms', alice, { ...input('same'), seatCount: 2 })).json().error
        .code,
    ).toBe('REQUEST_ID_CONFLICT');
    expect((await write('POST', '/api/v1/rooms', alice, input('quota'))).statusCode).toBe(409);
    expect(
      (
        await write('POST', `/api/v1/rooms/${room.roomId}/start`, alice, {
          requestId: 'premature',
          expectedRoomRevision: 0,
        })
      ).json().error.code,
    ).toBe('NOT_ALL_READY');
    const ready = { requestId: 'ready', expectedRoomRevision: 0, ready: true };
    expect(
      (await write('PUT', `/api/v1/rooms/${room.roomId}/my-ready`, alice, ready)).statusCode,
    ).toBe(200);
    const command = { requestId: 'start', expectedRoomRevision: 1 };
    const first = await write('POST', `/api/v1/rooms/${room.roomId}/start`, alice, command);
    expect(first.statusCode).toBe(200);
    const { matchId } = roomStartedSchema.parse(first.json().data);
    expect(
      (await write('PUT', `/api/v1/rooms/${room.roomId}/my-ready`, alice, ready)).statusCode,
    ).toBe(200);
    expect(
      (await write('POST', `/api/v1/rooms/${room.roomId}/start`, alice, command)).json().data,
    ).toEqual({ matchId });
    expect(
      (await db.query('SELECT id FROM matches WHERE room_id=$1', [room.roomId])).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT controller_type,account_id FROM match_participants WHERE match_id=$1 AND occupant_kind='bot'",
          [matchId],
        )
      ).rows,
    ).toEqual([
      { controller_type: 'script', account_id: null },
      { controller_type: 'script', account_id: null },
    ]);
    expect((await read(`/api/v1/matches/${matchId}/view`, bob)).statusCode).toBe(404);
    expect(
      matchHistorySchema.parse((await read('/api/v1/profile/matches', bob)).json().data).items,
    ).toEqual([]);
  });

  it('rolls back partial bot creation and permits the same request to finish after storage recovery', async () => {
    const alice = await login();
    await db.query(`CREATE FUNCTION fail_computer_seat() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.occupant_kind='bot' THEN RAISE EXCEPTION 'seat storage failure'; END IF; RETURN NEW; END $$`);
    await db.query(
      'CREATE TRIGGER fail_computer_seat BEFORE INSERT ON seats FOR EACH ROW EXECUTE FUNCTION fail_computer_seat()',
    );
    try {
      expect((await write('POST', '/api/v1/rooms', alice, input('recover'))).statusCode).toBe(500);
      expect((await db.query('SELECT id FROM rooms')).rowCount).toBe(0);
      expect(
        (await db.query("SELECT request_id FROM command_receipts WHERE request_id='recover'"))
          .rowCount,
      ).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_computer_seat ON seats');
      await db.query('DROP FUNCTION fail_computer_seat()');
    }
    expect((await write('POST', '/api/v1/rooms', alice, input('recover'))).statusCode).toBe(200);
  });

  it('commits only public results with final actions and rolls them back with failed action storage', async () => {
    const alice = await login();
    const { matchId, roomId, room } = await start(alice);
    const seatId = room.seats[0]!.seatId;
    const saved = (
      await db.query<{ state: unknown }>('SELECT state FROM matches WHERE id=$1', [matchId])
    ).rows[0]!;
    const win = winningPosition(saved.state, seatId);
    await db.query('UPDATE matches SET state=$2 WHERE id=$1', [matchId, win.state]);
    const before = (
      await db.query('SELECT state,rng_state,revision,result_summary FROM matches WHERE id=$1', [
        matchId,
      ])
    ).rows[0];
    const action = { requestId: 'final', expectedRevision: 0, action: win.action };
    await db.query(
      `CREATE FUNCTION fail_result_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'action storage failure'; END $$`,
    );
    await db.query(
      'CREATE TRIGGER fail_result_action BEFORE INSERT ON match_actions FOR EACH ROW EXECUTE FUNCTION fail_result_action()',
    );
    try {
      expect(
        (await write('POST', `/api/v1/matches/${matchId}/actions`, alice, action)).statusCode,
      ).toBe(500);
      expect(
        (
          await db.query(
            'SELECT state,rng_state,revision,result_summary FROM matches WHERE id=$1',
            [matchId],
          )
        ).rows[0],
      ).toEqual(before);
      expect(
        (await db.query('SELECT revision FROM match_replay_frames WHERE match_id=$1', [matchId]))
          .rows,
      ).toEqual([{ revision: 0 }]);
      expect(
        (await db.query("SELECT request_id FROM command_receipts WHERE request_id='final'"))
          .rowCount,
      ).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_result_action ON match_actions');
      await db.query('DROP FUNCTION fail_result_action()');
    }
    const completed = await write('POST', `/api/v1/matches/${matchId}/actions`, alice, action);
    expect(completed.statusCode).toBe(200);
    const expected = {
      players: [
        { seatId, winner: true },
        { seatId: room.seats[1]!.seatId, winner: false },
      ],
    };
    expect(matchViewSchema.parse(completed.json().data).result).toEqual(expected);
    expect(
      (await db.query('SELECT result_summary FROM matches WHERE id=$1', [matchId])).rows[0]!
        .result_summary,
    ).toEqual(expected);
    expect(
      matchViewSchema.parse((await read(`/api/v1/matches/${matchId}/view`, alice)).json().data)
        .result,
    ).toEqual(expected);
    const history = matchHistorySchema.parse(
      (await read('/api/v1/profile/matches?gameId=color-match', alice)).json().data,
    );
    expect(history.items[0]!.result).toEqual({ winner: true, sharedWin: false });
    expect(
      (await read('/api/v1/profile/matches?gameId=azul.base', alice)).json().data.items,
    ).toEqual([]);
    expect(
      (await write('POST', `/api/v1/matches/${matchId}/actions`, alice, action)).statusCode,
    ).toBe(200);
    expect(
      (await db.query('SELECT id FROM match_actions WHERE match_id=$1', [matchId])).rowCount,
    ).toBe(1);
    expect((await read(`/api/v1/rooms/${roomId}`, alice)).json().data.status).toBe('waiting');
    await db.query('UPDATE matches SET result_summary=NULL WHERE id=$1', [matchId]);
    expect((await read('/api/v1/profile/matches', alice)).json().data.items[0].result).toBeNull();
  });

  it('shows real scores and keeps filtered cursor pages within the current account and game', async () => {
    const alice = await login();
    const outsider = await login('carol');
    const { matchId } = await start(alice, 'demo.counter-room', { targetScore: 2 });
    expect(
      (
        await write('POST', `/api/v1/matches/${matchId}/actions`, alice, {
          requestId: 'win-score',
          expectedRevision: 0,
          action: { type: 'add', payload: { value: 2 } },
        })
      ).statusCode,
    ).toBe(200);
    expect((await read('/api/v1/profile/matches', alice)).json().data.items[0].result).toEqual({
      winner: true,
      sharedWin: false,
      score: 2,
    });
    await db.query(
      `WITH copies AS (
      INSERT INTO matches(id,room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,status,created_at,result_summary)
      SELECT gen_random_uuid(),room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,status,created_at,result_summary
      FROM matches CROSS JOIN generate_series(1,22) WHERE id=$1 RETURNING id)
      INSERT INTO match_participants(match_id,seat_id,account_id,seat_index)
      SELECT copies.id,p.seat_id,p.account_id,p.seat_index FROM copies CROSS JOIN match_participants p
      WHERE p.match_id=$1 AND p.account_id IS NOT NULL`,
      [matchId],
    );
    const first = matchHistorySchema.parse(
      (await read('/api/v1/profile/matches?gameId=demo.counter-room', alice)).json().data,
    );
    expect(first.items).toHaveLength(20);
    const second = matchHistorySchema.parse(
      (
        await read(
          `/api/v1/profile/matches?gameId=demo.counter-room&before=${first.nextCursor}`,
          alice,
        )
      ).json().data,
    );
    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(23);
    expect(
      (
        await read(`/api/v1/profile/matches?gameId=color-match&before=${first.nextCursor}`, alice)
      ).json().data.items,
    ).toEqual([]);
    expect(
      (await read(`/api/v1/profile/matches?before=${first.nextCursor}`, outsider)).json().data
        .items,
    ).toEqual([]);
  });
});
