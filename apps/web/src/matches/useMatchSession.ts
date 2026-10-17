import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import {
  matchSnapshotMessageSchema,
  roomSnapshotSchema,
  type MatchView,
  type ModelProfile,
} from '@boardgame/protocol';
import { api, command, navigate } from '../platform.js';
import { clientGame, type GameBoard } from '../game-registry.js';
import { AssetResolver, verifyManifest } from '../assets/resolver.js';
import { audioManager, ownAudio } from '../assets/audio-manager.js';
import { PresentationConsumer } from '../assets/presentation.js';
import { BoardAudio } from '../assets/board-audio.js';
import { reconnectBackoff, singleFlight } from '../network/scheduling.js';
import type { AssetContract } from '@boardgame/game-sdk/assets';
type Pending = {
  accountId: string;
  matchId: string;
  requestId: string;
  expectedRevision: number;
  expectedControllerEpoch: number;
  action: unknown;
  attempts: number;
};
type Connection =
  | 'connecting'
  | 'syncing'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'auth-expired'
  | 'recovery-blocked';
const pendingKey = (id: string) => `boardgame:pending-match:${id}`;
function readPending(id: string, accountId: string): Pending | undefined {
  try {
    const raw = sessionStorage.getItem(pendingKey(id));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      'accountId' in value &&
      'matchId' in value &&
      'requestId' in value &&
      'expectedRevision' in value &&
      'expectedControllerEpoch' in value &&
      'action' in value &&
      'attempts' in value &&
      value.accountId === accountId &&
      value.matchId === id &&
      typeof value.requestId === 'string' &&
      typeof value.expectedRevision === 'number' &&
      typeof value.expectedControllerEpoch === 'number' &&
      typeof value.attempts === 'number'
    )
      return value as Pending;
  } catch {
    /* Ignore a damaged local record. */
  }
  sessionStorage.removeItem(pendingKey(id));
  return undefined;
}
export function useMatchSession(id: string) {
  const [data, setData] = useState<MatchView>();
  const [board, setBoard] = useState<GameBoard>();
  const [events, setEvents] = useState<unknown[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending>();
  const [pendingPhase, setPendingPhase] = useState<'submitting' | 'checking' | 'uncertain'>();
  // A ref also locks same-tick clicks and background recovery before React renders.
  const operation = useRef<number | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const latest = useRef<MatchView | undefined>(undefined);
  const pendingRef = useRef<Pending | undefined>(undefined);
  const accountId = useRef<string | undefined>(undefined);
  const connected = useRef(false);
  const generation = useRef(0);
  const reads = useRef<
    | {
        token: number;
        snapshot: () => Promise<MatchView>;
      }
    | undefined
  >(undefined);
  const seenEvents = useRef(new Set<string>());
  const returnedHome = useRef(false);
  const [resolver, setResolver] = useState<AssetResolver>();
  const [assetError, setAssetError] = useState('');
  const presentation = useRef(new PresentationConsumer());
  const soundResources = useRef<
    | {
        resolver: AssetResolver;
        contract: AssetContract;
      }
    | undefined
  >(undefined);
  const boardAudio = useRef(
    new BoardAudio(
      () => audioManager.playbackEpoch,
      (cueId) => {
        const resources = soundResources.current;
        if (resources)
          void audioManager.play(cueId, resources.resolver.manifest, resources.contract);
      },
    ),
  );
  function returnHome() {
    if (returnedHome.current) return;
    returnedHome.current = true;
    connected.current = false;
    generation.current++;
    storePending(undefined);
    navigate('/', undefined, true);
  }
  function storePending(value: Pending | undefined) {
    pendingRef.current = value;
    setPending(value);
    if (!value) setPendingPhase(undefined);
    if (value) sessionStorage.setItem(pendingKey(id), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(id));
  }
  function merge(next: MatchView) {
    if (next.status === 'aborted' && latest.current?.status === 'active') {
      returnHome();
      return;
    }
    if (latest.current && next.revision < latest.current.revision) return;
    const presentationGame = clientGame(next.gameId, next.gameVersion);
    const keepResult =
      presentationGame &&
      'finishBehavior' in presentationGame &&
      presentationGame.finishBehavior === 'stay';
    if (next.status === 'finished' && latest.current?.status === 'active' && !keepResult) {
      if (returnedHome.current) return;
      returnedHome.current = true;
      connected.current = false;
      generation.current++;
      storePending(undefined);
      navigate(`/rooms/${next.roomId}`, { completedMatchId: id }, true);
      return;
    }
    if (latest.current && next.revision === latest.current.revision)
      next = {
        ...next,
        controller:
          next.controller.controllerVersion >= latest.current.controller.controllerVersion
            ? next.controller
            : latest.current.controller,
        aiStatus:
          next.aiStatus.version >= latest.current.aiStatus.version
            ? next.aiStatus
            : latest.current.aiStatus,
      };
    latest.current = next;
    setData(next);
    if (next.delivery !== 'live' || !next.events?.length) return;
    const fresh = next.events.filter((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('eventId' in item) ||
        typeof item.eventId !== 'string'
      )
        return false;
      if (seenEvents.current.has(item.eventId)) return false;
      seenEvents.current.add(item.eventId);
      return true;
    });
    if (fresh.length) setEvents((old) => [...old, ...fresh].slice(-20));
  }
  async function refresh(token: number) {
    const current = reads.current;
    if (!current || current.token !== token) throw new DOMException('Page changed', 'AbortError');
    const next = await current.snapshot();
    if (generation.current === token) merge(next);
    return next;
  }
  async function send(value: Pending, token: number) {
    const sending = { ...value, attempts: value.attempts + 1 };
    if (generation.current === token) storePending(sending);
    try {
      const response = await api.submitMatchAction(id, {
        requestId: sending.requestId,
        expectedRevision: sending.expectedRevision,
        expectedControllerEpoch: sending.expectedControllerEpoch,
        action: sending.action,
      });
      if (generation.current !== token) return;
      storePending(undefined);
      merge(response);
      setError('');
      setNotice('操作已保存。');
    } catch (cause) {
      if (generation.current !== token) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
        storePending(undefined);
        connected.current = false;
        latest.current = undefined;
        setData(undefined);
        setConnection('auth-expired');
      } else if (
        cause instanceof ApiError &&
        (cause.code === 'STATE_CONFLICT' ||
          cause.code === 'CONTROLLER_CONFLICT' ||
          cause.code === 'CONTROLLER_NOT_HUMAN' ||
          (!cause.retryable && cause.code !== 'SERVICE_UNAVAILABLE'))
      ) {
        storePending(undefined);
        setError(
          cause.code === 'STATE_CONFLICT'
            ? '局面已变化，请检查当前状态并再次确认。'
            : cause.message,
        );
        await refresh(token).catch(() => undefined);
      } else return false;
    }
    return true;
  }
  async function checkReceipt(token: number, manual = false) {
    const value = pendingRef.current;
    if (!value || generation.current !== token) return;
    setPendingPhase('checking');
    try {
      const receipt = await api.matchCommandReceipt(id, value.requestId);
      if (generation.current !== token) return;
      if (receipt.outcome === 'accepted') {
        // Keep the durable request until the authoritative view has also recovered.
        let view = await refresh(token);
        if (generation.current !== token) return;
        // A coalesced read may have started before this command committed.
        if (view.revision < receipt.appliedRevision) view = await refresh(token);
        if (generation.current !== token) return;
        if (view.revision < receipt.appliedRevision)
          throw new Error('Snapshot does not yet include the accepted command');
        storePending(undefined);
        setError('');
        setNotice('操作已保存，已同步最新局面。');
      } else if (value.attempts < 3 || manual) {
        if (!(await send(value, token)) && generation.current === token)
          setPendingPhase('uncertain');
      } else setPendingPhase('uncertain');
    } catch (cause) {
      if (generation.current !== token) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
        storePending(undefined);
        connected.current = false;
        latest.current = undefined;
        setData(undefined);
        setConnection('auth-expired');
      } else setPendingPhase('uncertain');
    }
  }
  async function reconcile(token: number, manual = false) {
    if (!pendingRef.current || generation.current !== token || operation.current !== undefined)
      return;
    operation.current = token;
    setBusy(true);
    try {
      await checkReceipt(token, manual);
    } finally {
      if (operation.current === token) operation.current = undefined;
      if (generation.current === token) setBusy(false);
    }
  }
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    const readSnapshot = singleFlight(() => api.matchSnapshot(id, controller.signal));
    reads.current = {
      token,
      snapshot: readSnapshot,
    };
    returnedHome.current = false;
    presentation.current = new PresentationConsumer();
    boardAudio.current = new BoardAudio(
      () => audioManager.playbackEpoch,
      (cueId) => {
        const resources = soundResources.current;
        if (resources)
          void audioManager.play(cueId, resources.resolver.manifest, resources.contract);
      },
    );
    audioManager.clear();
    latest.current = undefined;
    pendingRef.current = undefined;
    operation.current = undefined;
    setPendingPhase(undefined);
    accountId.current = undefined;
    seenEvents.current.clear();
    setData(undefined);
    setEvents([]);
    setPending(undefined);
    setBusy(false);
    setNotice('');
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let roomId: string | undefined;
    const backoff = reconnectBackoff();
    let stopped = false;
    let lastPong = Date.now();
    let connectedOnce = false;
    let subscriptionReady = false;
    let roomSubscriptionReady = false;
    let networkOnline = navigator.onLine;
    let releaseAudio: (() => void) | undefined;
    const sync = singleFlight(async () => {
      if (generation.current !== token || stopped) return;
      if (!networkOnline) {
        connected.current = false;
        setConnection('offline');
        return;
      }
      try {
        const view = await refresh(token);
        if (generation.current !== token) return;
        roomId = view.roomId;
        setError('');
        if (pendingRef.current) await reconcile(token);
        if (generation.current !== token) return;
        if (!networkOnline) {
          connected.current = false;
          setConnection('offline');
          return;
        }
        connected.current =
          socket?.readyState === WebSocket.OPEN &&
          (subscriptionReady || (roomSubscriptionReady && view.status === 'finished'));
        if (connected.current) presentation.current.baseline(view.revision);
        setConnection(
          connected.current
            ? 'online'
            : socket?.readyState === WebSocket.OPEN
              ? 'syncing'
              : 'offline',
        );
      } catch (cause) {
        if (generation.current !== token) return;
        connected.current = false;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
          stopped = true;
          socket?.close();
          storePending(undefined);
          latest.current = undefined;
          setData(undefined);
          setConnection('auth-expired');
        } else if (
          cause instanceof ApiError &&
          (cause.code === 'RECOVERY_BLOCKED' || cause.code === 'GAME_VERSION_UNAVAILABLE')
        ) {
          stopped = true;
          socket?.close();
          setConnection('recovery-blocked');
          setError(cause.message);
        } else {
          setConnection('offline');
          setError('无法同步对局，请检查连接后重试。');
        }
      }
    });
    const connect = () => {
      if (generation.current !== token || stopped || !roomId || !navigator.onLine) return;
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING)
        return;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      const url = new URL('/api/v1/ws/session', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      socket = ws;
      presentation.current.reset();
      audioManager.invalidate();
      subscriptionReady = false;
      roomSubscriptionReady = false;
      setConnection(connectedOnce ? 'reconnecting' : 'connecting');
      ws.onopen = () => {
        if (generation.current !== token || socket !== ws) return;
        connectedOnce = true;
        lastPong = Date.now();
        ws.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId }));
      };
      ws.onmessage = (event) => {
        if (generation.current !== token || socket !== ws) return;
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (!message || typeof message !== 'object' || !('type' in message)) return;
          if (message.type === 'pong') {
            lastPong = Date.now();
            return;
          }
          if (
            message.type === 'room.snapshot' &&
            'roomId' in message &&
            message.roomId === roomId
          ) {
            roomSubscriptionReady = true;
            // The active match arrives in its own identity-projected WS snapshot.
            // A finished match is no longer included in the room subscription.
            const room = roomSnapshotSchema.safeParse(
              'snapshot' in message ? message.snapshot : undefined,
            );
            if (
              latest.current?.status === 'finished' ||
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
                connected.current &&
                subscriptionReady &&
                snapshot.delivery === 'live' &&
                snapshot.events?.length
              ) {
                presentation.current.consume(
                  id,
                  snapshot.revision,
                  snapshot.cues ?? [],
                  true,
                  (cue) => {
                    const game = clientGame(snapshot.gameId, snapshot.gameVersion);
                    if ('boardAudio' in game && game.boardAudio) {
                      if (
                        audioManager.available &&
                        audioManager.owner &&
                        !audioManager.preferences.muted &&
                        !document.hidden
                      )
                        boardAudio.current.authorize(cue.eventId);
                      return;
                    }
                    const resources = soundResources.current;
                    if (resources)
                      void audioManager.play(
                        cue.cueId,
                        resources.resolver.manifest,
                        resources.contract,
                      );
                  },
                );
              }
              merge(parsed.snapshot);
              if (!subscriptionReady) {
                subscriptionReady = true;
                backoff.reset();
                void sync();
              }
            }
          }
          if (message.type === 'room.closed' && 'roomId' in message && message.roomId === roomId) {
            returnHome();
            return;
          }
          if (
            message.type === 'subscription.revoked' &&
            'roomId' in message &&
            message.roomId === roomId
          ) {
            stopped = true;
            connected.current = false;
            setConnection('offline');
            setError('已失去房间访问权限。');
            ws.close();
          }
        } catch {
          connected.current = false;
          setConnection('syncing');
          setError('实时消息无法读取，正在重新同步。');
          void sync();
        }
      };
      ws.onclose = (event) => {
        if (generation.current !== token || socket !== ws) return;
        subscriptionReady = false;
        roomSubscriptionReady = false;
        connected.current = false;
        presentation.current.reset();
        audioManager.invalidate();
        if (event.code === 4001) {
          stopped = true;
          storePending(undefined);
          latest.current = undefined;
          setData(undefined);
          setConnection('auth-expired');
          return;
        }
        if (stopped) return;
        setConnection('offline');
        // An expired session can reject the WS upgrade before the server can
        // send close code 4001. Recheck via authenticated HTTP so a failed
        // handshake cannot leave the previous private View on screen forever.
        void sync().then(() => {
          if (generation.current !== token || stopped || socket !== ws || !latest.current) return;
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            connect();
          }, backoff.next());
        });
      };
    };
    const onOnline = () => {
      networkOnline = true;
      if (generation.current !== token) return;
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
      connected.current = false;
      presentation.current.reset();
      audioManager.invalidate();
      setConnection('offline');
    };
    const onFocus = () => {
      if (socket?.readyState === WebSocket.OPEN) void sync();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    const initialize = singleFlight(async () => {
      if (generation.current !== token || stopped) return;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      try {
        const account = await api.me(controller.signal);
        if (generation.current !== token) return;
        accountId.current = account.account.id;
        audioManager.setAccount(account.account.id);
        const saved = readPending(id, account.account.id);
        pendingRef.current = saved;
        setPending(saved);
        setPendingPhase(saved ? 'checking' : undefined);
        const view = await refresh(token);
        if (generation.current !== token) return;
        roomId = view.roomId;
        // A retained aborted match is a read-only archive. It does not subscribe
        // to a closed room, which would otherwise redirect it to the lobby.
        if (view.status === 'aborted') {
          storePending(undefined);
          setError('');
          setConnection('online');
          return;
        }
        releaseAudio = ownAudio(account.account.id, id, async () => {
          presentation.current.reset();
          const baseline = await readSnapshot();
          if (generation.current === token) presentation.current.baseline(baseline.revision);
        });
        setError('');
        connect();
      } catch (cause) {
        if (generation.current !== token) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
          stopped = true;
          storePending(undefined);
          setConnection('auth-expired');
          return;
        }
        if (
          cause instanceof ApiError &&
          (cause.code === 'RECOVERY_BLOCKED' || cause.code === 'GAME_VERSION_UNAVAILABLE')
        ) {
          stopped = true;
          setConnection('recovery-blocked');
          setError(cause.message);
          return;
        }
        if (cause instanceof ApiError && cause.code === 'MATCH_NOT_FOUND') {
          stopped = true;
          setConnection('offline');
          setError('当前会话无权读取该局。');
          return;
        }
        setConnection('offline');
        setError('服务暂时不可用，正在重新连接。');
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
      generation.current++;
      controller.abort();
      if (reads.current?.token === token) reads.current = undefined;
      connected.current = false;
      releaseAudio?.();
      audioManager.clear();
      presentation.current.reset();
      soundResources.current = undefined;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(pollTimer);
      clearInterval(heartbeat);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      socket?.close();
    };
  }, [id]);
  useEffect(() => {
    let disposed = false;
    setResolver(undefined);
    setAssetError('');
    soundResources.current = undefined;
    audioManager.invalidate();
    if (data?.assetBinding) {
      const binding = data.assetBinding;
      void Promise.all([api.assets.version(binding.versionId), api.assets.contracts()])
        .then(async ([version, contracts]) => {
          if (version.manifestHash !== binding.manifestHash)
            throw new Error('资源清单与对局锁定摘要不符');
          const manifest = await verifyManifest(version.manifest, binding.manifestHash);
          const contract = contracts.find(
            (item) => item.hash === manifest.assetContract.hash,
          )?.contract;
          if (!contract) throw new Error('资源契约不可用');
          if (disposed) return;
          const resolver = new AssetResolver(manifest);
          setResolver(resolver);
          soundResources.current = { resolver, contract };
        })
        .catch((cause) => {
          if (!disposed)
            setAssetError(cause instanceof Error ? cause.message : '资源不可用，保留文字桌面。');
        });
    }
    return () => {
      disposed = true;
    };
  }, [data?.assetBinding?.versionId, data?.assetBinding?.manifestHash]);
  useEffect(() => {
    if (connection === 'auth-expired') {
      audioManager.dispose();
      setResolver(undefined);
      soundResources.current = undefined;
    }
  }, [connection]);
  useEffect(() => {
    const token = generation.current;
    void api
      .playableModelProfiles()
      .then((profiles) => {
        if (generation.current === token) setModelProfiles(profiles);
      })
      .catch(() => undefined);
  }, [id]);
  useEffect(() => {
    const game = data && clientGame(data.gameId, data.gameVersion);
    if (!game) {
      setBoard(undefined);
      return;
    }
    let disposed = false;
    void game
      .load()
      .then((render) => {
        if (!disposed) setBoard(() => render);
      })
      .catch(() => {
        if (!disposed) setError('无法加载此游戏版本。');
      });
    return () => {
      disposed = true;
    };
  }, [data?.gameId, data?.gameVersion]);
  async function act(action: unknown) {
    const view = latest.current;
    if (
      !view ||
      operation.current !== undefined ||
      pendingRef.current ||
      !connected.current ||
      view.status !== 'active'
    )
      return;
    const token = generation.current;
    const value: Pending = {
      accountId: accountId.current!,
      matchId: id,
      requestId: command(),
      expectedRevision: view.revision,
      expectedControllerEpoch: view.controller.controllerEpoch,
      action,
      attempts: 0,
    };
    operation.current = token;
    storePending(value);
    setPendingPhase('submitting');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!(await send(value, token)) && generation.current === token) {
        if (navigator.onLine) await checkReceipt(token);
        else setPendingPhase('uncertain');
      }
    } finally {
      if (operation.current === token) operation.current = undefined;
      if (generation.current === token) setBusy(false);
    }
  }
  async function setController(type: 'human' | 'script' | 'model', profileId?: string) {
    const view = latest.current;
    if (
      !view ||
      operation.current !== undefined ||
      pendingRef.current ||
      !connected.current ||
      view.status !== 'active'
    )
      return;
    const token = generation.current;
    operation.current = token;
    setBusy(true);
    setError('');
    try {
      const control = {
        requestId: command(),
        expectedControllerEpoch: view.controller.controllerEpoch,
        controllerType: type,
        ...(type === 'script'
          ? { policyId: 'basic-v1' as const }
          : type === 'model' && profileId
            ? { profileId }
            : {}),
      };
      const next = await api.setMyController(id, control);
      if (generation.current === token) {
        merge(next);
        setNotice(
          type === 'human' ? '已收回控制，可以继续操作。' : '已启用模型托管，可随时收回控制。',
        );
      }
    } catch (cause) {
      if (generation.current === token) {
        setError(cause instanceof Error ? cause.message : '无法切换控制权');
        await refresh(token).catch(() => undefined);
      }
    } finally {
      if (operation.current === token) operation.current = undefined;
      if (generation.current === token) setBusy(false);
    }
  }
  return {
    data,
    board,
    events,
    error,
    busy,
    notice,
    pending,
    pendingPhase,
    connection,
    modelProfiles,
    resolver,
    assetError,
    act,
    setController,
    confirmPending: () => reconcile(generation.current, true),
    audio: boardAudio.current.playCue,
  };
}
