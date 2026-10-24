import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { unoPackageZip, packagePng } from '../fixtures/uno-package.js';
process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || new URL(url).pathname === new URL(process.env.DATABASE_URL!).pathname)
    throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
type Headers = {
    cookie: string;
    origin: string;
    'x-csrf-token': string;
};
describe.each([
    { edition: 'casual' as const, gameId: 'online.uno', version: '1.2.0' },
    { edition: 'no-mercy' as const, gameId: 'online.uno-no-mercy', version: '1.0.0' },
])('UNO $edition artwork, restoration and real AI', ({ edition, gameId, version }) => {
    let db: Database, app: Awaited<ReturnType<typeof createApp>>;
    let admin: Headers, alice: Headers;
    const config = { NODE_ENV: 'test' as const, API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent' as const, AI_SCAN_INTERVAL_MS: 50, AI_DECISION_TIMEOUT_MS: 1500 };
    async function start() { db = createDatabase(url!); app = await createApp({ db, config, registry: createRegistry(false) }); }
    async function login(username: string) {
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: 'uno package password' } });
        expect(response.statusCode).toBe(200);
        const raw = response.headers['set-cookie'];
        return { cookie: (Array.isArray(raw) ? raw : [String(raw)]).map(value => value.split(';')[0]).join('; '), origin, 'x-csrf-token': String(response.json().data.csrfToken) };
    }
    function write(path: string, headers: Headers, payload: unknown, method: 'POST' | 'PUT' = 'POST') {
        return app.inject({ method, url: '/api/v1' + path, headers, payload });
    }
    beforeAll(async () => {
        db = createDatabase(url!);
        await db.query('TRUNCATE accounts CASCADE');
        await db.query(`DELETE FROM game_package_receipts; DELETE FROM game_presentations WHERE game_id='${gameId}'; DELETE FROM game_packages WHERE game_id='${gameId}'; DELETE FROM game_installations WHERE game_id='${gameId}'`);
        app = await createApp({ db, config, registry: createRegistry(false) });
        await createAccount(db, { username: 'uno_admin', displayName: 'admin', password: 'uno package password', role: 'administrator' });
        await createAccount(db, { username: 'uno_alice', displayName: 'Alice', password: 'uno package password', role: 'user' });
        admin = await login('uno_admin');
        alice = await login('uno_alice');
        const installed = await app.inject({ method: 'POST', url: `/api/v1/admin/game-packages?requestId=${randomUUID()}`, headers: { ...admin, 'content-type': 'application/zip' }, payload: await unoPackageZip(edition) });
        expect(installed.statusCode).toBe(200);
    });
    afterAll(async () => {
        await db.query('TRUNCATE accounts CASCADE');
        await db.query(`DELETE FROM game_presentations WHERE game_id='${gameId}'; DELETE FROM game_packages WHERE game_id='${gameId}'; DELETE FROM game_installations WHERE game_id='${gameId}'`);
        await app.close();
    });
    it('persists embedded art, respects admin overrides and restores defaults/AI after API restart', async () => {
        const readArt = () => app.inject({ url: `/api/v1/game-packages/${gameId}/versions/${version}/art/cover.png` });
        let response = await readArt();
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('image/png');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.rawPayload).toEqual(Buffer.from(packagePng.split(',')[1]!, 'base64'));
        const presentations = async () => (await app.inject({ url: '/api/v1/games/presentations' })).json().data.find((item: {
            gameId: string;
        }) => item.gameId === gameId);
        expect(await presentations()).toMatchObject({ coverUrl: `/api/v1/game-packages/${gameId}/versions/${version}/art/cover.png`, revision: 0 });
        const changed = await write(`/games/${gameId}/versions/${version}/presentation`, admin, { expectedRevision: 0, iconUrl: null, coverUrl: '/game-art/color-match-cover.svg', backgroundUrl: null }, 'PUT');
        // The existing presentation API owns overrides, separate from immutable package bytes.
        expect(changed.statusCode).toBe(200);
        expect((await presentations()).coverUrl).toBe('/game-art/color-match-cover.svg');
        expect((await write(`/games/${gameId}/versions/${version}/presentation`, admin, { expectedRevision: 1, iconUrl: null, coverUrl: null, backgroundUrl: null }, 'PUT')).statusCode).toBe(200);
        await app.close();
        await start();
        response = await readArt();
        expect(response.statusCode).toBe(200);
        expect((await presentations()).coverUrl).toContain('/art/cover.png');
        const policies = await app.inject({ url: `/api/v1/games/${gameId}/ai-policies` });
        expect(policies.json().data).toContainEqual({ id: 'basic-v1', version: '1.0.0', name: '基础脚本 AI' });
    });
    for (const controllerType of ['script', 'model'] as const) {
        it(`uploads and completes a real UNO match with a ${controllerType} bot`, async () => {
            const created = await write('/rooms', alice, { requestId: randomUUID(), name: 'UNO ' + controllerType, gameId, version, options: {}, seatCount: 2 });
            expect(created.statusCode).toBe(200);
            const { roomId, room } = created.json().data;
            const botSeat = room.seats[1].seatId;
            let profileId: string | undefined;
            if (controllerType === 'model') {
                const profile = await write('/me/model-profiles', alice, { name: 'UNO mock', endpointId: 'mock', modelId: 'mock-v1' });
                expect(profile.statusCode).toBe(200);
                profileId = profile.json().data.id;
            }
            const added = await write(`/rooms/${roomId}/seats/${botSeat}/bot`, alice, { requestId: randomUUID(), expectedRoomRevision: 0,
                ...(profileId ? { controllerType: 'model', profileId } : { policyId: 'basic-v1' }) }, 'PUT');
            expect(added.statusCode).toBe(200);
            const ready = await write(`/rooms/${roomId}/my-ready`, alice, { requestId: randomUUID(), expectedRoomRevision: added.json().data.roomRevision, ready: true }, 'PUT');
            expect(ready.statusCode).toBe(200);
            const started = await write(`/rooms/${roomId}/start`, alice, { requestId: randomUUID(), expectedRoomRevision: ready.json().data.roomRevision });
            expect(started.statusCode).toBe(200);
            const matchId = started.json().data.matchId;
            const before = (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
            expect((await app.inject({ url: `/api/v1/matches/${matchId}/view`, headers: admin })).statusCode).toBe(404);
            const illegal = await write(`/matches/${matchId}/actions`, alice, { requestId: randomUUID(), expectedRevision: 0, action: { type: 'play', cardId: 'not-owned', color: null, uno: true } });
            expect(illegal.statusCode).toBe(422);
            expect((await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]).toEqual(before);
            const deadline = Date.now() + 60000;
            let finished = false;
            while (Date.now() < deadline) {
                const response = await app.inject({ url: `/api/v1/matches/${matchId}/view`, headers: alice });
                expect(response.statusCode).toBe(200);
                const snapshot = response.json().data;
                expect(snapshot.view).not.toHaveProperty('deck');
                expect(snapshot.view).not.toHaveProperty('hands');
                if (snapshot.status === 'finished') {
                    finished = true;
                    break;
                }
                if (snapshot.view.actions.length) {
                    const command = { requestId: randomUUID(), expectedRevision: snapshot.revision, action: snapshot.view.actions[0] };
                    const result = await write(`/matches/${matchId}/actions`, alice, command);
                    expect(result.statusCode).toBe(200);
                    if (snapshot.revision === 0) {
                        // The same original request must succeed even after the bot advances revision.
                        const retried = await write(`/matches/${matchId}/actions`, alice, command);
                        expect(retried.statusCode).toBe(200);
                        expect(retried.json().data).toEqual({ ...result.json().data, events: [] });
                        const conflict = await write(`/matches/${matchId}/actions`, alice, { ...command, action: { type: 'nonexistent' } });
                        expect(conflict.statusCode).toBe(409);
                    }
                }
                else
                    await new Promise(resolve => setTimeout(resolve, 30));
            }
            expect(finished).toBe(true);
            const tasks = await db.query<{
                status: string;
                safe_error_code: string | null;
            }>('SELECT status,safe_error_code FROM ai_tasks WHERE match_id=$1', [matchId]);
            expect(tasks.rows.some(task => task.status === 'succeeded')).toBe(true);
            expect(tasks.rows.filter(task => task.status === 'blocked')).toEqual([]);
            expect(tasks.rows.filter(task => task.safe_error_code === 'AI_FALLBACK_USED')).toEqual([]);
            const restored = await app.inject({ url: `/api/v1/rooms/${roomId}`, headers: alice });
            expect(restored.json().data.status).toBe('waiting');
            const closed = await write(`/rooms/${roomId}/close`, alice, { requestId: randomUUID(), expectedRoomRevision: restored.json().data.roomRevision });
            expect(closed.statusCode).toBe(200);
        }, 70000);
    }
});
