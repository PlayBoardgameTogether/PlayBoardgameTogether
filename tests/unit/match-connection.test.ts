import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../packages/client-sdk/src/index.js';
import type { MatchView } from '../../packages/protocol/src/index.js';
import { startMatchConnection } from '../../apps/web/src/matches/connection.js';
import { sessionFixture } from '../fixtures/session.js';

const me = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/src/platform.js', () => ({
  api: { me },
  command: () => 'heartbeat-request',
}));

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  send = vi.fn();
  constructor(readonly url: URL) {
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let browser: EventTarget;
const disposers: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  browser = new EventTarget();
  vi.stubGlobal('window', Object.assign(browser, { setTimeout, setInterval }));
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { href: 'https://playboard.example/matches/current' });
  vi.stubGlobal('WebSocket', Socket);
  me.mockReset().mockResolvedValue(sessionFixture());
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture(status: MatchView['status'] = 'active') {
  const view: MatchView = {
    matchId: '10000000-0000-4000-8000-000000000002',
    roomId: '10000000-0000-4000-8000-000000000003',
    gameId: 'color-match',
    gameVersion: '1.0.0',
    revision: 0,
    status,
    seatIndex: 0,
    controller: {
      type: 'human',
      controllerEpoch: 0,
      controllerVersion: 0,
      policyId: null,
    },
    aiStatus: { status: 'idle', version: 0, safeErrorCode: null },
    view: { privateFor: 'current-account' },
    delivery: 'snapshot',
  };
  let connected = false;
  const releaseAudio = vi.fn();
  const on = {
    authenticated: vi.fn(),
    ready: vi.fn(() => releaseAudio),
    snapshot: vi.fn(),
    live: vi.fn(),
    baseline: vi.fn(),
    disconnected: vi.fn(),
    expired: vi.fn(),
    clearPending: vi.fn(),
    closed: vi.fn(),
    connected: vi.fn((active: boolean) => {
      connected = active;
    }),
    connection: vi.fn(),
    error: vi.fn(),
  };
  const refresh = vi.fn<() => Promise<MatchView>>().mockResolvedValue(view);
  const reconcile = vi.fn(async () => {});
  const controller = new AbortController();
  const stop = startMatchConnection({
    id: view.matchId,
    signal: controller.signal,
    isCurrent: () => true,
    currentView: () => view,
    isConnected: () => connected,
    refresh,
    reconcile,
    on,
  });
  disposers.push(stop);
  return { view, on, refresh, reconcile, stop, releaseAudio, controller };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

it('enables actions only after the match subscription and authority read, without replaying catch-up audio', async () => {
  const { view, on, refresh } = fixture();
  await settle();
  const socket = Socket.instances[0]!;
  socket.open();
  expect(socket.url.protocol).toBe('wss:');
  expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
    type: 'room.subscribe',
    roomId: view.roomId,
  });
  expect(on.connected).not.toHaveBeenCalledWith(true);
  const message = {
    protocolVersion: 1,
    type: 'match.snapshot',
    matchId: view.matchId,
    revision: view.revision,
    snapshot: view,
  };
  socket.message(message);
  await settle();
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(on.connected).toHaveBeenLastCalledWith(true);
  expect(on.live).not.toHaveBeenCalled();
  socket.message({
    ...message,
    snapshot: { ...view, revision: 1, delivery: 'live', events: [{ eventId: 'live-event' }] },
  });
  expect(on.live).toHaveBeenCalledTimes(1);
  on.connected(false);
  socket.message({
    ...message,
    snapshot: { ...view, revision: 2, delivery: 'live', events: [{ eventId: 'offline-event' }] },
  });
  expect(on.live).toHaveBeenCalledTimes(1);
});

it('rechecks a failed WS handshake through HTTP and expires the private view instead of retrying authentication', async () => {
  const { on, refresh } = fixture();
  await settle();
  refresh.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 'Expired', false, 'fixture'));
  Socket.instances[0]!.close();
  await settle();
  expect(on.expired).toHaveBeenCalledTimes(1);
  expect(on.connection).toHaveBeenLastCalledWith('auth-expired');
  await vi.advanceTimersByTimeAsync(60000);
  expect(Socket.instances).toHaveLength(1);
});

it('coalesces focus reads and releases timers, listeners and delayed messages on disposal', async () => {
  const { view, on, refresh, stop, releaseAudio } = fixture();
  await settle();
  const socket = Socket.instances[0]!;
  socket.open();
  const pending = Promise.withResolvers<MatchView>();
  refresh.mockReturnValueOnce(pending.promise);
  browser.dispatchEvent(new Event('focus'));
  browser.dispatchEvent(new Event('focus'));
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  expect(releaseAudio).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  const calls = on.connection.mock.calls.length;
  pending.resolve(view);
  await settle();
  socket.message({ protocolVersion: 1, type: 'room.closed', roomId: view.roomId });
  browser.dispatchEvent(new Event('online'));
  browser.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(on.closed).not.toHaveBeenCalled();
  expect(on.connection).toHaveBeenCalledTimes(calls);
  expect(Socket.instances).toHaveLength(1);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('does not reconnect a subscription revoked by the server', async () => {
  const { view, on } = fixture();
  await settle();
  const socket = Socket.instances[0]!;
  socket.open();
  socket.message({ type: 'subscription.revoked', roomId: view.roomId });
  browser.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(on.connected).toHaveBeenLastCalledWith(false);
  expect(on.error).toHaveBeenLastCalledWith('已失去房间访问权限。');
  expect(Socket.instances).toHaveLength(1);
});

it('keeps an aborted match as an archive without subscribing to its closed room', async () => {
  const { on } = fixture('aborted');
  await settle();
  expect(on.clearPending).toHaveBeenCalledTimes(1);
  expect(on.connection).toHaveBeenLastCalledWith('online');
  expect(on.ready).not.toHaveBeenCalled();
  expect(Socket.instances).toHaveLength(0);
});
