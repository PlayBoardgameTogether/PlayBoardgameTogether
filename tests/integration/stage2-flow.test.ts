import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import WebSocket from 'ws';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createApp} from '../../apps/api/src/app.js';import {createDatabase,type Database} from '../../apps/api/src/db/index.js';import {createRegistry} from '../../apps/api/src/registry/index.js';import {createAccount} from '../../apps/api/src/auth.js';
import { RoomService } from '../../apps/api/src/rooms.js';
import { normalizeConfig } from '../../apps/api/src/config.js';
process.loadEnvFile('.env');const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('stage 2 account to initial match flow',()=>{let db:Database;let app:Awaited<ReturnType<typeof createApp>>;let registry:ReturnType<typeof createRegistry>;const origin='http://127.0.0.1:5173';
  beforeEach(async () => {
    db = createDatabase(url!);
    registry = createRegistry(false);
    // Recovery queries must not overlap TRUNCATE's locks on dependent tables.
    await db.query('TRUNCATE accounts CASCADE');
    app = await createApp({
      config: {
        NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001,
        DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent', PRESENCE_GRACE_MS: 100,
      },
      db,
      registry,
    });
    for (const [username, displayName] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol']]) {
      await createAccount(db, { username, displayName, password: 'correct horse battery', role: 'user' });
    }
  });
  afterEach(async () => { await app.close(); });
  async function login(username:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password:'correct horse battery'}});expect(r.statusCode).toBe(200);const raw=r.headers['set-cookie'];const values=Array.isArray(raw)?raw:[String(raw)];const cookie=values.map(v=>v.split(';')[0]).join('; ');return{cookie,csrf:r.json().data.csrfToken};}
  const write=(method:string,url:string,session:{cookie:string;csrf:string},payload:unknown)=>app.inject({method:method as any,url,headers:{origin,cookie:session.cookie,'x-csrf-token':session.csrf},payload});
  it('keeps a healthy subscribed room alive and reclaims it after disconnect', async () => {
    const a = await login('alice');
    const created = await write('POST', '/api/v1/rooms', a, { requestId: 'idle-ws', name: '在线桌', gameId: 'demo.counter-room', version: '1.0.0', options: { targetScore: 3 }, seatCount: 2 });
    const roomId = created.json().data.roomId;
    const service = new RoomService(db, registry, normalizeConfig({ NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent' }));
    if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`, { origin, headers: { cookie: a.cookie } });
    try {
      const snapshot = new Promise<void>(resolve => socket.on('message', raw => {
        if (JSON.parse(raw.toString()).type === 'room.snapshot') resolve();
      }));
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
      await snapshot;
      await db.query("UPDATE rooms SET last_activity_at=now()-interval '31 minutes' WHERE id=$1", [roomId]);
      const deadline = Date.now() + 7000;
      let renewed = false;
      while (Date.now() < deadline) {
        renewed = (await db.query<{ renewed: boolean }>("SELECT last_activity_at>now()-interval '1 minute' AS renewed FROM rooms WHERE id=$1", [roomId])).rows[0]!.renewed;
        if (renewed) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(renewed).toBe(true);
      expect(await service.closeIdleRooms()).toEqual([]);
      await new Promise<void>(resolve => { socket.once('close', resolve); socket.close(); });
      await db.query("UPDATE rooms SET last_activity_at=now()-interval '31 minutes' WHERE id=$1", [roomId]);
      expect(await service.closeIdleRooms()).toEqual([roomId]);
    } finally { socket.terminate(); }
  }, 15_000);
  it('reclaims abandoned rooms atomically, retains history and releases creator quota', async () => {
    const a = await login('alice'), b = await login('bob');
    const created = await write('POST', '/api/v1/rooms', a, {
      requestId: 'idle-create', name: '无人桌', gameId: 'demo.counter-room',
      version: '1.0.0', options: { targetScore: 3 }, seatCount: 2, visibility: 'public',
    });
    const { roomId, inviteCode } = created.json().data;
    await write('POST', '/api/v1/rooms/join', b, { requestId: 'idle-join', inviteCode });
    await write('PUT', `/api/v1/rooms/${roomId}/my-seat`, b, { requestId: 'idle-seat', expectedRoomRevision: 1, seatIndex: 1 });
    await write('PUT', `/api/v1/rooms/${roomId}/my-ready`, a, { requestId: 'idle-ready-a', expectedRoomRevision: 2, ready: true });
    await write('PUT', `/api/v1/rooms/${roomId}/my-ready`, b, { requestId: 'idle-ready-b', expectedRoomRevision: 3, ready: true });
    const started = await write('POST', `/api/v1/rooms/${roomId}/start`, a, { requestId: 'idle-start', expectedRoomRevision: 4 });
    expect(started.statusCode).toBe(200);
    const matchId = started.json().data.matchId;
    const service = new RoomService(db, registry, normalizeConfig({ NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent' }));
    const notified: string[] = [];
    service.onChanged(id => notified.push(id));
    const expire = () => db.query("UPDATE rooms SET last_activity_at=now()-interval '31 minutes' WHERE id=$1", [roomId]);
    await expire();
    const outsider = (await db.query<{ id: string }>("SELECT id FROM accounts WHERE username_canonical='carol'")).rows[0]!.id;
    await service.recordActivity(roomId, outsider);
    expect((await app.inject({ url: `/api/v1/rooms/${roomId}`, headers: { cookie: (await login('carol')).cookie } })).statusCode).toBe(404);
    // An authorized visit renews without changing business revision.
    expect((await app.inject({ url: `/api/v1/rooms/${roomId}`, headers: { cookie: b.cookie } })).json().data.roomRevision).toBe(5);
    expect(await service.closeIdleRooms()).toEqual([]);
    await expire();
    // A concurrent member renewal holds the same row lock; cleanup skips it.
    const renewal = await db.connect();
    try {
      await renewal.query('BEGIN');
      await renewal.query('UPDATE rooms SET last_activity_at=clock_timestamp() WHERE id=$1', [roomId]);
      expect(await service.closeIdleRooms()).toEqual([]);
      await renewal.query('COMMIT');
      expect(await service.closeIdleRooms()).toEqual([]);
    } finally { await renewal.query('ROLLBACK'); renewal.release(); }
    await expire();
    // Listing the lobby/member rooms must not renew an abandoned room.
    await app.inject({ url: '/api/v1/rooms', headers: { cookie: a.cookie } });
    await db.query(`CREATE FUNCTION fail_idle_close() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='closed' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER fail_idle_close BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION fail_idle_close()');
    try {
      await expect(service.closeIdleRooms()).rejects.toThrow('test rollback');
      expect((await db.query('SELECT status FROM matches WHERE id=$1', [matchId])).rows[0].status).toBe('active');
      expect(notified).toEqual([]);
    } finally {
      await db.query('DROP TRIGGER fail_idle_close ON rooms');
      await db.query('DROP FUNCTION fail_idle_close()');
    }
    expect(await service.closeIdleRooms()).toEqual([roomId]);
    expect(await service.closeIdleRooms()).toEqual([]);
    expect(notified).toEqual([roomId]);
    expect((await service.snapshot(roomId, outsider).catch(() => null))).toBeNull();
    expect((await db.query('SELECT status,room_revision FROM rooms WHERE id=$1', [roomId])).rows[0]).toMatchObject({ status: 'closed', room_revision: 6 });
    expect((await db.query('SELECT status FROM matches WHERE id=$1', [matchId])).rows[0].status).toBe('aborted');
    expect((await db.query('SELECT * FROM match_participants WHERE match_id=$1', [matchId])).rowCount).toBe(2);
    expect((await db.query('SELECT * FROM room_invites WHERE room_id=$1', [roomId])).rowCount).toBe(0);
    expect((await app.inject({ url: '/api/v1/rooms/lobby?status=waiting', headers: { cookie: a.cookie } })).json().data.items).toEqual([]);
    expect((await write('POST', '/api/v1/rooms', a, { requestId: 'after-idle', name: '新桌', gameId: 'demo.counter-room', version: '1.0.0', options: { targetScore: 3 }, seatCount: 2 })).statusCode).toBe(200);
    const waiting = (await db.query<{ id: string }>("SELECT id FROM rooms WHERE status='waiting'")).rows[0]!.id;
    await db.query("UPDATE rooms SET last_activity_at=now()-interval '31 minutes' WHERE id=$1", [waiting]);
    expect(await service.closeIdleRooms()).toEqual([waiting]);
  });
  it('persists only the signed-in profile and rejects unsafe or forged updates', async () => {
    const a = await login('alice'), b = await login('bob');
    const input = { displayName: '新昵称', avatar: 'cat', bio: '周末一起玩桌游' };
    expect((await app.inject({ url: '/api/v1/profile' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/profile', headers: { cookie: a.cookie, origin }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/profile', headers: { cookie: a.cookie, origin: 'https://invalid.example', 'x-csrf-token': a.csrf }, payload: input })).statusCode).toBe(403);
    const bob = (await app.inject({ url: '/api/v1/profile', headers: { cookie: b.cookie } })).json().data;
    for (const invalid of [{ ...input, accountId: bob.id }, { ...input, avatar: 'https://invalid.example/a.png' }, { ...input, bio: 'x'.repeat(301) }, { ...input, displayName: '   ' }]) {
      expect((await write('PUT', '/api/v1/profile', a, invalid)).statusCode).toBe(400);
    }
    expect((await write('PUT', '/api/v1/profile', a, input)).statusCode).toBe(200);
    const saved = await app.inject({ url: '/api/v1/profile', headers: { cookie: a.cookie } });
    expect(saved.json().data).toMatchObject(input);
    expect(saved.body).not.toMatch(/password_hash|token_hash|csrf/);
    expect((await app.inject({ url: '/api/v1/profile', headers: { cookie: b.cookie } })).json().data).toEqual(bob);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: a.cookie } })).json().data.account.displayName).toBe(input.displayName);
  });
  it('lists only fixed participants history after room closure and paginates without repeats', async () => {
    const a = await login('alice'), b = await login('bob'), c = await login('carol');
    const created = await write('POST', '/api/v1/rooms', a, { requestId: 'history-create', name: '历史桌', gameId: 'demo.counter-room', version: '1.0.0', options: { targetScore: 3 }, seatCount: 2 });
    const { roomId, inviteCode } = created.json().data;
    await write('POST', '/api/v1/rooms/join', b, { requestId: 'history-join', inviteCode });
    await write('PUT', `/api/v1/rooms/${roomId}/my-seat`, b, { requestId: 'history-seat', expectedRoomRevision: 1, seatIndex: 1 });
    await write('PUT', `/api/v1/rooms/${roomId}/my-ready`, a, { requestId: 'history-ready-a', expectedRoomRevision: 2, ready: true });
    await write('PUT', `/api/v1/rooms/${roomId}/my-ready`, b, { requestId: 'history-ready-b', expectedRoomRevision: 3, ready: true });
    const started = await write('POST', `/api/v1/rooms/${roomId}/start`, a, { requestId: 'history-start', expectedRoomRevision: 4 });
    expect(started.statusCode).toBe(200);
    const matchId = started.json().data.matchId;
    const history = (session: { cookie: string }, before?: string) => app.inject({ url: `/api/v1/profile/matches${before ? `?before=${before}` : ''}`, headers: { cookie: session.cookie } });
    expect((await history(a)).json().data.items).toMatchObject([{ id: matchId, status: 'active' }]);
    expect((await history(c)).json().data.items).toEqual([]);
    expect((await history(c, matchId)).json().data.items).toEqual([]);
    expect((await write('POST', `/api/v1/rooms/${roomId}/close`, a, { requestId: 'history-close', expectedRoomRevision: 5 })).statusCode).toBe(200);
    expect((await history(b)).json().data.items).toMatchObject([{ id: matchId, status: 'aborted' }]);
    // Add retained historical rounds with identical timestamps to exercise UUID tie-breaking.
    await db.query(`WITH copies AS (
      INSERT INTO matches(id,room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,status,created_at)
      SELECT gen_random_uuid(),room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,'finished',created_at
      FROM matches CROSS JOIN generate_series(1,24) WHERE id=$1 RETURNING id)
      INSERT INTO match_participants(match_id,seat_id,account_id,seat_index)
      SELECT copies.id,p.seat_id,p.account_id,p.seat_index FROM copies CROSS JOIN match_participants p WHERE p.match_id=$1`, [matchId]);
    const first = (await history(a)).json().data;
    const second = (await history(a, first.nextCursor)).json().data;
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(25);
    expect(JSON.stringify(first)).not.toMatch(/rng_state|actor_view|state_schema|inviteCode/);
    expect((await app.inject({ url: '/api/v1/profile/matches' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/profile/matches?before=invalid', headers: { cookie: a.cookie } })).statusCode).toBe(400);
  });
  it('allows only one open room per creator even for competing request ids', async () => {
    const host = await login('alice');
    const body = {name:'Quota', gameId:'demo.counter-room', version:'1.0.0', options:{targetScore:3}, seatCount:2};
    const responses = await Promise.all(['quota-a','quota-b'].map(requestId => write('POST','/api/v1/rooms',host,{...body,requestId})));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200,409]);
    const room=responses.find(response=>response.statusCode===200)!.json().data;
    const requestId=responses[0]!.statusCode===200?'quota-a':'quota-b';
    expect((await write('POST','/api/v1/rooms',host,{...body,requestId})).json().data.roomId).toBe(room.roomId);
    expect((await write('POST',`/api/v1/rooms/${room.roomId}/close`,host,{requestId:'close-quota',expectedRoomRevision:0})).statusCode).toBe(200);
    expect((await write('POST','/api/v1/rooms',host,{...body,requestId:'after-close'})).statusCode).toBe(200);
  });
  it('lists public rooms without secrets and checks passwords on both join paths', async () => {
    const host = await login('alice'), guest = await login('bob');
    const created = await write('POST','/api/v1/rooms',host,{requestId:'public',name:'Public table',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2,visibility:'public',password:'table-secret'});
    expect(created.statusCode).toBe(200);
    const {roomId,inviteCode} = created.json().data;
    const listed = await app.inject({url:'/api/v1/rooms/lobby?gameId=demo.counter-room&roomType=password&status=waiting',headers:{cookie:guest.cookie}});
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items).toHaveLength(1);
    expect(listed.json().data.items[0]).toMatchObject({hostDisplayName:'Alice',hostFriendId:'alice'});
    expect(listed.body).not.toContain('table-secret');
    expect(listed.body).not.toContain(inviteCode);
    expect(listed.body).not.toContain('password_hash');
    expect((await write('POST','/api/v1/rooms/join',guest,{requestId:'wrong',inviteCode,password:'wrong'})).statusCode).toBe(403);
    expect((await write('POST',`/api/v1/rooms/${roomId}/join`,guest,{requestId:'join-public',password:'table-secret'})).statusCode).toBe(200);
    expect((await write('POST',`/api/v1/rooms/${roomId}/join`,guest,{requestId:'join-public',password:'table-secret'})).statusCode).toBe(200);
    expect((await write('POST',`/api/v1/rooms/${roomId}/join`,guest,{requestId:'join-public',password:'different'})).statusCode).toBe(409);
    const stored=(await db.query<{password_hash:string}>('SELECT password_hash FROM rooms WHERE id=$1',[roomId])).rows[0]!;
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.password_hash).not.toContain('table-secret');
    const receipt=await db.query('SELECT result_ref FROM command_receipts WHERE room_id=$1',[roomId]);
    expect(JSON.stringify(receipt.rows)).not.toContain('table-secret');
    const publicWithoutPassword=await app.inject({url:'/api/v1/rooms/lobby?roomType=open',headers:{cookie:guest.cookie}});
    expect(publicWithoutPassword.json().data.items).toHaveLength(0);
    const otherGame=await app.inject({url:'/api/v1/rooms/lobby?gameId=color-match',headers:{cookie:guest.cookie}});
    expect(otherGame.json().data.items).toHaveLength(0);
    const finished=await app.inject({url:'/api/v1/rooms/lobby?status=finished',headers:{cookie:guest.cookie}});
    expect(finished.json().data.items).toHaveLength(0);
    expect((await app.inject({url:'/api/v1/rooms/lobby'})).statusCode).toBe(401);
  });
  it('lists the current host identity and reflects profile edits and host transfers', async () => {
    const a = await login('alice'), b = await login('bob'), c = await login('carol');
    const created = await write('POST', '/api/v1/rooms', a, {
      requestId: 'host-identity-create', name: 'Host identity', gameId: 'demo.counter-room',
      version: '1.0.0', options: { targetScore: 3 }, seatCount: 2, visibility: 'public',
    });
    const roomId = created.json().data.roomId;
    const list = () => app.inject({url:'/api/v1/rooms/lobby',headers:{cookie:c.cookie}});
    expect((await list()).json().data.items[0]).toMatchObject({hostDisplayName:'Alice',hostFriendId:'alice'});
    expect((await write('PUT', '/api/v1/profile', a, {displayName:'新房主昵称',avatar:'cat',bio:''})).statusCode).toBe(200);
    const identity = (await app.inject({url:'/api/v1/social',headers:{cookie:a.cookie}})).json().data.identity;
    expect((await write('PUT', '/api/v1/social/id', a, {
      requestId: crypto.randomUUID(), expectedRevision: identity.revision, friendId: '@new_alice',
    })).statusCode).toBe(200);
    expect((await list()).json().data.items[0]).toMatchObject({hostDisplayName:'新房主昵称',hostFriendId:'new_alice'});
    expect((await write('POST', `/api/v1/rooms/${roomId}/join`, b, {requestId:'host-identity-join'})).statusCode).toBe(200);
    const bob = (await db.query<{id:string}>("SELECT id FROM accounts WHERE username_canonical='bob'")).rows[0]!.id;
    expect((await write('POST', `/api/v1/rooms/${roomId}/host`, a, {
      requestId:'host-identity-transfer',expectedRoomRevision:1,targetAccountId:bob,
    })).statusCode).toBe(200);
    const listed = await list();
    expect(listed.json().data.items[0]).toMatchObject({hostDisplayName:'Bob',hostFriendId:'bob'});
    expect(listed.body).not.toMatch(/username|hostAccountId|password_hash|token_hash|csrf|members/);
    expect(listed.body).not.toContain(bob);
  });
  it('keeps private rooms out of the lobby and preserves creator quota after host transfer',async()=>{
    const a=await login('alice'),b=await login('bob'),c=await login('carol');
    const body={requestId:'private-create',name:'Hidden',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};
    const created=(await write('POST','/api/v1/rooms',a,body)).json().data;
    expect((await app.inject({url:'/api/v1/rooms/lobby',headers:{cookie:c.cookie}})).json().data.items).toEqual([]);
    expect((await write('POST',`/api/v1/rooms/${created.roomId}/join`,c,{requestId:'guess-id'})).statusCode).toBe(404);
    await write('POST','/api/v1/rooms/join',b,{requestId:'private-join',inviteCode:created.inviteCode});
    const bob=(await db.query<{id:string}>("SELECT id FROM accounts WHERE username_canonical='bob'")).rows[0]!.id;
    expect((await write('POST',`/api/v1/rooms/${created.roomId}/host`,a,{requestId:'transfer',expectedRoomRevision:1,targetAccountId:bob})).statusCode).toBe(200);
    expect((await write('POST','/api/v1/rooms',a,{...body,requestId:'bypass-quota'})).statusCode).toBe(409);
    expect((await write('POST','/api/v1/rooms',b,{...body,requestId:'own-quota',visibility:'public'})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/v1/rooms/lobby',headers:{cookie:c.cookie}})).json().data.items).toHaveLength(1);
  });
  it('paginates public rooms without repeats and filters closed rooms',async()=>{
    const a=await login('alice'),b=await login('bob');
    const body={requestId:'public-page',name:'Table',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2,visibility:'public'};
    const first=(await write('POST','/api/v1/rooms',a,body)).json().data;
    const second=(await write('POST','/api/v1/rooms',b,body)).json().data;
    const page=(await app.inject({url:'/api/v1/rooms/lobby?limit=1',headers:{cookie:a.cookie}})).json().data;
    expect(page.items).toHaveLength(1);expect(page.nextCursor).toBeTruthy();
    const next=(await app.inject({url:`/api/v1/rooms/lobby?limit=1&cursor=${page.nextCursor}`,headers:{cookie:a.cookie}})).json().data;
    expect(next.nextCursor).toBeNull();
    expect(new Set([page.items[0].id,next.items[0].id])).toEqual(new Set([first.roomId,second.roomId]));
    await write('POST',`/api/v1/rooms/${first.roomId}/close`,a,{requestId:'close-listed',expectedRoomRevision:0});
    const closed=(await app.inject({url:'/api/v1/rooms/lobby?status=closed',headers:{cookie:b.cookie}})).json().data;
    expect(closed.items.map((room:{id:string})=>room.id)).toEqual([first.roomId]);
    const waiting=(await app.inject({url:'/api/v1/rooms/lobby?status=waiting',headers:{cookie:b.cookie}})).json().data;
    expect(waiting.items.map((room:{id:string})=>room.id)).toEqual([second.roomId]);
  });
  it('keeps room revision and members on one database snapshot during a concurrent join', async () => {
    const host = await login('alice');
    const created = await write('POST', '/api/v1/rooms', host, {
      requestId: 'snapshot-create', name: 'Snapshot', gameId: 'demo.counter-room',
      version: '1.0.0', options: { targetScore: 3 }, seatCount: 2,
    });
    expect(created.statusCode).toBe(200);
    const roomId = created.json().data.roomId as string;
    const hostId = (await db.query<{ id: string }>("SELECT id FROM accounts WHERE username_canonical='alice'")).rows[0]!.id;
    const firstRead = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let paused = false;
    const snapshotDb = {
      connect: async () => {
        const client = await db.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === 'query') {
              return async (...args: unknown[]) => {
                const result = await (target.query as (...queryArgs: unknown[]) => Promise<unknown>).apply(target, args);
                if (!paused && args[0] === 'SELECT * FROM rooms WHERE id=$1') {
                  paused = true;
                  firstRead.resolve();
                  await resume.promise;
                }
                return result;
              };
            }
            if (property === 'release') return target.release.bind(target);
            return Reflect.get(target, property);
          },
        });
      },
    } as unknown as Database;
    const service = new RoomService(snapshotDb, registry, normalizeConfig({
      NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 3001,
      DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent',
    }));
    const pending = service.snapshot(roomId, hostId);
    await firstRead.promise;
    try {
      await db.query(`WITH joined AS (
        INSERT INTO room_members(room_id, account_id)
        SELECT $1, id FROM accounts WHERE username_canonical='bob'
        RETURNING room_id
      ) UPDATE rooms SET room_revision=room_revision+1
        WHERE id=(SELECT room_id FROM joined)`, [roomId]);
    } finally {
      resume.resolve();
    }
    const duringJoin = await pending;
    expect(duringJoin.roomRevision).toBe(0);
    expect(duringJoin.members.map(member => member.displayName)).toEqual(['Alice']);
    const afterJoin = await service.snapshot(roomId, hostId);
    expect(afterJoin.roomRevision).toBe(1);
    expect(afterJoin.members.map(member => member.displayName)).toEqual(['Alice', 'Bob']);
  });
  it('creates, joins, seats, readies, starts once, and isolates participant views',async()=>{const a=await login('alice'),b=await login('bob'),c=await login('carol');const created=await write('POST','/api/v1/rooms',a,{requestId:'create-1',name:'Friday',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});expect(created.statusCode).toBe(200);const first=created.json().data;expect(first.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);const id=first.roomId;const joined=await write('POST','/api/v1/rooms/join',b,{requestId:'join-1',inviteCode:first.inviteCode});expect(joined.json().data.roomRevision).toBe(1);expect((await write('PUT',`/api/v1/rooms/${id}/my-seat`,b,{requestId:'seat-b',expectedRoomRevision:1,seatIndex:1})).statusCode).toBe(200);expect((await write('PUT',`/api/v1/rooms/${id}/my-ready`,a,{requestId:'ready-a',expectedRoomRevision:2,ready:true})).statusCode).toBe(200);expect((await write('PUT',`/api/v1/rooms/${id}/my-ready`,b,{requestId:'ready-b',expectedRoomRevision:3,ready:true})).statusCode).toBe(200);const started=await write('POST',`/api/v1/rooms/${id}/start`,a,{requestId:'start-1',expectedRoomRevision:4});expect(started.statusCode).toBe(200);const matchId=started.json().data.matchId;const repeated=await write('POST',`/api/v1/rooms/${id}/start`,a,{requestId:'start-1',expectedRoomRevision:4});expect(repeated.json().data.matchId).toBe(matchId);const av=await app.inject({url:`/api/v1/matches/${matchId}/view`,headers:{cookie:a.cookie}});const bv=await app.inject({url:`/api/v1/matches/${matchId}/view`,headers:{cookie:b.cookie}});expect(av.json().data.view.myHint).not.toBe(bv.json().data.view.myHint);expect(av.json().data.view.privateHints).toBeUndefined();const denied=await app.inject({url:`/api/v1/matches/${matchId}/view`,headers:{cookie:c.cookie}});expect(denied.statusCode).toBe(404);expect(denied.json().error.code).toBe('MATCH_NOT_FOUND');});
  it('rejects missing origin and CSRF and makes request ids content-bound',async()=>{const a=await login('alice');const noOrigin=await app.inject({method:'POST',url:'/api/v1/rooms',headers:{cookie:a.cookie,'x-csrf-token':a.csrf},payload:{}});expect(noOrigin.statusCode).toBe(403);const body={requestId:'same',name:'One',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};expect((await write('POST','/api/v1/rooms',a,body)).statusCode).toBe(200);const conflict=await write('POST','/api/v1/rooms',a,{...body,name:'Different'});expect(conflict.statusCode).toBe(409);expect(conflict.json().error.code).toBe('REQUEST_ID_CONFLICT');});
  it('keeps password and token material out of responses and rejects missing or forged CSRF',async()=>{
    const a=await login('alice');const password='correct horse battery';
    const account=(await db.query<{password_hash:string}>("SELECT password_hash FROM accounts WHERE username_canonical='alice'")).rows[0]!;
    expect(account.password_hash).not.toBe(password);expect(account.password_hash).toMatch(/^\$argon2id\$/);
    const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie:a.cookie}});
    expect(me.statusCode).toBe(200);expect(me.body).not.toContain(password);expect(me.body).not.toContain(account.password_hash);
    const rawToken=/boardgame_session=([^;]+)/.exec(a.cookie)?.[1];expect(rawToken).toBeTruthy();
    expect((await db.query('SELECT id FROM sessions WHERE token_hash=$1',[rawToken])).rowCount).toBe(0);
    const body={requestId:'csrf',name:'Protected',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};
    const missing=await app.inject({method:'POST',url:'/api/v1/rooms',headers:{origin,cookie:a.cookie},payload:body});expect(missing.statusCode).toBe(403);
    const forged=await app.inject({method:'POST',url:'/api/v1/rooms',headers:{origin,cookie:a.cookie,'x-csrf-token':'wrong'},payload:body});expect(forged.statusCode).toBe(403);
    expect((await write('POST','/api/v1/rooms',a,body)).statusCode).toBe(200);
  });
  it('revokes the current session on login and rejects expired sessions',async()=>{const first=await login('alice');const again=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin,cookie:first.cookie},payload:{username:'alice',password:'correct horse battery'}});expect(again.statusCode).toBe(200);expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:first.cookie}})).statusCode).toBe(401);const raw=again.headers['set-cookie'];const values=Array.isArray(raw)?raw:[String(raw)];const cookie=values.map(value=>value.split(';')[0]).join('; ');expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie}})).statusCode).toBe(200);await db.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE revoked_at IS NULL');expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie}})).statusCode).toBe(401);});
  it('logs out the current session without affecting a separate device session',async()=>{
    const first=await login('alice'),second=await login('alice');
    const loggedOut=await write('POST','/api/v1/auth/logout',first,{});expect(loggedOut.statusCode).toBe(200);
    expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:first.cookie}})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:second.cookie}})).statusCode).toBe(200);
    const repeated=await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{origin,cookie:first.cookie},payload:{}});expect(repeated.statusCode).toBe(200);
  });
  it('serializes concurrent retries of the same create request',async()=>{const a=await login('alice');const body={requestId:'parallel-create',name:'One',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};const [first,second]=await Promise.all([write('POST','/api/v1/rooms',a,body),write('POST','/api/v1/rooms',a,body)]);expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);expect(first.json().data.roomId).toBe(second.json().data.roomId);expect([first.json().data.inviteCode,second.json().data.inviteCode].filter(Boolean)).toHaveLength(1);const rows=await db.query('SELECT id FROM rooms WHERE host_account_id=(SELECT id FROM accounts WHERE username_canonical=$1)',['alice']);expect(rows.rowCount).toBe(1);});
  it('serializes competing seat claims without losing the moving player seat',async()=>{const a=await login('alice'),b=await login('bob');const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Seats',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});const {roomId,inviteCode}=created.json().data;await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode});const [move,claim]=await Promise.all([write('PUT',`/api/v1/rooms/${roomId}/my-seat`,a,{requestId:'move',expectedRoomRevision:1,seatIndex:1}),write('PUT',`/api/v1/rooms/${roomId}/my-seat`,b,{requestId:'claim',expectedRoomRevision:1,seatIndex:1})]);expect([move.statusCode,claim.statusCode].sort()).toEqual([200,409]);const snapshot=(await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:a.cookie}})).json().data;const aliceId=(await db.query<{id:string}>('SELECT id FROM accounts WHERE username_canonical=$1',['alice'])).rows[0]!.id;expect(snapshot.seats.some((seat:any)=>seat.ownerAccountId===aliceId)).toBe(true);expect(snapshot.seats.filter((seat:any)=>seat.ownerAccountId)).toHaveLength(move.statusCode===200?1:2);});
  it('does not treat an unknown leave as success and preserves ready on rename',async()=>{const a=await login('alice'),b=await login('bob');const body={requestId:'create',name:'First',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};const created=await write('POST','/api/v1/rooms',a,body);const {roomId,inviteCode}=created.json().data;const unknown=await write('POST',`/api/v1/rooms/00000000-0000-4000-8000-000000000000/leave`,b,{requestId:'unknown',expectedRoomRevision:0});expect(unknown.statusCode).toBe(404);await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode});await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'ready',expectedRoomRevision:1,ready:true});const renamed=await write('PATCH',`/api/v1/rooms/${roomId}/config`,a,{requestId:'rename',expectedRoomRevision:2,name:'Second',gameId:body.gameId,version:body.version,options:body.options,seatCount:2});expect(renamed.statusCode).toBe(200);expect(renamed.json().data.seats[0].ready).toBe(true);const unchanged=await write('PATCH',`/api/v1/rooms/${roomId}/config`,a,{requestId:'noop',expectedRoomRevision:3,name:'Second',gameId:body.gameId,version:body.version,options:body.options,seatCount:2});expect(unchanged.json().data.roomRevision).toBe(3);const left=await write('POST',`/api/v1/rooms/${roomId}/leave`,b,{requestId:'leave',expectedRoomRevision:3});expect(left.statusCode).toBe(200);expect(left.json().data).toEqual({left:true});const repeated=await write('POST',`/api/v1/rooms/${roomId}/leave`,b,{requestId:'leave',expectedRoomRevision:3});expect(repeated.statusCode).toBe(200);});
  it('invalidates rotated and expired invites and admits only one claimant to the last place',async()=>{
    const a=await login('alice'),b=await login('bob'),c=await login('carol');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Invites',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;
    const rotated=await write('POST',`/api/v1/rooms/${roomId}/invite`,a,{requestId:'rotate',expectedRoomRevision:0});
    expect(rotated.statusCode).toBe(200);
    expect((await write('POST','/api/v1/rooms/join',b,{requestId:'old',inviteCode})).statusCode).toBe(404);
    await db.query('UPDATE room_invites SET expires_at=now()-interval \'1 second\' WHERE room_id=$1',[roomId]);
    expect((await write('POST','/api/v1/rooms/join',b,{requestId:'expired',inviteCode:rotated.json().data.inviteCode})).statusCode).toBe(404);
    const fresh=await write('POST',`/api/v1/rooms/${roomId}/invite`,a,{requestId:'fresh',expectedRoomRevision:1});
    const code=fresh.json().data.inviteCode;
    const [left,right]=await Promise.all([write('POST','/api/v1/rooms/join',b,{requestId:'claim-b',inviteCode:code}),write('POST','/api/v1/rooms/join',c,{requestId:'claim-c',inviteCode:code})]);
    expect([left.statusCode,right.statusCode].sort()).toEqual([200,404]);
    const winner=left.statusCode===200?b:c;
    expect((await write('POST','/api/v1/rooms/join',winner,{requestId:'join-again',inviteCode:code})).statusCode).toBe(200);
    expect((await db.query('SELECT account_id FROM room_members WHERE room_id=$1',[roomId])).rowCount).toBe(2);
  });
  it('rejects identity spoofing and non-host commands, then invalidates ready on structural change',async()=>{
    const a=await login('alice'),b=await login('bob');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Permissions',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;
    const tooEarly=await write('POST',`/api/v1/rooms/${roomId}/start`,a,{requestId:'too-early',expectedRoomRevision:0});expect(tooEarly.statusCode).toBe(409);expect(tooEarly.json().error.code).toBe('NOT_ALL_READY');
    await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode});
    const aliceId=(await db.query<{id:string}>('SELECT id FROM accounts WHERE username_canonical=$1',['alice'])).rows[0]!.id;
    const config={requestId:'config-b',expectedRoomRevision:1,name:'Wrong',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2};
    expect((await write('PATCH',`/api/v1/rooms/${roomId}/config`,b,config)).statusCode).toBe(403);
    expect((await write('POST',`/api/v1/rooms/${roomId}/start`,b,{requestId:'start-b',expectedRoomRevision:1})).statusCode).toBe(403);
    expect((await write('POST',`/api/v1/rooms/${roomId}/host`,b,{requestId:'host-b',expectedRoomRevision:1,targetAccountId:aliceId})).statusCode).toBe(403);
    expect((await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,b,{requestId:'spoof',expectedRoomRevision:1,ready:true,accountId:aliceId})).statusCode).toBe(400);
    const ready=await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'ready-a',expectedRoomRevision:1,ready:true});expect(ready.json().data.seats[0].ready).toBe(true);
    const seated=await write('PUT',`/api/v1/rooms/${roomId}/my-seat`,b,{requestId:'seat-b',expectedRoomRevision:2,seatIndex:1});expect(seated.json().data.seats.every((seat:any)=>!seat.ready)).toBe(true);
    const stale=await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'stale',expectedRoomRevision:2,ready:true});expect(stale.statusCode).toBe(409);expect(stale.json().error.code).toBe('ROOM_CONFIG_CHANGED');
    await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'ready-again-a',expectedRoomRevision:3,ready:true});
    await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,b,{requestId:'ready-b',expectedRoomRevision:4,ready:true});
    const reconfigured=await write('PATCH',`/api/v1/rooms/${roomId}/config`,a,{requestId:'rules-change',expectedRoomRevision:5,name:'Permissions',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:5},seatCount:2});
    expect(reconfigured.statusCode).toBe(200);expect(reconfigured.json().data.roomRevision).toBe(6);expect(reconfigured.json().data.seats.every((seat:any)=>!seat.ready)).toBe(true);
  });
  it('transfers the host on leave and closes an empty room',async()=>{
    const a=await login('alice'),b=await login('bob');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Leaving',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode});
    expect((await write('POST',`/api/v1/rooms/${roomId}/leave`,a,{requestId:'leave-a',expectedRoomRevision:1})).statusCode).toBe(200);
    expect((await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:a.cookie}})).statusCode).toBe(404);
    const remaining=(await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:b.cookie}})).json().data;
    expect(remaining.hostAccountId).toBe(remaining.members[0].accountId);expect(remaining.seats.every((seat:any)=>!seat.ready)).toBe(true);
    expect((await write('POST',`/api/v1/rooms/${roomId}/leave`,b,{requestId:'leave-b',expectedRoomRevision:2})).statusCode).toBe(200);
    expect((await db.query<{status:string}>('SELECT status FROM rooms WHERE id=$1',[roomId])).rows[0]!.status).toBe('closed');
  });
  it('rolls back failed setup, then serializes concurrent start retries',async()=>{
    const a=await login('alice'),b=await login('bob');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Setup',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;
    expect((await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode})).statusCode).toBe(200);
    expect((await write('PUT',`/api/v1/rooms/${roomId}/my-seat`,b,{requestId:'seat',expectedRoomRevision:1,seatIndex:1})).statusCode).toBe(200);
    expect((await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'ready-a',expectedRoomRevision:2,ready:true})).statusCode).toBe(200);
    expect((await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,b,{requestId:'ready-b',expectedRoomRevision:3,ready:true})).statusCode).toBe(200);
    const key='demo.counter-room@1.0.0';const original=registry.entries.get(key)!;
    try{
      registry.entries.delete(key);
      const unavailable=await write('POST',`/api/v1/rooms/${roomId}/start`,a,{requestId:'unavailable',expectedRoomRevision:4});
      expect(unavailable.statusCode).toBe(422);expect(unavailable.json().error.code).toBe('GAME_VERSION_UNAVAILABLE');
      registry.entries.set(key,{...original,setup:()=>{throw new Error('injected setup failure');}});
      const failed=await write('POST',`/api/v1/rooms/${roomId}/start`,a,{requestId:'fail',expectedRoomRevision:4});
      expect(failed.statusCode).toBe(422);expect(failed.json().error.code).toBe('GAME_SETUP_FAILED');
      const waiting=await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:a.cookie}});
      expect(waiting.json().data.status).toBe('waiting');expect(waiting.json().data.seats.every((seat:any)=>seat.ready)).toBe(true);
      expect((await db.query('SELECT id FROM matches WHERE room_id=$1',[roomId])).rowCount).toBe(0);
    }finally{registry.entries.set(key,original);}
    const body={requestId:'start',expectedRoomRevision:4};
    const [first,second]=await Promise.all([write('POST',`/api/v1/rooms/${roomId}/start`,a,body),write('POST',`/api/v1/rooms/${roomId}/start`,a,body)]);
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);
    expect(first.json().data.matchId).toBe(second.json().data.matchId);
    expect((await db.query('SELECT id FROM matches WHERE room_id=$1',[roomId])).rowCount).toBe(1);
    expect((await write('PATCH',`/api/v1/rooms/${roomId}/config`,a,{requestId:'late-config',expectedRoomRevision:5,name:'Too late',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2})).statusCode).toBe(409);
    expect((await write('PUT',`/api/v1/rooms/${roomId}/my-seat`,b,{requestId:'late-seat',expectedRoomRevision:5,seatIndex:0})).statusCode).toBe(409);
    await app.close();
    db=createDatabase(url!);registry=createRegistry(false);
    app=await createApp({config:{NODE_ENV:'test',API_HOST:'127.0.0.1',API_PORT:3001,DATABASE_URL:url!,WEB_ORIGIN:origin,ENABLE_DEV_LAB:false,LOG_LEVEL:'silent',PRESENCE_GRACE_MS:100},db,registry});
    const persistedRoom=await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:a.cookie}});expect(persistedRoom.json().data.activeMatchId).toBe(first.json().data.matchId);
    const persisted=await app.inject({url:`/api/v1/matches/${first.json().data.matchId}/view`,headers:{cookie:a.cookie}});expect(persisted.statusCode).toBe(200);expect(persisted.json().data.matchId).toBe(first.json().data.matchId);
    const left=await write('POST',`/api/v1/rooms/${roomId}/leave`,a,{requestId:'leave-active',expectedRoomRevision:5});
    expect(left.statusCode).toBe(409);expect(left.json().error.code).toBe('ROOM_ALREADY_STARTED');
    const closed=await write('POST',`/api/v1/rooms/${roomId}/close`,a,{requestId:'close',expectedRoomRevision:5});
    expect(closed.statusCode).toBe(200);expect(closed.json().data.status).toBe('closed');
    expect((await db.query<{status:string}>('SELECT status FROM matches WHERE id=$1',[first.json().data.matchId])).rows[0]!.status).toBe('aborted');
    const repeatClose=await write('POST',`/api/v1/rooms/${roomId}/close`,a,{requestId:'close-again',expectedRoomRevision:5});
    expect(repeatClose.statusCode).toBe(200);expect(repeatClose.json().data.roomRevision).toBe(closed.json().data.roomRevision);
  });
  it('resynchronizes a subscribing socket and closes it on external session revocation',async()=>{
    const a=await login('alice');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Live',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const roomId=created.json().data.roomId;
    await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address();if(!address||typeof address==='string')throw new Error('Expected TCP address');
    const ws=new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`,{origin,headers:{cookie:a.cookie}});
    const messages:any[]=[];
    ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
    const waitFor=async(predicate:(message:any)=>boolean)=>{
      const deadline=Date.now()+3000;
      while(Date.now()<deadline){const found=messages.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,20));}
      throw new Error(`Timed out waiting for WS message; received ${JSON.stringify(messages)}`);
    };
    try{
      await new Promise<void>((resolve,reject)=>{ws.once('open',()=>resolve());ws.once('error',reject);});
      await waitFor(message=>message.type==='session.ready');
      ws.send(JSON.stringify({protocolVersion:1,type:'room.subscribe',roomId}));
      const changed=write('PUT',`/api/v1/rooms/${roomId}/my-ready`,a,{requestId:'ready',expectedRoomRevision:0,ready:true});
      expect((await changed).statusCode).toBe(200);
      const latest=await waitFor(message=>message.type==='room.snapshot'&&message.roomId===roomId&&message.roomRevision===1);
      expect(latest.snapshot.seats[0].ready).toBe(true);
      const outsider=await login('carol');
      const deniedSocket=new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`,{origin,headers:{cookie:outsider.cookie}});
      const deniedMessages:any[]=[];deniedSocket.on('message',raw=>deniedMessages.push(JSON.parse(raw.toString())));
      try{await new Promise<void>((resolve,reject)=>{deniedSocket.once('open',()=>resolve());deniedSocket.once('error',reject);});deniedSocket.send(JSON.stringify({protocolVersion:1,type:'room.subscribe',roomId}));const deadline=Date.now()+3000;while(!deniedMessages.some(message=>message.type==='error')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));expect(deniedMessages.find(message=>message.type==='error')?.code).toBe('ROOM_NOT_FOUND');expect(deniedMessages.some(message=>message.type==='room.snapshot')).toBe(false);}finally{deniedSocket.terminate();}
      const closed=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket was not closed after revocation')),3000);ws.once('close',code=>{clearTimeout(timer);resolve(code);});});
      const accountId=(await db.query<{id:string}>('SELECT id FROM accounts WHERE username_canonical=$1',['alice'])).rows[0]!.id;
      await db.query('UPDATE sessions SET revoked_at=now() WHERE account_id=$1',[accountId]);
      await db.query("SELECT pg_notify('boardgame_session_revoked',$1)",[accountId]);
      expect(await closed).toBe(4001);
    }finally{ws.terminate();}
  });
  it('keeps an account online until its last subscribed tab disconnects',async()=>{
    const a=await login('alice'),b=await login('bob');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Tabs',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;
    expect((await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode})).statusCode).toBe(200);
    if(!app.server.listening)await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address();if(!address||typeof address==='string')throw new Error('Expected TCP address');
    const sockets:WebSocket[]=[];
    const open=async(cookie:string)=>{
      const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`,{origin,headers:{cookie}});
      sockets.push(socket);const messages:any[]=[];socket.on('message',raw=>messages.push(JSON.parse(raw.toString())));
      await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});
      socket.send(JSON.stringify({protocolVersion:1,type:'room.subscribe',roomId}));
      return {socket,messages};
    };
    const wait=async(messages:any[],predicate:(message:any)=>boolean)=>{const deadline=Date.now()+3000;while(Date.now()<deadline){const found=messages.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`Presence message missing: ${JSON.stringify(messages)}`);};
    try{
      const a1=await open(a.cookie),a2=await open(a.cookie),observer=await open(b.cookie);
      const aliceId=(await db.query<{id:string}>('SELECT id FROM accounts WHERE username_canonical=$1',['alice'])).rows[0]!.id;
      await wait(observer.messages,message=>message.type==='room.presence'&&message.onlineAccountIds.includes(aliceId));
      let sequence=Math.max(...observer.messages.filter(message=>message.type==='room.presence').map(message=>message.presenceSeq));
      a1.socket.close();await new Promise(resolve=>a1.socket.once('close',resolve));
      const stillOnline=await wait(observer.messages,message=>message.type==='room.presence'&&message.presenceSeq>sequence);
      expect(stillOnline.onlineAccountIds).toContain(aliceId);
      sequence=stillOnline.presenceSeq;
      a2.socket.close();await new Promise(resolve=>a2.socket.once('close',resolve));
      const offline=await wait(observer.messages,message=>message.type==='room.presence'&&message.presenceSeq>sequence&&!message.onlineAccountIds.includes(aliceId));
      expect(offline.onlineAccountIds).not.toContain(aliceId);
      const snapshot=(await app.inject({url:`/api/v1/rooms/${roomId}`,headers:{cookie:b.cookie}})).json().data;
      expect(snapshot.roomRevision).toBe(1);expect(snapshot.members).toHaveLength(2);
    }finally{for(const socket of sockets)socket.terminate();}
  });
  it('runs administrator initialization idempotently and rejects canonical username collisions',async()=>{
    const password=randomBytes(32).toString('base64url');
    const cli=(...args:string[])=>spawnSync(process.execPath,['--env-file=.env','node_modules/tsx/dist/cli.mjs','scripts/accounts.ts',...args],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url!},input:`${password}\n`,encoding:'utf8'});
    const first=cli('admin:init','admin','Administrator');expect(first.status).toBe(0);
    const hash=(await db.query<{password_hash:string}>("SELECT password_hash FROM accounts WHERE username_canonical='admin'")).rows[0]!.password_hash;
    expect(hash).not.toBe(password);expect(hash).toMatch(/^\$argon2id\$/);
    const repeated=cli('admin:init','admin','Changed');expect(repeated.status).toBe(0);expect(repeated.stdout).toContain('unchanged');
    const same=(await db.query<{password_hash:string;display_name:string}>("SELECT password_hash,display_name FROM accounts WHERE username_canonical='admin'")).rows[0]!;
    expect(same.password_hash).toBe(hash);expect(same.display_name).toBe('Administrator');
    const collision=cli('account:create','ALICE','Other Alice');expect(collision.status).toBe(1);
    expect((await db.query("SELECT id FROM accounts WHERE username_canonical='alice'")).rowCount).toBe(1);
    const previous=await login('alice');
    if(!app.server.listening)await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address();if(!address||typeof address==='string')throw new Error('Expected TCP address');
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`,{origin,headers:{cookie:previous.cookie}});
    try{
      await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});
      const closed=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CLI reset did not close WS')),3000);socket.once('close',code=>{clearTimeout(timer);resolve(code);});});
      expect(cli('account:reset-password','alice').status).toBe(0);
      expect(await closed).toBe(4001);
      expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:previous.cookie}})).statusCode).toBe(401);
      const newLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'alice',password}});expect(newLogin.statusCode).toBe(200);
      expect(cli('account:disable','alice').status).toBe(0);
      expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'alice',password}})).statusCode).toBe(401);
      expect(cli('account:enable','alice').status).toBe(0);
      expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'alice',password}})).statusCode).toBe(200);
    }finally{socket.terminate();}
  });
  it('broadcasts the terminal room snapshot before closing the subscription',async()=>{
    const a=await login('alice'),b=await login('bob');
    const created=await write('POST','/api/v1/rooms',a,{requestId:'create',name:'Closing',gameId:'demo.counter-room',version:'1.0.0',options:{targetScore:3},seatCount:2});
    const {roomId,inviteCode}=created.json().data;await write('POST','/api/v1/rooms/join',b,{requestId:'join',inviteCode});
    if(!app.server.listening)await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address();if(!address||typeof address==='string')throw new Error('Expected TCP address');
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws/session`,{origin,headers:{cookie:b.cookie}});
    const messages:any[]=[];socket.on('message',raw=>messages.push(JSON.parse(raw.toString())));
    const wait=async(predicate:(message:any)=>boolean)=>{const deadline=Date.now()+3000;while(Date.now()<deadline){const found=messages.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`Timed out; received ${JSON.stringify(messages)}`);};
    try{
      await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});
      socket.send(JSON.stringify({protocolVersion:1,type:'room.subscribe',roomId}));
      await wait(message=>message.type==='room.snapshot'&&message.roomRevision===1);
      expect((await write('POST',`/api/v1/rooms/${roomId}/close`,a,{requestId:'close',expectedRoomRevision:1})).statusCode).toBe(200);
      const terminal=await wait(message=>message.type==='room.snapshot'&&message.snapshot.status==='closed');
      expect(terminal.roomRevision).toBe(2);
      const closed=await wait(message=>message.type==='room.closed');expect(closed.roomRevision).toBe(2);
      expect(messages.findIndex(message=>message===terminal)).toBeLessThan(messages.findIndex(message=>message===closed));
    }finally{socket.terminate();}
  });
  it('uses uniform login errors and bounded login and invite retries',async()=>{
    const a=await login('alice');
    await db.query("UPDATE accounts SET status='disabled' WHERE username_canonical='bob'");
    const attempt=(username:string,password:string)=>app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password}});
    const disabled=await attempt('bob','correct horse battery');const unknown=await attempt('nobody','correct horse battery');
    expect(disabled.statusCode).toBe(401);expect(unknown.statusCode).toBe(401);
    expect(disabled.json().error.code).toBe(unknown.json().error.code);
    for(let index=0;index<5;index++)expect((await attempt('alice','incorrect password')).statusCode).toBe(401);
    const blocked=await attempt('alice','incorrect password');expect(blocked.statusCode).toBe(429);expect(blocked.headers['retry-after']).toBe('60');
    for(let index=0;index<10;index++)expect((await write('POST','/api/v1/rooms/join',a,{requestId:`missing-${index}`,inviteCode:'0123456789AB'})).statusCode).toBe(404);
    const joinBlocked=await write('POST','/api/v1/rooms/join',a,{requestId:'missing-10',inviteCode:'0123456789AB'});
    expect(joinBlocked.statusCode).toBe(429);expect(joinBlocked.headers['retry-after']).toBe('60');
  });
});
