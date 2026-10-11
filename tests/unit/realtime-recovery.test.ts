import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type {
  FastifyInstance,
  FastifyPluginCallback,
} from '../../apps/api/node_modules/fastify/fastify.js';
import { registerRealtime } from '../../apps/api/src/realtime/index.js';
import { normalizeConfig } from '../../apps/api/src/config.js';
import { AppError } from '../../apps/api/src/errors.js';
import { sessionFixture } from '../fixtures/session.js';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const Fastify: () => FastifyInstance = requireApi('fastify');
const websocket: FastifyPluginCallback = requireApi('@fastify/websocket');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  vi.useRealTimers();
});

async function fixture() {
  const app = Fastify();
  await app.register(websocket);
  const session = sessionFixture();
  const authenticate = vi.fn().mockResolvedValue({
    ...session,
    expiresAt: new Date(Date.now() + 60000),
    sessionId: 'test-session',
  });
  const snapshot = vi.fn().mockResolvedValue({ roomRevision: 1, status: 'waiting' });
  let changed!: (roomId: string) => void;
  // Minimal service doubles at the registration boundary; real Fastify and WS transport.
  type Deps = Parameters<typeof registerRealtime>;
  const auth = { authenticate, onRevoked: () => () => {} } as unknown as Deps[1];
  const rooms = {
    snapshot,
    recordActivity: vi.fn().mockResolvedValue(undefined),
    onChanged: (listener: typeof changed) => {
      changed = listener;
      return () => {};
    },
  } as unknown as Deps[2];
  const matches = { onChanged: () => () => {} } as unknown as Deps[3];
  const scheduler = { wake() {} } as unknown as Deps[4];
  const dispose = registerRealtime(
    app,
    auth,
    rooms,
    matches,
    scheduler,
    normalizeConfig({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: 3001,
      DATABASE_URL: 'postgresql://unused/unused',
      WEB_ORIGIN: 'http://test.local',
      ENABLE_DEV_LAB: false,
      LOG_LEVEL: 'silent',
      PRESENCE_GRACE_MS: 0,
    }),
  );
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const sockets: WebSocket[] = [];
  cleanup.push(async () => {
    sockets.forEach((socket) => socket.terminate());
    dispose();
    await app.close();
  });
  async function connect() {
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/api/v1/ws/session`, {
      origin: 'http://test.local',
    });
    sockets.push(socket);
    const messages: Array<Record<string, unknown>> = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === 'session.ready')).toBe(true),
    );
    return { socket, messages };
  }
  return { authenticate, snapshot, changed, connect, address };
}

it.each([
  [new Error('temporary database outage'), 1013],
  [new AppError('UNAUTHENTICATED', 'revoked', 401), 4001],
] as const)(
  'classifies heartbeat failures without treating outages as logout (%s)',
  async (error, code) => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { socket } = await f.connect();
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    f.authenticate.mockRejectedValue(error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await closed).toBe(code);
  },
);

it('keeps a transient broadcast failure recoverable rather than revoking room membership', async () => {
  const f = await fixture();
  const { socket, messages } = await f.connect();
  const roomId = '00000000-0000-4000-8000-000000000001';
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
  await vi.waitFor(() =>
    expect(messages.some((message) => message.type === 'room.presence')).toBe(true),
  );
  const closed = new Promise<number>((resolve) => socket.once('close', resolve));
  f.snapshot.mockRejectedValueOnce(new Error('temporary database outage'));
  f.changed(roomId);
  expect(await closed).toBe(1013);
  expect(messages.some((message) => message.type === 'subscription.revoked')).toBe(false);
});

it('recovers a typed service error during WS message authentication', async () => {
  const f = await fixture();
  const { socket } = await f.connect();
  let closeCode: number | undefined;
  socket.once('close', (code) => {
    closeCode = code;
  });
  f.authenticate.mockRejectedValueOnce(new AppError('SERVICE_UNAVAILABLE', 'temporary', 503, true));
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'ping', requestId: 'test' }));
  await vi.waitFor(() => expect(closeCode).toBe(1013));
});

it('returns a retryable HTTP status when session verification fails before WS upgrade', async () => {
  const f = await fixture();
  f.authenticate.mockRejectedValueOnce(new Error('temporary database outage'));
  const status = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${f.address.replace('http:', 'ws:')}/api/v1/ws/session`, {
      origin: 'http://test.local',
    });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('unexpected upgrade'));
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode!);
    });
    socket.on('error', () => {});
  });
  expect(status).toBe(503);
});
