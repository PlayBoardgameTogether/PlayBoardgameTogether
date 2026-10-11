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
  const assertAccess = vi.fn().mockResolvedValue(undefined);
  const recordSubscriptionActivity = vi.fn().mockResolvedValue(undefined);
  const liveView = vi.fn(async (accountId: string, matchId: string) => ({
    matchId,
    revision: 1,
    view: { privateFor: accountId },
  }));
  let changed!: (roomId: string) => void;
  let matchChanged!: (
    roomId: string,
    matchId: string,
    revision: number,
    events: unknown[],
    roomChanged: boolean,
  ) => void;
  // Minimal service doubles at the registration boundary; real Fastify and WS transport.
  type Deps = Parameters<typeof registerRealtime>;
  const auth = { authenticate, onRevoked: () => () => {} } as unknown as Deps[1];
  const rooms = {
    snapshot,
    assertAccess,
    recordSubscriptionActivity,
    recordActivity: vi.fn().mockResolvedValue(undefined),
    onChanged: (listener: typeof changed) => {
      changed = listener;
      return () => {};
    },
  } as unknown as Deps[2];
  const matches = {
    liveView,
    onChanged: (listener: typeof matchChanged) => {
      matchChanged = listener;
      return () => {};
    },
  } as unknown as Deps[3];
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
    await dispose();
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
  return {
    authenticate,
    snapshot,
    assertAccess,
    recordSubscriptionActivity,
    liveView,
    changed,
    matchChanged,
    connect,
    address,
    dispose,
  };
}

it.each([
  [new Error('temporary database outage'), 1013],
  [new AppError('UNAUTHENTICATED', 'revoked', 401), 4001],
] as const)(
  'classifies heartbeat failures without treating outages as logout (%s)',
  async (error, code) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const f = await fixture();
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

it('projects once per account in a broadcast while checking every subscribed tab', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  const accountB = {
    ...sessionFixture(),
    account: { ...sessionFixture().account, id: '00000000-0000-4000-8000-000000000099' },
    expiresAt: new Date(Date.now() + 60000),
    sessionId: 'other-session',
  };
  f.authenticate.mockResolvedValue(accountB);
  const third = await f.connect();
  f.authenticate.mockImplementation(async (request) =>
    request === f.authenticate.mock.calls[2]?.[0]
      ? accountB
      : { ...sessionFixture(), expiresAt: new Date(Date.now() + 60000), sessionId: 'test-session' },
  );
  // The upgrade calls are the first three auth calls (connect does not subscribe).
  const roomId = '00000000-0000-4000-8000-000000000001';
  for (const item of [first, second, third])
    item.socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
  await vi.waitFor(() =>
    expect(
      [first, second, third].every((item) =>
        item.messages.some((message) => message.type === 'room.snapshot'),
      ),
    ).toBe(true),
  );
  f.snapshot.mockClear();
  f.assertAccess.mockClear();
  f.liveView.mockClear();
  f.matchChanged(roomId, 'match', 1, [], false);
  await vi.waitFor(() =>
    expect(
      [first, second, third].every((item) =>
        item.messages.some((message) => message.type === 'match.snapshot'),
      ),
    ).toBe(true),
  );
  expect(f.assertAccess).toHaveBeenCalledTimes(3);
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.liveView).toHaveBeenCalledTimes(2);
  expect(first.messages.find((message) => message.type === 'match.snapshot')?.snapshot).toEqual(
    second.messages.find((message) => message.type === 'match.snapshot')?.snapshot,
  );
  expect(
    third.messages.find((message) => message.type === 'match.snapshot')?.snapshot,
  ).toMatchObject({ view: { privateFor: accountB.account.id } });
  f.matchChanged(roomId, 'match', 1, [], false);
  await vi.waitFor(() => expect(f.liveView).toHaveBeenCalledTimes(4));
});

it('revokes a removed tab before delivering a shared room snapshot', async () => {
  const f = await fixture();
  const tabs = [await f.connect(), await f.connect()];
  const roomId = '00000000-0000-4000-8000-000000000001';
  for (const tab of tabs)
    tab.socket.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
  await vi.waitFor(() =>
    expect(
      tabs.every((tab) => tab.messages.some((message) => message.type === 'room.snapshot')),
    ).toBe(true),
  );
  tabs.forEach((tab) => {
    tab.messages.length = 0;
  });
  f.snapshot.mockClear();
  f.assertAccess
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new AppError('ROOM_NOT_FOUND', 'removed', 404));
  f.changed(roomId);
  await vi.waitFor(() =>
    expect(tabs[1]!.messages.some((message) => message.type === 'subscription.revoked')).toBe(true),
  );
  expect(tabs[0]!.messages.some((message) => message.type === 'room.snapshot')).toBe(true);
  expect(tabs[1]!.messages.some((message) => message.type === 'room.snapshot')).toBe(false);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
});

it('batches subscribed room renewals and does not overlap slow heartbeat authentication', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const f = await fixture();
  const tabs = [await f.connect(), await f.connect()];
  for (const tab of tabs)
    tab.socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'room.subscribe',
        roomId: '00000000-0000-4000-8000-000000000001',
      }),
    );
  await vi.waitFor(() =>
    expect(
      tabs.every((tab) => tab.messages.some((message) => message.type === 'room.snapshot')),
    ).toBe(true),
  );
  let finish!: (value: Awaited<ReturnType<typeof f.authenticate>>) => void;
  f.authenticate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const calls = f.authenticate.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.authenticate).toHaveBeenCalledTimes(calls + 2);
  expect(f.recordSubscriptionActivity).not.toHaveBeenCalled();
  finish({
    ...sessionFixture(),
    expiresAt: new Date(Date.now() + 60000),
    sessionId: 'test-session',
  });
  await vi.waitFor(() => expect(f.recordSubscriptionActivity).toHaveBeenCalledTimes(1));
  expect(f.recordSubscriptionActivity.mock.calls[0]![0]).toHaveLength(2);
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

it('waits for an in-flight heartbeat on shutdown and skips late renewals', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const f = await fixture();
  await f.connect();
  let finish!: (value: Awaited<ReturnType<typeof f.authenticate>>) => void;
  f.authenticate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  let closed = false;
  const closing = f.dispose().then(() => {
    closed = true;
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(closed).toBe(false);
  finish({
    ...sessionFixture(),
    expiresAt: new Date(Date.now() + 60000),
    sessionId: 'test-session',
  });
  await closing;
  expect(closed).toBe(true);
  expect(f.recordSubscriptionActivity).not.toHaveBeenCalled();
});
