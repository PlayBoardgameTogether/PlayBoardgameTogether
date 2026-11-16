import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, totalmem, release } from 'node:os';
import WebSocket from 'ws';
import { z } from 'zod';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import {
  matchSnapshotMessageSchema,
  matchViewSchema,
  type MatchView,
} from '../../packages/protocol/src/index.js';
import { viewSchema } from '../../games/color-match/src/shared/index.js';

process.loadEnvFile('.env');
const testUrl = process.env.TEST_DATABASE_URL;
const developmentUrl = process.env.DATABASE_URL;
// Fail instead of skipping or touching a database selected by a production URL.
if (!testUrl || !developmentUrl) throw new Error('Isolated database URLs are required');
const testDb = new URL(testUrl);
const developmentDb = new URL(developmentUrl);
if (
  testDb.pathname === developmentDb.pathname ||
  !/^\/playboard_d24_test_[a-z0-9_]+$/.test(testDb.pathname) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(testDb.hostname) ||
  testDb.host !== developmentDb.host ||
  testDb.username !== developmentDb.username
)
  throw new Error('Performance baseline requires its dedicated local test database');

const origin = 'http://127.0.0.1:5173';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Session = { cookie: string; csrf: string };
const revisionSchema = z.object({ roomRevision: z.number() });
function distribution(values: number[]) {
  expect(values.length).toBeGreaterThan(0);
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
  return {
    count: values.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    maxMs: sorted.at(-1)!,
  };
}
function ipc(child: ChildProcess, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`IPC timeout: ${type}`)), 15000);
    const onExit = () => finish(new Error(`API exited while awaiting ${type}`));
    function finish(error?: Error, value?: unknown) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(value);
    }
    function onMessage(value: unknown) {
      if (z.object({ type: z.string() }).safeParse(value).data?.type === type)
        finish(undefined, value);
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

class Peer {
  readonly socket: WebSocket;
  readonly updates = new EventEmitter();
  readonly snapshots = new Map<number, { snapshot: MatchView; arrived: number }>();
  readonly failures: string[] = [];
  pings = 0;
  closing = false;
  ready = false;
  constructor(
    base: string,
    readonly session: Session,
    readonly matchId: string,
    readonly seat: number,
  ) {
    this.socket = new WebSocket(base.replace('http:', 'ws:') + '/api/v1/ws/session', {
      origin,
      headers: { cookie: session.cookie },
    });
    this.socket.on('ping', () => this.pings++);
    this.socket.on('error', () => {
      this.failures.push('socket.error');
      this.updates.emit('update');
    });
    this.socket.on('close', () => {
      if (!this.closing) this.failures.push('socket.closed');
      this.updates.emit('update');
    });
    this.socket.on('message', (raw) => {
      try {
        const value: unknown = JSON.parse(raw.toString());
        const message = z.object({ type: z.string() }).parse(value);
        if (message.type === 'session.ready') this.ready = true;
        if (message.type === 'error') this.failures.push('protocol.error');
        if (message.type === 'match.snapshot') {
          const parsed = matchSnapshotMessageSchema.parse(value);
          expect(parsed.matchId).toBe(this.matchId);
          expect(parsed.snapshot.seatIndex).toBe(this.seat);
          const view = viewSchema.parse(parsed.snapshot.view);
          expect(view.viewingSeatId).toBe(view.seats[this.seat]);
          this.snapshots.set(parsed.revision, {
            snapshot: parsed.snapshot,
            arrived: performance.now(),
          });
        }
      } catch {
        this.failures.push('invalid.identity.or.projection');
      }
      this.updates.emit('update');
    });
  }
  wait(condition: () => boolean) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('WebSocket snapshot timeout')), 10000);
      const check = () => {
        if (this.failures.length) finish(new Error(this.failures.join(',')));
        else if (condition()) finish();
      };
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.updates.off('update', check);
        if (error) reject(error);
        else resolve();
      };
      this.updates.on('update', check);
      check();
    });
  }
  async subscribe(roomId: string, revision: number) {
    await this.wait(() => this.ready);
    this.socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
    await this.wait(() => this.snapshots.has(revision));
  }
  async close() {
    this.closing = true;
    const closed = once(this.socket, 'close');
    this.socket.close();
    await closed;
  }
}

