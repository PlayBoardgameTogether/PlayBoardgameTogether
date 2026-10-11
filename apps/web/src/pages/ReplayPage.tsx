import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReplayPresentation } from '@boardgame/game-sdk/presentation';
import type { MatchReplay } from '@boardgame/protocol';
import { GameErrorBoundary, PageFeedback } from '@boardgame/ui';
import { api } from '../platform.js';
import { clientGame, type GameBoard } from '../game-registry.js';
import { AssetResolver, verifyManifest } from '../assets/resolver.js';
import { observeReplayMotion } from '../games/replay-motion.js';
import '../styles/replay.css';

const noEvents: unknown[] = [];
function ReplayTable({
  board,
  frame,
  assets,
  presentation,
}: {
  board: GameBoard;
  frame: MatchReplay;
  assets: AssetResolver | undefined;
  presentation: ReplayPresentation;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) return observeReplayMotion(root.current, presentation);
  }, [presentation]);
  const names = Object.fromEntries(
    frame.players.map((player) => [player.seatId, player.displayName]),
  );
  // Historical projected events can animate, but never authorize actions or live audio.
  const desktop = board(
    frame.view,
    !presentation.animate,
    presentation.animate ? frame.events : noEvents,
    () => undefined,
    assets,
    undefined,
    names,
    presentation,
  );
  return (
    <div
      ref={root}
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {desktop}
    </div>
  );
}

