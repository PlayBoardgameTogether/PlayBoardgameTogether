import { MatchResultPanel } from '../matches/MatchResultPanel.js';
import { useMatchSession } from '../matches/useMatchSession.js';
import { GameRules } from './GameRules.js';
import { type MatchView } from '@boardgame/protocol';
import { navigate } from '../platform.js';
import { clientGame, type GameBoard } from '../game-registry.js';
import { AssetResolver } from '../assets/resolver.js';
import { AudioControls } from '../assets/AudioControls.js';
import type { PresentationAudioPort } from '@boardgame/game-sdk/assets';
import { GameErrorBoundary, PageFeedback } from '@boardgame/ui';
const aiNames = {
  idle: '等待行动',
  queued: '排队中',
  running: '正在思考…',
  submitting: '正在行动…',
  blocked: '点数不足或受阻',
};
function GameSurface({
  render,
  data,
  disabled,
  events,
  act,
  resolver,
  audio,
}: {
  render: GameBoard;
  data: MatchView;
  disabled: boolean;
  events: unknown[];
  act: (action: unknown) => void;
  resolver: AssetResolver | undefined;
  audio?: PresentationAudioPort;
}) {
  const playerNames = Object.fromEntries(
    (data.players ?? []).map((player) => [player.seatId, player.displayName]),
  );
  return render(data.view, disabled, events, act, resolver, audio, playerNames);
}
export function MatchPage({ id }: { id: string }) {
  const {
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
    confirmPending,
    audio,
  } = useMatchSession(id);
  if (connection === 'auth-expired')
    return (
      <div className="empty">
        <h1>会话已失效</h1>
        <p>请重新登录后读取本人对局。</p>
        <button onClick={() => navigate('/login')}>前往登录</button>
      </div>
    );
  if (error && !data)
    return (
      <div className="empty">
        <h1>无法读取对局</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>重新同步</button>
      </div>
    );
  if (!data)
    return (
      <PageFeedback title="正在加载对局视图…" loading>
        正在恢复你的座位与已保存局面。
      </PageFeedback>
    );
  return (
    <div className="match-page">
      <section className="page-heading match-heading">
        <div>
          <p className="eyebrow">{data.status === 'active' ? '正在对局' : '对局已结束'}</p>
          <h1>{clientGame(data.gameId, data.gameVersion)?.name ?? '游戏版本不可用'}</h1>
          <p>
            你的座位 {data.seatIndex + 1} ·{' '}
            {data.status === 'finished'
              ? '已结束'
              : data.status === 'aborted'
                ? '已终止'
                : '进行中'}
          </p>
        </div>
        <div className="match-heading-actions">
          <span
            className={`status ${connection === 'online' ? 'status--ok' : 'status--warn'}`}
            role="status"
          >
            {connection === 'online' ? '实时同步' : '网络重连中…'}
          </span>
          <button
            className="secondary"
            onClick={() =>
              navigate(data.status === 'aborted' ? '/profile' : `/rooms/${data.roomId}`)
            }
          >
            {data.status === 'aborted' ? '返回我的资料' : '返回房间'}
          </button>
        </div>
      </section>
      {connection !== 'online' && (
        <p className="error-notice" role="status">
          {connection === 'recovery-blocked'
            ? '对局存档暂时无法恢复。'
            : '网络重连中，操作已暂停。'}
        </p>
      )}
      {pending && pendingPhase === 'uncertain' && (
        <p className="error-notice" role="status">
          操作结果尚未确认。
          <button className="secondary" disabled={busy} onClick={() => void confirmPending()}>
            确认操作结果
          </button>
        </p>
      )}
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      <div className="match-action-feedback" role="status" aria-live="polite">
        {busy
          ? pendingPhase === 'checking'
            ? '正在核对操作结果…'
            : '正在保存操作…'
          : notice || '\u00a0'}
      </div>
      {data.status === 'finished' && <MatchResultPanel data={data} />}
      <div className="match-layout">
        <section className="match-table" aria-label="游戏桌">
          <GameErrorBoundary key={id}>
            {board ? (
              <GameSurface
                render={board}
                data={data}
                disabled={
                  busy ||
                  !!pending ||
                  connection !== 'online' ||
                  data.status !== 'active' ||
                  data.controller.type !== 'human'
                }
                events={events}
                act={(action) => void act(action)}
                resolver={resolver}
                audio={audio}
              />
            ) : (
              <PageFeedback title="正在加载游戏界面…" loading />
            )}
          </GameErrorBoundary>
        </section>
        <aside className="match-support" aria-label="对局辅助">
          <h2>对局工具</h2>
          {data.status === 'aborted' && (
            <a className="button-link secondary" href={`/matches/${id}/replay`}>
              查看回放
            </a>
          )}
          {data.status === 'active' && <p className="muted">返回房间不影响当前对局。</p>}
          {data.status === 'active' && (
            <details className="panel controller-panel">
              <summary>
                控制方式 · {data.controller.type === 'human' ? '由你操作' : '托管中'}
              </summary>
              <a href="/official-ai">官方 AI / 我的点数</a>
              <p>
                {data.controller.type === 'script' || data.controller.type === 'model'
                  ? `托管中 · ${aiNames[data.aiStatus.status]}`
                  : '由你操作'}
              </p>
              {data.controller.type === 'human' ? (
                <>
                  <p className="muted">支持模型 AI 托管当前席位。</p>
                  {modelProfiles
                    .filter((profile) => profile.has_credential || profile.endpoint_id === 'mock')
                    .map((profile) => (
                      <button
                        className="secondary"
                        key={profile.id}
                        disabled={busy || !!pending || connection !== 'online'}
                        onClick={() => void setController('model', profile.id)}
                      >
                        启用模型 · {profile.name}
                        {profile.official_offer_id && (
                          <>
                            （
                            {profile.official_token_pricing
                              ? `按 token 计费，单次最多 ${profile.official_points_per_action} 点`
                              : `${profile.official_points_per_action} 点/行动`}
                            ，上限 {profile.official_match_budget} 点/局）
                          </>
                        )}
                      </button>
                    ))}
                </>
              ) : (
                <button
                  disabled={busy || !!pending || connection !== 'online'}
                  onClick={() => void setController('human')}
                >
                  收回控制
                </button>
              )}
              <p className="muted">托管期间 AI 将代为出牌，可随时收回控制。</p>
            </details>
          )}
          <GameRules gameId={data.gameId} version={data.gameVersion} />
          <AudioControls />
          {assetError && (
            <p role="status" className="error-notice">
              {assetError} 外观资源未就绪，使用占位显示。
            </p>
          )}
          {data.controllers && (
            <section className="seat-control-strip" aria-label="座位控制状态">
              {data.controllers.map((item) => (
                <span key={item.seatIndex}>
                  座位 {item.seatIndex + 1} ·{' '}
                  {item.type === 'human'
                    ? '玩家'
                    : `${item.type === 'script' ? '脚本 AI' : '模型 AI'} · ${item.safeErrorCode === 'AI_FALLBACK_USED' ? '由脚本 AI 兜底完成' : aiNames[item.aiStatus]}`}
                </span>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