it('measures ten authoritative four-player matches with forty authenticated sockets', async () => {
  const db = createDatabase(testUrl!);
  const peers: Peer[] = [];
  let child: ChildProcess | undefined;
  try {
    // Complete cleanup and fixture creation before starting recovery/background work.
    await db.query('TRUNCATE accounts CASCADE');
    for (let i = 0; i < 40; i++)
      await createAccount(db, {
        username: `perf_${i}`,
        displayName: `Perf ${i}`,
        password: 'performance fixture password',
        role: 'user',
      });
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/performance-server.ts'], {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr?.resume();
    const ready = z.object({ port: z.number() }).parse(await ipc(child, 'ready'));
    const base = `http://127.0.0.1:${ready.port}`;
    async function request(
      path: string,
      session?: Session,
      payload?: object,
      method = payload ? 'POST' : 'GET',
    ) {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        signal: AbortSignal.timeout(10000),
        headers: {
          origin,
          ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(200);
      return z.object({ data: z.unknown() }).parse(await response.json()).data;
    }
    const sessions: Session[] = [];
    for (let i = 0; i < 40; i++) {
      const response = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: `perf_${i}`, password: 'performance fixture password' }),
        signal: AbortSignal.timeout(10000),
      });
      expect(response.status).toBe(200);
      const login = z
        .object({ data: z.object({ csrfToken: z.string() }) })
        .parse(await response.json());
      sessions.push({
        cookie: response.headers
          .getSetCookie()
          .map((v) => v.split(';')[0])
          .join('; '),
        csrf: login.data.csrfToken,
      });
    }
    const tables: Array<{
      roomId: string;
      matchId: string;
      sessions: Session[];
      peers: Peer[];
      revision: number;
    }> = [];
    for (let i = 0; i < 10; i++) {
      const players = sessions.slice(i * 4, i * 4 + 4);
      const created = z.object({ roomId: z.string(), inviteCode: z.string() }).parse(
        await request('/rooms', players[0], {
          requestId: randomUUID(),
          name: `Performance ${i}`,
          gameId: 'color-match',
          version: '1.0.0',
          options: {},
          seatCount: 4,
        }),
      );
      let revision = 0;
      for (let seat = 1; seat < 4; seat++) {
        revision = revisionSchema.parse(
          await request('/rooms/join', players[seat], {
            requestId: randomUUID(),
            inviteCode: created.inviteCode,
          }),
        ).roomRevision;
        revision = revisionSchema.parse(
          await request(
            `/rooms/${created.roomId}/my-seat`,
            players[seat],
            {
              requestId: randomUUID(),
              expectedRoomRevision: revision,
              seatIndex: seat,
            },
            'PUT',
          ),
        ).roomRevision;
      }
      for (const player of players)
        revision = revisionSchema.parse(
          await request(
            `/rooms/${created.roomId}/my-ready`,
            player,
            {
              requestId: randomUUID(),
              expectedRoomRevision: revision,
              ready: true,
            },
            'PUT',
          ),
        ).roomRevision;
      const started = z.object({ matchId: z.string() }).parse(
        await request(`/rooms/${created.roomId}/start`, players[0], {
          requestId: randomUUID(),
          expectedRoomRevision: revision,
        }),
      );
      tables.push({
        roomId: created.roomId,
        matchId: started.matchId,
        sessions: players,
        peers: [],
        revision: 0,
      });
    }
    await Promise.all(
      tables.flatMap((table) =>
        table.sessions.map(async (session, seat) => {
          const peer = new Peer(base, session, table.matchId, seat);
          peers.push(peer);
          table.peers[seat] = peer;
          await peer.subscribe(table.roomId, 0);
        }),
      ),
    );
    expect(peers.filter((p) => p.socket.readyState === WebSocket.OPEN)).toHaveLength(40);

    const http: number[] = [],
      delivery: number[] = [],
      reconnect: number[] = [];
    const lastCommands = new Map<string, { session: Session; command: object }>();
    async function step(table: (typeof tables)[number], measured: boolean) {
      const current = table.peers[0]!.snapshots.get(table.revision)!.snapshot;
      const view = viewSchema.parse(current.view);
      const seat = view.seats.indexOf(view.currentPlayerId!);
      const session = table.sessions[seat]!;
      const actorView = viewSchema.parse(
        table.peers[seat]!.snapshots.get(table.revision)!.snapshot.view,
      );
      expect(actorView.canDraw).toBe(true);
      const command = {
        requestId: randomUUID(),
        expectedRevision: table.revision,
        action: { type: 'draw_card' },
      };
      const started = performance.now();
      await request(`/matches/${table.matchId}/actions`, session, command);
      const replied = performance.now();
      table.revision++;
      await Promise.all(
        table.peers.map((peer) => peer.wait(() => peer.snapshots.has(table.revision))),
      );
      if (measured) {
        http.push(replied - started);
        delivery.push(
          Math.max(...table.peers.map((p) => p.snapshots.get(table.revision)!.arrived)) - started,
        );
      }
      lastCommands.set(table.matchId, { session, command });
    }
    for (let i = 0; i < 2; i++) await Promise.all(tables.map((table) => step(table, false)));
    const statsQuery = `SELECT xact_commit::float8, xact_rollback::float8, blks_read::float8, blks_hit::float8,
      deadlocks::float8, temp_bytes::float8 FROM pg_stat_database WHERE datname=current_database()`;
    const beforeDb = (await db.query<Record<string, number>>(statsQuery)).rows[0]!;
    const statsStarted = ipc(child, 'measure.started');
    child.send('measure.start');
    await statsStarted;
    const workloadStarted = performance.now();
    for (let round = 0; round < 20; round++) {
      const roundStarted = performance.now();
      await Promise.all(tables.map((table) => step(table, true)));
      if (round === 9)
        await Promise.all(
          tables.map(async (table) => {
            const old = table.peers[0]!;
            await old.close();
            const started = performance.now();
            const replacement = new Peer(base, table.sessions[0]!, table.matchId, 0);
            peers.push(replacement);
            table.peers[0] = replacement;
            await replacement.subscribe(table.roomId, table.revision);
            expect(replacement.snapshots.get(table.revision)!.snapshot.view).toEqual(
              old.snapshots.get(table.revision)!.snapshot.view,
            );
            reconnect.push(performance.now() - started);
          }),
        );
      await sleep(Math.max(0, 500 - (performance.now() - roundStarted)));
    }
    const workloadMs = performance.now() - workloadStarted;
    const statsStopped = ipc(child, 'measure.stopped');
    child.send('measure.stop');
    const api = z
      .object({
        wallMs: z.number(),
        cpuMs: z.number(),
        cpuPercentOfOneCore: z.number(),
        peakRssBytes: z.number(),
        heapUsedBytes: z.number(),
        eventLoopP95Ms: z.number(),
        peakPoolConnections: z.number(),
        peakPoolWaiting: z.number(),
      })
      .parse(await statsStopped);
    const afterDb = (await db.query<Record<string, number>>(statsQuery)).rows[0]!;
    // Finish each real game, then prove duplicate final commands leave persisted revisions unchanged.
    await Promise.all(tables.map((table) => step(table, false)));
    for (const table of tables) {
      const result = matchViewSchema.parse(
        await request(`/matches/${table.matchId}/view`, table.sessions[0]),
      );
      expect(result.status).toBe('finished');
      const last = lastCommands.get(table.matchId)!;
      await request(`/matches/${table.matchId}/actions`, last.session, last.command);
      const foreign = sessions[(sessions.indexOf(table.sessions[0]!) + 4) % 40]!;
      const denied = await fetch(`${base}/api/v1/matches/${table.matchId}/view`, {
        headers: { cookie: foreign.cookie },
        signal: AbortSignal.timeout(10000),
      });
      expect(denied.status).toBe(404);
      await denied.body?.cancel();
    }
    const audit = await db.query<{
      revision: number;
      actions: number;
      status: string;
      frames: number;
    }>(`SELECT m.revision,m.status,
      (SELECT count(*)::int FROM match_actions a WHERE a.match_id=m.id) AS actions,
      (SELECT count(*)::int FROM match_replay_frames f WHERE f.match_id=m.id) AS frames
      FROM matches m ORDER BY m.id`);
    expect(audit.rows).toHaveLength(10);
    for (const row of audit.rows)
      expect(row).toEqual({ revision: 23, actions: 23, status: 'finished', frames: 24 });
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM rooms WHERE status='waiting' AND active_match_id IS NULL",
        )
      ).rows[0].n,
    ).toBe(10);
    expect(peers.flatMap((p) => p.failures)).toEqual([]);
    expect(peers.reduce((n, p) => n + p.pings, 0)).toBeGreaterThan(0);
    expect(peers.filter((p) => p.socket.readyState === WebSocket.OPEN)).toHaveLength(40);
    const report = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      environment: {
        node: process.version,
        os: process.platform,
        kernel: release(),
        arch: process.arch,
        cpuModel: cpus()[0]?.model,
        logicalCpus: cpus().length,
        availableParallelism: availableParallelism(),
        hostMemoryBytes: totalmem(),
      },
      workload: {
        matches: 10,
        accounts: 40,
        sockets: 40,
        warmupActions: 20,
        measuredActions: 200,
        rounds: 20,
        roundIntervalMs: 500,
        workloadMs,
        actionsPerSecond: 200000 / workloadMs,
        concurrentActionRequests: 10,
        completedMatches: 10,
        reconnects: 10,
        modelCalls: 0,
      },
      http: distribution(http),
      allFourSnapshots: distribution(delivery),
      reconnect: distribution(reconnect),
      api,
      databaseCounterDelta: Object.fromEntries(
        Object.entries(afterDb).map(([key, value]) => [key, value - beforeDb[key]!]),
      ),
      correctness: {
        unexpectedErrors: 0,
        foreignReadsDenied: 10,
        duplicateFinalActions: 10,
        persistedActions: 230,
        replayFrames: 240,
        heartbeatPings: peers.reduce((n, p) => n + p.pings, 0),
      },
    };
    await mkdir('.data/d24', { recursive: true });
    await writeFile('.data/d24/baseline.json', JSON.stringify(report, null, 2) + '\n', {
      mode: 0o600,
    });
    console.log(JSON.stringify(report));
  } finally {
    for (const peer of peers) {
      peer.closing = true;
      peer.socket.terminate();
    }
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.send('shutdown');
      const kill = setTimeout(() => child?.kill('SIGKILL'), 10000);
      await exited;
      clearTimeout(kill);
    }
    await db.end();
  }
}, 120000);
