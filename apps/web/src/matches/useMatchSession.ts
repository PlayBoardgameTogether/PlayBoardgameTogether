import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { type MatchView, type ModelProfile } from '@boardgame/protocol';
import { api, command, navigate } from '../platform.js';
import { clientGame, type GameBoard } from '../game-registry.js';
import { AssetResolver, verifyManifest } from '../assets/resolver.js';
import { audioManager, ownAudio } from '../assets/audio-manager.js';
import { PresentationConsumer } from '../assets/presentation.js';
import { BoardAudio } from '../assets/board-audio.js';
import { singleFlight } from '../network/scheduling.js';
import { startMatchConnection, type MatchConnectionState } from './connection.js';
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
  const [connection, setConnection] = useState<MatchConnectionState>('connecting');
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
    const stopConnection = startMatchConnection({
      id,
      signal: controller.signal,
      isCurrent: () => generation.current === token,
      currentView: () => latest.current,
      isConnected: () => connected.current,
      refresh: () => refresh(token),
      reconcile: () => reconcile(token),
      on: {
        authenticated: (currentAccountId) => {
          accountId.current = currentAccountId;
          audioManager.setAccount(currentAccountId);
          const saved = readPending(id, currentAccountId);
          pendingRef.current = saved;
          setPending(saved);
          setPendingPhase(saved ? 'checking' : undefined);
        },
        ready: (currentAccountId) =>
          ownAudio(currentAccountId, id, async () => {
            presentation.current.reset();
            const baseline = await readSnapshot();
            if (generation.current === token) presentation.current.baseline(baseline.revision);
          }),
        snapshot: merge,
        live: (snapshot) => {
          presentation.current.consume(id, snapshot.revision, snapshot.cues ?? [], true, (cue) => {
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
              void audioManager.play(cue.cueId, resources.resolver.manifest, resources.contract);
          });
        },
        baseline: (revision) => presentation.current.baseline(revision),
        disconnected: () => {
          presentation.current.reset();
          audioManager.invalidate();
        },
        expired: () => {
          storePending(undefined);
          latest.current = undefined;
          setData(undefined);
        },
        clearPending: () => storePending(undefined),
        closed: returnHome,
        connected: (active) => {
          connected.current = active;
        },
        connection: setConnection,
        error: setError,
      },
    });
    return () => {
      generation.current++;
      controller.abort();
      if (reads.current?.token === token) reads.current = undefined;
      connected.current = false;
      stopConnection();
      audioManager.clear();
      presentation.current.reset();
      soundResources.current = undefined;
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