export function ReplayPage({ id }: { id: string }) {
  const [frame, setFrame] = useState<MatchReplay>();
  const [board, setBoard] = useState<GameBoard>();
  const [assets, setAssets] = useState<AssetResolver>();
  const [assetError, setAssetError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const request = useRef(0);
  const [transition, setTransition] = useState({ id: 0, animate: false });
  const [reset, setReset] = useState(0);
  const [animationUntil, setAnimationUntil] = useState(0);
  const currentFrame = useRef<MatchReplay | undefined>(undefined);
  const presentationId = useRef(0);
  const presentation = useMemo<ReplayPresentation>(
    () => ({
      ...transition,
      hold(durationMs) {
        if (
          presentationId.current !== transition.id ||
          !transition.animate ||
          !Number.isFinite(durationMs) ||
          durationMs < 1 ||
          durationMs > 60000
        )
          return;
        setAnimationUntil((old) => Math.max(old, performance.now() + durationMs));
      },
    }),
    [transition],
  );

  async function load(revision?: number, animate = false) {
    const token = ++request.current;
    setBusy(true);
    setError('');
    try {
      const next = await api.matchReplay(id, revision);
      if (request.current === token) {
        const previous = currentFrame.current;
        const adjacent =
          animate &&
          previous?.matchId === next.matchId &&
          previous.gameId === next.gameId &&
          previous.gameVersion === next.gameVersion &&
          previous.revision + 1 === next.revision;
        if (!adjacent) setReset((old) => old + 1);
        currentFrame.current = next;
        presentationId.current = token;
        setAnimationUntil(0);
        setTransition({ id: token, animate: adjacent });
        setFrame(next);
      }
    } catch (cause) {
      if (request.current === token) {
        setFrame(undefined);
        setPlaying(false);
        setError(cause instanceof Error ? cause.message : '无法读取回放');
      }
    } finally {
      if (request.current === token) setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      ++request.current;
      presentationId.current = -1;
    };
  }, [id]);

  useEffect(() => {
    if (!frame) return;
    let disposed = false;
    setBoard(undefined);
    void clientGame(frame.gameId, frame.gameVersion)
      .load()
      .then((render) => {
        if (!disposed) setBoard(() => render);
      })
      .catch(() => {
        if (!disposed) setError('无法加载此游戏版本的桌面');
      });
    return () => {
      disposed = true;
    };
  }, [frame?.gameId, frame?.gameVersion]);

  useEffect(() => {
    let disposed = false;
    setAssets(undefined);
    setAssetError('');
    const binding = frame?.assetBinding;
    if (binding)
      void api.assets
        .version(binding.versionId)
        .then(async (version) => {
          if (version.manifestHash !== binding.manifestHash) throw new Error('图包摘要不符');
          const manifest = await verifyManifest(version.manifest, binding.manifestHash);
          if (!disposed) setAssets(new AssetResolver(manifest));
        })
        .catch(() => {
          if (!disposed) setAssetError('原图包暂不可用，使用游戏默认画面。');
        });
    return () => {
      disposed = true;
    };
  }, [frame?.assetBinding?.versionId, frame?.assetBinding?.manifestHash]);

  useEffect(() => {
    if (!playing || busy || !frame) return;
    const remaining = Math.max(0, animationUntil - performance.now());
    if (frame.revision >= frame.lastRevision) {
      const timer = setTimeout(() => setPlaying(false), Math.max(1500 / speed, remaining));
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => void load(frame.revision + 1, true),
      Math.max(1500 / speed, remaining),
    );
    return () => clearTimeout(timer);
  }, [playing, busy, frame?.revision, speed, animationUntil]);

  function seek(revision: number, animate = false) {
    setPlaying(false);
    void load(revision, animate);
  }

  // Automatic frame reads must not flash the controls into their disabled style.
  // Manual seeks stop playback and supersede any pending read via its request token.
  const controlsBusy = busy && !playing;
  const game = frame && clientGame(frame.gameId, frame.gameVersion);
  // Keep sandbox desktops mounted: remounting reloads their HTML and flashes
  // their initial loading screen. Built-in boards reset only on discontinuous seeks.
  const desktopKey =
    frame && game && 'preserveReplayDesktop' in game && game.preserveReplayDesktop
      ? `${id}:${frame.gameId}:${frame.gameVersion}`
      : `${id}:${frame?.gameId}:${frame?.gameVersion}:${reset}`;

  return (
    <div className="replay-page">
      <section className="replay-heading">
        <div>
          <p className="eyebrow">对局回放</p>
          <h1>{frame ? clientGame(frame.gameId, frame.gameVersion).name : '回放'}</h1>
          {frame && (
            <p className="muted">
              只读回放 · 你的视角 · 座位 {frame.seatIndex + 1} ·{' '}
              {frame.status === 'aborted' ? '已中止' : '已结束'}
            </p>
          )}
        </div>
        <a className="social-back" href="/profile/history">
          返回对局记录
        </a>
      </section>
      {error && (
        <div role="alert" className="error-notice">
          {error}{' '}
          <button className="secondary" onClick={() => void load()}>
            重新加载
          </button>
        </div>
      )}
      {assetError && (
        <p role="status" className="muted">
          {assetError}
        </p>
      )}
      {frame ? (
        <>
          {frame.firstRevision > 0 && (
            <p className="muted" role="status">
              这局开始于回放功能上线前，仅保存第 {frame.firstRevision} 步起的局面。
            </p>
          )}
          <section className="replay-table" aria-label="回放棋桌" aria-busy={busy}>
            <GameErrorBoundary key={desktopKey}>
              {board ? (
                <ReplayTable
                  board={board}
                  frame={frame}
                  assets={assets}
                  presentation={presentation}
                />
              ) : (
                <PageFeedback title="正在加载游戏桌面…" loading />
              )}
            </GameErrorBoundary>
          </section>
          <nav className="replay-controls" aria-label="回放控制">
            <div className="replay-progress">
              <label htmlFor="replay-position">
                第 {frame.revision} / {frame.lastRevision} 步
              </label>
              <input
                id="replay-position"
                aria-label="回放进度"
                type="range"
                min={frame.firstRevision}
                max={frame.lastRevision}
                value={frame.revision}
                disabled={controlsBusy || frame.firstRevision === frame.lastRevision}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span className="muted" aria-live="polite">
                {frame.actorSeatId
                  ? `${frame.players.find((player) => player.seatId === frame.actorSeatId)?.displayName ?? '玩家'}行动`
                  : frame.revision === 0
                    ? '初始局面'
                    : '已保存局面'}
              </span>
            </div>
            <div className="replay-buttons">
              <button
                className="secondary"
                disabled={controlsBusy || frame.revision <= frame.firstRevision}
                onClick={() => seek(frame.firstRevision)}
              >
                开头
              </button>
              <button
                className="secondary"
                disabled={controlsBusy || frame.revision <= frame.firstRevision}
                onClick={() => seek(frame.revision - 1)}
              >
                上一步
              </button>
              <button
                disabled={controlsBusy || !board || frame.firstRevision === frame.lastRevision}
                onClick={() => {
                  if (playing) setPlaying(false);
                  else {
                    if (frame.revision === frame.lastRevision) void load(frame.firstRevision);
                    setPlaying(true);
                  }
                }}
              >
                {playing ? '暂停' : '播放'}
              </button>
              <button
                className="secondary"
                disabled={controlsBusy || frame.revision >= frame.lastRevision}
                onClick={() => seek(frame.revision + 1, true)}
              >
                下一步
              </button>
              <button
                className="secondary"
                disabled={controlsBusy || frame.revision >= frame.lastRevision}
                onClick={() => seek(frame.lastRevision)}
              >
                末尾
              </button>
              <label>
                速度{' '}
                <select
                  aria-label="播放速度"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
            </div>
          </nav>
        </>
      ) : (
        busy && <PageFeedback title="正在读取回放…" loading />
      )}
    </div>
  );
}
