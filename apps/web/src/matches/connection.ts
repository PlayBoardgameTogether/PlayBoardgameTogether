import { ApiError } from '@boardgame/client-sdk';
import {
  matchSnapshotMessageSchema,
  roomSnapshotSchema,
  type MatchView,
} from '@boardgame/protocol';
import { api, command } from '../platform.js';
import { reconnectBackoff, singleFlight } from '../network/scheduling.js';

export type MatchConnectionState =
  | 'connecting'
  | 'syncing'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'auth-expired'
  | 'recovery-blocked';

type MatchConnectionOptions = {
  id: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  currentView: () => MatchView | undefined;
  isConnected: () => boolean;
  refresh: () => Promise<MatchView>;
  reconcile: () => Promise<void>;
  on: {
    authenticated: (accountId: string) => void;
    ready: (accountId: string) => () => void;
    snapshot: (view: MatchView) => void;
    live: (view: MatchView) => void;
    baseline: (revision: number) => void;
    disconnected: () => void;
    expired: () => void;
    clearPending: () => void;
    closed: () => void;
    connected: (active: boolean) => void;
    connection: (state: MatchConnectionState) => void;
    error: (message: string) => void;
  };
};

// Owns a single page's subscription, retry timers and browser listeners.
// Rules, action receipts and presentation remain with their existing owners.
export function startMatchConnection({
  id,
  signal,
  isCurrent,
  currentView,
  isConnected,
  refresh,
  reconcile,
  on,
}: MatchConnectionOptions): () => void {
  const setConnection = on.connection;
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let roomId: string | undefined;
  const backoff = reconnectBackoff();
  let stopped = false;
  const active = () => !stopped && !signal.aborted && isCurrent();
  let lastPong = Date.now();
  let connectedOnce = false;
  let subscriptionReady = false;
  let roomSubscriptionReady = false;
  let networkOnline = navigator.onLine;
  let releaseAudio: (() => void) | undefined;
  const sync = singleFlight(async () => {
    if (!active() || stopped) return;
    if (!networkOnline) {
      on.connected(false);
      setConnection('offline');
      return;
    }
    try {
      const view = await refresh();
      if (!active()) return;
      roomId = view.roomId;
      on.error('');
      await reconcile();
      if (!active()) return;
      if (!networkOnline) {
        on.connected(false);
        setConnection('offline');
        return;
      }
      const connected =
        socket?.readyState === WebSocket.OPEN &&
        (subscriptionReady || (roomSubscriptionReady && view.status === 'finished'));
      on.connected(connected);
      if (connected) on.baseline(view.revision);
      setConnection(
        connected ? 'online' : socket?.readyState === WebSocket.OPEN ? 'syncing' : 'offline',
      );
    } catch (cause) {
      if (!active()) return;
      on.connected(false);
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
        stopped = true;
        socket?.close();
        on.expired();
        setConnection('auth-expired');
      } else if (
        cause instanceof ApiError &&
        (cause.code === 'RECOVERY_BLOCKED' || cause.code === 'GAME_VERSION_UNAVAILABLE')
      ) {
        stopped = true;
        socket?.close();
        setConnection('recovery-blocked');
        on.error(cause.message);
      } else {
        setConnection('offline');
        on.error('无法同步对局，请检查连接后重试。');
      }
    }
  });
  const connect = () => {
    if (!active() || stopped || !roomId || !navigator.onLine) return;
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING)
      return;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    const url = new URL('/api/v1/ws/session', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    socket = ws;
    on.disconnected();
    subscriptionReady = false;
    roomSubscriptionReady = false;
    setConnection(connectedOnce ? 'reconnecting' : 'connecting');
    ws.onopen = () => {
      if (!active() || socket !== ws) return;
      connectedOnce = true;
      lastPong = Date.now();
      ws.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
    };
    ws.onmessage = (event) => {
      if (!active() || socket !== ws) return;
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'pong') {
          lastPong = Date.now();
          return;
        }
        if (message.type === 'room.snapshot' && 'roomId' in message && message.roomId === roomId) {
          roomSubscriptionReady = true;
          // The active match arrives in its own identity-projected WS snapshot.
          // A finished match is no longer included in the room subscription.
          const room = roomSnapshotSchema.safeParse(
            'snapshot' in message ? message.snapshot : undefined,
          );
          if (
            currentView()?.status === 'finished' ||
            (room.success && room.data.activeMatchId !== id)
          ) {
            backoff.reset();
            void sync();
          }
        }
        if (message.type === 'match.snapshot') {
          const parsed = matchSnapshotMessageSchema.parse(message);
          if (parsed.matchId === id) {
            const snapshot = parsed.snapshot;
            if (
              isConnected() &&
              subscriptionReady &&
              snapshot.delivery === 'live' &&
              snapshot.events?.length
            ) {
              on.live(snapshot);
            }
            on.snapshot(parsed.snapshot);
            if (!subscriptionReady) {
              subscriptionReady = true;
              backoff.reset();
              void sync();
            }
          }
        }
        if (message.type === 'room.closed' && 'roomId' in message && message.roomId === roomId) {
          on.closed();
          return;
        }
        if (
          message.type === 'subscription.revoked' &&
          'roomId' in message &&
          message.roomId === roomId
        ) {
          stopped = true;
          on.connected(false);
          setConnection('offline');
          on.error('已失去房间访问权限。');
          ws.close();
        }
      } catch {
        on.connected(false);
        setConnection('syncing');
        on.error('实时消息无法读取，正在重新同步。');
        void sync();
      }
    };
    ws.onclose = (event) => {
      if (!active() || socket !== ws) return;
      subscriptionReady = false;
      roomSubscriptionReady = false;
      on.connected(false);
      on.disconnected();
      if (event.code === 4001) {
        stopped = true;
        on.expired();
        setConnection('auth-expired');
        return;
      }
      if (stopped) return;
      setConnection('offline');
      // An expired session can reject the WS upgrade before the server can
      // send close code 4001. Recheck via authenticated HTTP so a failed
      // handshake cannot leave the previous private View on screen forever.
      void sync().then(() => {
        if (!active() || stopped || socket !== ws || !currentView()) return;
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          connect();
        }, backoff.next());
      });
    };
  };
  const onOnline = () => {
    networkOnline = true;
    if (!active()) return;
    if (!roomId) {
      void initialize();
      return;
    }
    if (retryTimer) clearTimeout(retryTimer);
    if (socket?.readyState !== WebSocket.OPEN) connect();
    else void sync();
  };
  const onOffline = () => {
    networkOnline = false;
    on.connected(false);
    on.disconnected();
    setConnection('offline');
  };
  const onFocus = () => {
    if (socket?.readyState === WebSocket.OPEN) void sync();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  const initialize = singleFlight(async () => {
    if (!active() || stopped) return;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    try {
      const account = await api.me(signal);
      if (!active()) return;
      on.authenticated(account.account.id);
      const view = await refresh();
      if (!active()) return;
      roomId = view.roomId;
      // A retained aborted match is a read-only archive. It does not subscribe
      // to a closed room, which would otherwise redirect it to the lobby.
      if (view.status === 'aborted') {
        on.clearPending();
        on.error('');
        setConnection('online');
        return;
      }
      releaseAudio = on.ready(account.account.id);
      on.error('');
      connect();
    } catch (cause) {
      if (!active()) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
        stopped = true;
        on.expired();
        setConnection('auth-expired');
        return;
      }
      if (
        cause instanceof ApiError &&
        (cause.code === 'RECOVERY_BLOCKED' || cause.code === 'GAME_VERSION_UNAVAILABLE')
      ) {
        stopped = true;
        setConnection('recovery-blocked');
        on.error(cause.message);
        return;
      }
      if (cause instanceof ApiError && cause.code === 'MATCH_NOT_FOUND') {
        stopped = true;
        setConnection('offline');
        on.error('当前会话无权读取该局。');
        return;
      }
      setConnection('offline');
      on.error('服务暂时不可用，正在重新连接。');
      retryTimer = window.setTimeout(() => void initialize(), backoff.next());
    }
  });
  void initialize();
  const pollTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) void sync();
  }, 15000);
  const heartbeat = window.setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPong > 60000) {
      socket.close();
      return;
    }
    socket.send(JSON.stringify({ protocolVersion: 1, type: 'ping', requestId: command() }));
  }, 20000);
  return () => {
    stopped = true;
    releaseAudio?.();
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    clearInterval(pollTimer);
    clearInterval(heartbeat);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    socket?.close();
  };
}
