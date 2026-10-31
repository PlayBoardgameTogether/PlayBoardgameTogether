import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { decideBasicAzul } from '../../games/azul/src/server/index.js';
import { viewSchema } from '../../games/azul/src/shared/index.js';


process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (url && url === process.env.DATABASE_URL) throw new Error('Refusing shared development database');
const origin = 'http://127.0.0.1:5173';
type Session = { cookie: string; csrf: string };

describe.skipIf(!url)('Azul formal action flow', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeEach(async () => {
    db = createDatabase(url!);
    // Cleanup must finish before the app starts its background recovery queries.
    await db.query('TRUNCATE accounts CASCADE');
    app = await createApp({ config: { NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false, LOG_LEVEL: 'error' }, db, registry: createRegistry(false) });
    for (const username of ['garden_a', 'garden_b', 'garden_c', 'garden_d']) await createAccount(db, { username, displayName: username, password: 'correct horse battery', role: 'user' });
  });
  afterEach(async () => { await app.close(); });
  async function login(username: string): Promise<Session> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: 'correct horse battery' } });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'], cookies = Array.isArray(raw) ? raw : [String(raw)];
    return { cookie: cookies.map(value => value.split(';')[0]).join('; '), csrf: response.json().data.csrfToken };
  }
  const write = (urlPath: string, session: Session, payload: object, method: 'POST' | 'PUT' = 'POST') => app.inject({ method, url: urlPath, headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf }, payload });
  const read = (urlPath: string, session: Session) => app.inject({ url: urlPath, headers: { cookie: session.cookie } });
  async function start(seatCount = 2, assetVersionId?: string) {
    const sessions = await Promise.all(['garden_a', 'garden_b', 'garden_c', 'garden_d'].map(login));
    const created = await write('/api/v1/rooms', sessions[0]!, { requestId: 'create', name: 'Azul', gameId: 'azul.base', version: '1.0.0', options: {}, seatCount });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    let revision = 0;
    if (assetVersionId) {
      const selected = await write(`/api/v1/rooms/${roomId}/assets`, sessions[0]!, {
        requestId: 'select-tts', expectedRoomRevision: revision, versionId: assetVersionId,
      }, 'PUT');
      expect(selected.statusCode).toBe(200);
      revision = selected.json().data.roomRevision;
    }
    for (let index = 1; index < seatCount; index++) {
      const joined = await write('/api/v1/rooms/join', sessions[index]!, { requestId: `join-${index}`, inviteCode });
      expect(joined.statusCode).toBe(200); revision = joined.json().data.roomRevision;
      const seated = await write(`/api/v1/rooms/${roomId}/my-seat`, sessions[index]!, { requestId: `seat-${index}`, expectedRoomRevision: revision, seatIndex: index }, 'PUT');
      expect(seated.statusCode).toBe(200); revision = seated.json().data.roomRevision;
    }
    for (let index = 0; index < seatCount; index++) {
      const ready = await write(`/api/v1/rooms/${roomId}/my-ready`, sessions[index]!, { requestId: `ready-${index}`, expectedRoomRevision: revision, ready: true }, 'PUT');
      expect(ready.statusCode).toBe(200); revision = ready.json().data.roomRevision;
    }
    const launched = await write(`/api/v1/rooms/${roomId}/start`, sessions[0]!, { requestId: 'start', expectedRoomRevision: revision });
    expect(launched.statusCode).toBe(200);
    return { sessions, roomId, matchId: launched.json().data.matchId as string };
  }
  it('projects names from fixed match participants, including after room seats change', async () => {
    const { sessions, matchId, roomId } = await start();
    const endpoint = '/api/v1/matches/' + matchId + '/view';
    const initial = (await read(endpoint, sessions[0]!)).json().data;
    expect(initial.players.map((player: { displayName: string }) => player.displayName)).toEqual(['garden_a', 'garden_b']);
    expect(initial.players.map((player: { seatId: string }) => player.seatId)).toEqual(initial.view.seats);
    expect(initial.players[0]).toEqual({
      seatId: initial.view.seats[0], seatIndex: 0, displayName: 'garden_a', occupantKind: 'human',
    });
    expect((await read(endpoint, sessions[2]!)).statusCode).toBe(404);
    await db.query("UPDATE accounts SET display_name='花砖好友' WHERE id=(SELECT account_id FROM match_participants WHERE match_id=$1 AND seat_index=1)", [matchId]);
    await db.query('UPDATE seats SET owner_account_id=NULL,ready=false WHERE room_id=$1 AND seat_index=1', [roomId]);
    const restored = (await read(endpoint, sessions[1]!)).json().data;
    expect(restored.players[1].displayName).toBe('花砖好友');
    expect(restored.players.map((player: { seatId: string }) => player.seatId)).toEqual(initial.view.seats);
    expect(restored.view.viewingSeatId).toBe(initial.view.seats[1]);
  });

  it('enforces actor, deduplication, conflicts, rollback, hidden bag and persisted recovery', async () => {
    const { sessions, matchId } = await start();
    const endpoint = '/api/v1/matches/' + matchId;
    const initial = (await read(endpoint + '/view', sessions[0]!)).json().data;
    const view = viewSchema.parse(initial.view);
    expect(view).not.toHaveProperty('bag');
    const payload = { requestId: 'draft-one', expectedRevision: 0, action: view.legalActions[0] };
    expect((await write(endpoint + '/actions', sessions[1]!, payload)).statusCode).toBe(422);
    expect((await read(endpoint + '/view', sessions[2]!)).statusCode).toBe(404);
    const before = (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
    expect((await write(endpoint + '/actions', sessions[0]!, { ...payload, action: { ...payload.action, source: 8 } })).statusCode).toBe(422);
    expect((await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]).toEqual(before);
    const results = await Promise.all([
      write(endpoint + '/actions', sessions[0]!, payload),
      write(endpoint + '/actions', sessions[0]!, { ...payload, requestId: 'race' }),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200,409]);
    const winner = results[0]!.statusCode === 200 ? payload : { ...payload, requestId: 'race' };
    expect((await write(endpoint + '/actions', sessions[0]!, winner)).statusCode).toBe(200);
    expect((await write(endpoint + '/actions', sessions[0]!, { ...winner, action: { ...winner.action, row: -1 } })).statusCode).toBe(409);
    expect((await read(endpoint + '/commands/' + winner.requestId, sessions[0]!)).json().data.outcome).toBe('accepted');
    const restored = (await read(endpoint + '/view', sessions[0]!)).json().data;
    expect(restored.revision).toBe(1);
    expect((await read(endpoint + '/view', sessions[0]!)).json().data.view).toEqual(restored.view);
  });
  it.each([2,3,4])('completes authenticated %i-player games and restores room readiness', async count => {
    const { sessions, roomId, matchId } = await start(count);
    const endpoint = '/api/v1/matches/' + matchId;
    let result = (await read(endpoint + '/view', sessions[0]!)).json().data;
    for (let step = 0; step < 700 && result.view.phase !== 'finished'; step++) {
      const session = sessions[result.view.seats.indexOf(result.view.currentSeatId)]!;
      result = (await read(endpoint + '/view', session)).json().data;
      const view = viewSchema.parse(result.view);
      const action = decideBasicAzul({ view, legalActions: view.legalActions });
      expect(action).not.toBeNull();
      const response = await write(endpoint + '/actions', session, { requestId: 'move-' + step, expectedRevision: result.revision, action });
      expect(response.statusCode).toBe(200);
      result = (await read(endpoint + '/view', sessions[0]!)).json().data;
    }
    expect(result.view.phase).toBe('finished');
    const room = (await read('/api/v1/rooms/' + roomId, sessions[0]!)).json().data;
    expect(room.status).toBe('waiting'); expect(room.activeMatchId).toBeNull();
    expect(room.seats.every((seat: { ready: boolean }) => !seat.ready)).toBe(true);
    expect((await read(endpoint + '/view', sessions[1]!)).json().data.status).toBe('finished');
  }, 30_000);
});
