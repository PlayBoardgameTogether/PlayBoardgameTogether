import { useMatchSession } from '../matches/useMatchSession.js';
import { GameRules } from './GameRules.js';
import { type MatchView } from '@boardgame/protocol';
import { navigate } from '../platform.js';
import { clientGame, type GameBoard } from '../game-registry.js';
import { AssetResolver } from '../assets/resolver.js';
import { AudioControls } from '../assets/AudioControls.js';
import type { PresentationAudioPort } from '@boardgame/game-sdk/assets';
import { ActionHint, GameErrorBoundary, PageFeedback } from '@boardgame/ui';
const aiNames = {
  idle: '等待行动',
  queued: '等待处理',
  running: '正在思考',
  submitting: '正在保存操作',
  blocked: '暂时受阻，请收回控制或检查配置',
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
          <p className="eyebrow">对局 · revision {data.revision}</p>
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
            {connection === 'online' ? '实时同步' : '正在恢复连接'}
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
            ? '此对局的存档或版本暂不可恢复。'
            : '连接中断或正在同步，操作已暂停。'}
        </p>
      )}
      {pending && (
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
      {(busy || notice) && <ActionHint title={busy ? '正在保存操作…' : notice} />}
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
          {data.status !== 'active' && (
            <a className="button-link secondary" href={`/matches/${id}/replay`}>
              查看回放
            </a>
          )}
          <p className="muted">返回房间不会退出对局。规则、声音与托管设置可按需展开。</p>
          {data.status === 'active' && (
            <details className="panel controller-panel">
              <summary>
                控制方式 · {data.controller.type === 'human' ? '由你操作' : '托管中'}
              </summary>
              <h2>控制方式</h2>
              <p>
                {data.controller.type === 'script' || data.controller.type === 'model'
                  ? `托管中 · ${aiNames[data.aiStatus.status]}`
                  : '由你操作'}
              </p>
              {data.controller.type === 'human' ? (
                <>
                  <p className="muted">
                    真人座位不能开启脚本托管；脚本 AI 请在开局前添加至专用座位。
                  </p>
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
              <p className="muted">
                托管会持续到主动收回，关闭页面不会停止。外部模型会收到此座位可见的游戏信息。
              </p>
            </details>
          )}
          <GameRules gameId={data.gameId} version={data.gameVersion} />
          <AudioControls />
          {assetError && (
            <p role="status" className="error-notice">
              {assetError} 图片使用语义占位，操作仍可继续。
            </p>
          )}
          {data.controllers && (
            <section className="seat-control-strip" aria-label="座位控制状态">
              {data.controllers.map((item) => (
                <span key={item.seatIndex}>
                  座位 {item.seatIndex + 1} ·{' '}
                  {item.type === 'human'
                    ? '真人'
                    : `${item.type === 'script' ? '脚本 AI' : '模型 AI'} · ${item.safeErrorCode === 'AI_FALLBACK_USED' ? '本次由脚本兜底完成' : aiNames[item.aiStatus]}`}
                </span>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
