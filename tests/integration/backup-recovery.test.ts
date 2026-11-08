import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { gamePackageZip } from '../fixtures/game-package.js';
import { backupUpdate } from '../../scripts/update-backup.mjs';
import { verifyUpdateBackup } from '../../scripts/verify-update-backup.mjs';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
const development = process.env.DATABASE_URL;
if (
  !url ||
  !development ||
  url === development ||
  new URL(url).pathname === new URL(development).pathname
) {
  throw new Error('An isolated test database is required');
}
const run = promisify(execFile);
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

async function snapshot(db: Database) {
  return {
    matches: (await db.query('SELECT * FROM matches ORDER BY id')).rows,
    participants: (await db.query('SELECT * FROM match_participants ORDER BY match_id,seat_index'))
      .rows,
    rooms: (await db.query('SELECT * FROM rooms ORDER BY id')).rows,
    actions: (await db.query('SELECT * FROM match_actions ORDER BY match_id,revision')).rows,
    receipts: (
      await db.query('SELECT * FROM command_receipts ORDER BY account_id,operation,request_id')
    ).rows,
    packages: (
      await db.query(
        'SELECT game_id,game_version,package_hash FROM game_packages ORDER BY game_id,game_version',
      )
    ).rows,
  };
}

it('restores a real backup with exact assets, RNG, receipts, active play and participant replays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'playboard-recovery-test-'));
  const assets = join(root, 'source-assets');
  const restoredAssets = join(root, 'restored-assets');
  const previousAssets = process.env.TEST_ASSET_STORAGE_DIR;
  if (previousAssets)
    await cp(previousAssets, assets, { recursive: true, force: false, errorOnExist: true });
  else await mkdir(assets, { mode: 0o700 });
  await writeFile(join(assets, 'fixture.bin'), Buffer.from([0, 17, 255]));
  const restoredUrl = new URL(url!);
  const restoredName = `playboard_restore_test_${randomUUID().replaceAll('-', '')}`;
  restoredUrl.pathname = `/${restoredName}`;
  process.env.TEST_ASSET_STORAGE_DIR = assets;
  let db = createDatabase(url!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let createdRestore = false;
  const config = (databaseUrl: string) => ({
    NODE_ENV: 'test' as const,
    API_HOST: '127.0.0.1',
    API_PORT: 3001,
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: origin,
    ENABLE_DEV_LAB: false,
    LOG_LEVEL: 'silent' as const,
  });
  const write = (
    path: string,
    headers: Headers,
    payload: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ) => app!.inject({ method, url: `/api/v1${path}`, headers, payload });
  async function view(id: string, headers: Headers) {
    const response = await app!.inject({ url: `/api/v1/matches/${id}/view`, headers });
    expect(response.statusCode).toBe(200);
    return response.json().data;
  }
  async function action(id: string, players: Headers[]) {
    const current = await view(id, players[0]!);
    if (current.status === 'finished') return undefined;
    const index = current.view.seats.indexOf(current.view.currentSeat);
    expect(index).toBeGreaterThanOrEqual(0);
    const actor = players[index]!;
    const payload = {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      action: { type: 'claim' },
    };
    const response = await write(`/matches/${id}/actions`, actor, payload);
    expect(response.statusCode).toBe(200);
    return { actor, payload, result: response.json().data };
  }
  async function match(players: Headers[]) {
    const created = await write('/rooms', players[0]!, {
      requestId: randomUUID(),
      name: '隔离恢复演练',
      gameId: 'online.score-race',
      version: '1.0.0',
      options: {},
      seatCount: 2,
    });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    const joined = await write('/rooms/join', players[1]!, { requestId: randomUUID(), inviteCode });
    expect(joined.statusCode).toBe(200);
    const seated = await write(
      `/rooms/${roomId}/my-seat`,
      players[1]!,
      {
        requestId: randomUUID(),
        expectedRoomRevision: joined.json().data.roomRevision,
        seatIndex: 1,
      },
      'PUT',
    );
    expect(seated.statusCode).toBe(200);
    let revision = seated.json().data.roomRevision;
    for (const player of players) {
      const ready = await write(
        `/rooms/${roomId}/my-ready`,
        player,
        {
          requestId: randomUUID(),
          expectedRoomRevision: revision,
          ready: true,
        },
        'PUT',
      );
      expect(ready.statusCode).toBe(200);
      revision = ready.json().data.roomRevision;
    }
    const started = await write(`/rooms/${roomId}/start`, players[0]!, {
      requestId: randomUUID(),
      expectedRoomRevision: revision,
    });
    expect(started.statusCode).toBe(200);
    return started.json().data.matchId as string;
  }
  try {
    await db.query('TRUNCATE accounts CASCADE');
    await db.query(
      "DELETE FROM game_packages WHERE game_id='online.score-race'; DELETE FROM game_installations WHERE game_id='online.score-race'",
    );
    app = await createApp({ db, config: config(url!), registry: createRegistry(false) });
    const headers: Headers[] = [];
    for (let index = 0; index < 5; index++) {
      const username = `restore_fixture_${index}`;
      await createAccount(db, {
        username,
        displayName: username,
        password: 'isolated backup verification password',
        role: index === 0 ? 'administrator' : 'user',
      });
      const response = await write(
        '/auth/login',
        { cookie: '', origin, 'x-csrf-token': '' },
        {
          username,
          password: 'isolated backup verification password',
        },
      );
      expect(response.statusCode).toBe(200);
      const cookies = response.headers['set-cookie'];
      headers.push({
        cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
          .map((value) => value.split(';')[0])
          .join('; '),
        origin,
        'x-csrf-token': String(response.json().data.csrfToken),
      });
    }
    const archive = await gamePackageZip();
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/game-packages?requestId=${randomUUID()}`,
      headers: { ...headers[0]!, 'content-type': 'application/zip' },
      payload: archive,
    });
    expect(uploaded.statusCode).toBe(200);
    const activePlayers = headers.slice(1, 3),
      finishedPlayers = headers.slice(3);
    const activeId = await match(activePlayers);
    await action(activeId, activePlayers);
    const lastAction = (await action(activeId, activePlayers))!;
    expect(lastAction).toBeDefined();
    const finishedId = await match(finishedPlayers);
    for (let step = 0; step < 20; step++) if (!(await action(finishedId, finishedPlayers))) break;
    const finishedView = await view(finishedId, finishedPlayers[0]!);
    expect(finishedView.status).toBe('finished');
    const activeView = await view(activeId, activePlayers[0]!);
    expect(activeView.status).toBe('active');
    // Close the application before backup, as the real updater does.
    await app.close();
    app = undefined;
    db = createDatabase(url!);
    const saved = await snapshot(db);
    const sha = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const started = performance.now();
    const backup = await backupUpdate({
      stateRoot: root,
      env: { ...process.env, DATABASE_URL: url!, ASSET_STORAGE_DIR: assets },
      previous: { sha, path: process.cwd() },
      candidate: { sha, path: process.cwd() },
    });
    const verified = await verifyUpdateBackup(backup);
    const backupMs = Math.round(performance.now() - started);
    // A random test-only name is created fresh; pg_restore never uses --clean.
    await db.query(`CREATE DATABASE "${restoredName}"`);
    createdRestore = true;
    const restoreStarted = performance.now();
    await run(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        `--dbname=${restoredName}`,
        join(backup, 'database.dump'),
      ],
      {
        env: {
          ...process.env,
          PGHOST: restoredUrl.hostname,
          PGPORT: restoredUrl.port || '5432',
          PGUSER: decodeURIComponent(restoredUrl.username),
          PGPASSWORD: decodeURIComponent(restoredUrl.password),
        },
        timeout: 60000,
      },
    );
    await cp(join(backup, 'assets'), restoredAssets, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    const restoreMs = Math.round(performance.now() - restoreStarted);
    await db.end();
    db = createDatabase(restoredUrl.href);
    expect(await snapshot(db)).toEqual(saved);
    expect(await readFile(join(restoredAssets, 'fixture.bin'))).toEqual(Buffer.from([0, 17, 255]));
    process.env.TEST_ASSET_STORAGE_DIR = restoredAssets;
    app = await createApp({
      db,
      config: config(restoredUrl.href),
      registry: createRegistry(false),
    });
    expect(await view(activeId, activePlayers[0]!)).toEqual(activeView);
    expect(await view(finishedId, finishedPlayers[0]!)).toEqual(finishedView);
    const retried = await write(
      `/matches/${activeId}/actions`,
      lastAction.actor,
      lastAction.payload,
    );
    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.revision).toBe(lastAction.result.revision);
    expect(await view(activeId, activePlayers[0]!)).toEqual(activeView);
    const nonmember = await app.inject({
      url: `/api/v1/matches/${activeId}/view`,
      headers: headers[0]!,
    });
    expect(nonmember.statusCode).toBe(404);
    const initial = await app.inject({
      url: `/api/v1/matches/${finishedId}/replay?revision=0`,
      headers: finishedPlayers[1]!,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data.gameVersion).toBe('1.0.0');
    const replay = await app.inject({
      url: `/api/v1/matches/${finishedId}/replay?revision=${finishedView.revision}`,
      headers: finishedPlayers[0]!,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.view).toEqual(finishedView.view);
    await action(activeId, activePlayers);
    expect((await view(activeId, activePlayers[0]!)).revision).toBe(activeView.revision + 1);
    const restoredNext = (
      await db.query('SELECT state,rng_state FROM matches WHERE id=$1', [activeId])
    ).rows[0];
    // The original copy executes the same next action from the saved RNG.
    await app.close();
    app = undefined;
    db = createDatabase(url!);
    process.env.TEST_ASSET_STORAGE_DIR = assets;
    app = await createApp({ db, config: config(url!), registry: createRegistry(false) });
    await action(activeId, activePlayers);
    expect(
      (await db.query('SELECT state,rng_state FROM matches WHERE id=$1', [activeId])).rows[0],
    ).toEqual(restoredNext);
    await mkdir('.data', { recursive: true });
    await writeFile(
      '.data/backup-recovery-result.json',
      JSON.stringify(
        {
          backupMs,
          restoreMs,
          verified,
          exactRows: true,
          rngContinuation: true,
          duplicateReceipt: true,
          participantReplay: true,
          nonmemberDenied: true,
          activeActionContinued: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
    else await db.end();
    if (previousAssets === undefined) delete process.env.TEST_ASSET_STORAGE_DIR;
    else process.env.TEST_ASSET_STORAGE_DIR = previousAssets;
    if (createdRestore) {
      const cleanup = createDatabase(url!);
      try {
        await cleanup.query(`DROP DATABASE "${restoredName}"`);
      } finally {
        await cleanup.end();
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
