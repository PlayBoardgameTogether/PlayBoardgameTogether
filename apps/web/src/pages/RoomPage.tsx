import { useRoomSession } from '../rooms/useRoomSession.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, command, navigate } from '../platform.js';
import type { AssetVersionInfo } from '@boardgame/protocol/assets';
import { type RoomCommandDetails, type RoomSnapshot, type ModelProfile } from '@boardgame/protocol';
import { BotSeatSettings } from './BotSeatSettings.js';
import { GameRules } from './GameRules.js';
import { loadGames, gamePath } from './game-catalog.js';
import { mergeRoomSnapshot } from './roomSnapshot.js';
import { PageFeedback } from '@boardgame/ui';
import { InviteFriends } from '../social/InviteFriends.js';
export function RoomPage({ id }: { id: string }) {
  const [invite, setInvite] = useState(() => {
    const state: unknown = history.state;
    return state &&
      typeof state === 'object' &&
      'inviteCode' in state &&
      typeof state.inviteCode === 'string'
      ? state.inviteCode
      : '';
  });
  const [copyNotice, setCopyNotice] = useState('');

  const { room, setRoom, me, error, setError, online, connected, setConnected, active } =
    useRoomSession(id, enterMatch, returnHome);
  const [busy, setBusy] = useState(false);
  const [gameName, setGameName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(() => {
    const state: unknown = history.state;
    return !!(state && typeof state === 'object' && 'inviteCode' in state && state.inviteCode);
  });
  const [players, setPlayers] = useState<{
    min: number;
    max: number;
  }>({ min: 2, max: 2 });
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsRefresh, setModelsRefresh] = useState(0);
  useEffect(() => {
    if (!room?.permissions.isHost || room.status !== 'waiting') return;
    let disposed = false;
    setModelsLoading(true);
    setModelsError('');
    void api
      .modelProfiles()
      .then((profiles) => {
        if (!disposed) setModelProfiles(profiles);
      })
      .catch((cause) => {
        if (!disposed) {
          setModelProfiles([]);
          setModelsError(cause instanceof Error ? cause.message : '模型配置读取失败，请重试');
        }
      })
      .finally(() => {
        if (!disposed) setModelsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [room?.permissions.isHost, room?.status, modelsRefresh]);
  const [assetVersions, setAssetVersions] = useState<AssetVersionInfo[]>([]);
  useEffect(() => {
    if (room?.gameId)
      void api.assets
        .versions(room.gameId)
        .then(setAssetVersions)
        .catch(() => undefined);
  }, [room?.gameId]);
  const [completedMatchId] = useState<string | undefined>(() => {
    const state: unknown = history.state;
    if (
      state &&
      typeof state === 'object' &&
      'completedMatchId' in state &&
      typeof state.completedMatchId === 'string'
    )
      return state.completedMatchId;
    return undefined;
  });
  const enteringMatch = useRef(false);

  const returnedHome = useRef(false);
  function returnHome() {
    if (returnedHome.current) return;
    returnedHome.current = true;
    navigate('/', undefined, true);
  }
  function enterMatch(matchId: string) {
    if (enteringMatch.current || returnedHome.current) return;
    enteringMatch.current = true;
    navigate(`/matches/${matchId}`);
  }

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    void loadGames()
      .then((games) => {
        const game = games.find(
          (item) => item.id === room.gameId && item.version === room.gameVersion,
        );
        if (game && !disposed) {
          setPlayers(game.players);
          setGameName(game.name);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [room?.gameId, room?.gameVersion]);
  async function run(details: RoomCommandDetails) {
    if (!room || !connected || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.roomCommand(id, {
        ...details,
        requestId: command(),
        expectedRoomRevision: room.roomRevision,
      });
      if (!active.current) return;
      if ('inviteCode' in next) {
        setInviteOpen(true);
        setInvite(next.inviteCode ?? '');
        setCopyNotice(next.inviteCode ? '' : '本次响应无法重取原码，请重新刷新邀请码。');
        history.replaceState(null, '', location.href);
      }
      if ('matchId' in next) {
        enterMatch(next.matchId);
        return;
      }
      if (details.type === 'leave' || details.type === 'close') {
        returnHome();
        return;
      }
      if ('room' in next) updateRoom(next.room);
      else if ('roomRevision' in next) updateRoom(next);
    } catch (cause) {
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : '操作失败');
      try {
        const next = await api.room(id);
        if (active.current) updateRoom(next);
      } catch {
        if (active.current) setConnected(false);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function updateRoom(next: RoomSnapshot) {
    if (next.status === 'closed') {
      returnHome();
      return;
    }
    setRoom((old) => mergeRoomSnapshot(old, next));
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopyNotice('邀请码已复制');
    } catch {
      setCopyNotice('复制失败，请选择邀请码手动复制。');
    }
  }
  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room) return;
    const fields = new FormData(event.currentTarget);
    void run({
      type: 'config',
      name: String(fields.get('name')),
      gameId: room.gameId,
      version: room.gameVersion,
      options: room.options,
      seatCount: Number(fields.get('seatCount')),
    });
  }
  if (error && !room)
    return (
      <div className="empty">
        <h1>无法进入房间</h1>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>返回</button>
      </div>
    );
  if (!room || !me)
    return (
      <PageFeedback title="正在加载房间…" loading>
        正在恢复席位与准备状态。
      </PageFeedback>
    );
  const mine = room.seats.find((seat) => seat.ownerAccountId === me.account.id);
  const waiting = room.status === 'waiting';
  const playing = room.matchStatus === 'active';
  const seated = room.seats.filter(
    (seat: { ownerAccountId: string | null; occupantKind: string }) =>
      seat.ownerAccountId || seat.occupantKind === 'bot',
  ).length;
  const prepared = room.seats.filter((seat: { ready: boolean }) => seat.ready).length;
  const primaryStart = room.permissions.isHost && mine?.ready;
  const disabled = !connected || busy;
  return (
    <div className="room-page">
      <a className="room-back" href={gamePath({ id: room.gameId, version: room.gameVersion })}>
        ← 返回游戏详情
      </a>
      <section className="page-heading room-heading">
        <div>
          <p className="eyebrow">{waiting ? '等待开局' : '对局进行中'}</p>
          <h1>{room.name}</h1>
          <p>
            {gameName || room.gameId} · {room.seatCount} 人桌 · {room.members.length} 位成员
          </p>
        </div>
        <div className="room-heading-actions">
          <span className={`status ${connected ? 'status--ok' : 'status--warn'}`}>
            {connected ? '实时同步' : '连接中断，状态可能过期'}
          </span>
          {!playing && (
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void run({ type: 'leave' })}
            >
              退出房间
            </button>
          )}
        </div>
      </section>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {completedMatchId && (
        <section className="round-complete" aria-label="本局已结束">
          <div>
            <h2>本局已结束，已返回房间</h2>
            <p>席位已保留，重新准备即可开始下一局。</p>
          </div>
          <a
            className="button-link secondary"
            href={`/matches/${encodeURIComponent(completedMatchId)}`}
          >
            查看本局结果
          </a>
        </section>
      )}
      <fieldset className="room-fieldset" disabled={disabled}>
        <section className="room-ready-bar" aria-label="准备与开局">
          <div>
            <h2>
              {waiting
                ? mine?.ready
                  ? '已准备，等待开局'
                  : mine
                    ? '准备好了吗？'
                    : '先选一个座位'
                : '对局正在进行'}
            </h2>
            <p className="muted">
              {waiting ? '席位、规则或资源包变更会取消真人准备。' : '返回此页不会退出对局。'}
            </p>
            {waiting && room.startBlockers.length > 0 && (
              <ul className="room-blockers">
                {room.startBlockers.map((blocker: string) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
            {busy && <p role="status">正在保存房间操作，请稍候…</p>}
          </div>
          <div className="room-ready-controls">
            {waiting && mine && (
              <button
                className={mine.ready ? 'secondary' : ''}
                onClick={() => void run({ type: 'ready', ready: !mine.ready })}
              >
                {mine.ready ? '取消准备' : '准备'}
              </button>
            )}
            {waiting && room.permissions.isHost && (
              <button
                className={primaryStart ? '' : 'secondary'}
                disabled={!room.permissions.canStart}
                onClick={() => void run({ type: 'start' })}
              >
                开始游戏
              </button>
            )}
            {room.activeMatchId && (
              <button onClick={() => room.activeMatchId && enterMatch(room.activeMatchId)}>
                进入对局
              </button>
            )}
          </div>
        </section>
        <section className="room-seating" aria-labelledby="room-seats-title">
          <div className="room-section-heading">
            <h2 id="room-seats-title">玩家席位</h2>
            <span className="muted">
              {seated}/{room.seatCount} 已入座 · {prepared}/{room.seatCount} 已准备
            </span>
          </div>
          <div className="seat-grid">
            {room.seats.map((seat) => {
              const member = room.members.find((item) => item.accountId === seat.ownerAccountId);
              const bot = seat.occupantKind === 'bot';
              const own = seat.ownerAccountId === me.account.id;
              return (
                <article
                  className={`seat-card${own ? ' seat-card--mine' : ''}${!member && !bot ? ' seat-card--empty' : ''}`}
                  key={seat.seatId}
                >
                  <p className="eyebrow">
                    座位 {seat.seatIndex + 1}
                    {own ? ' · 你' : ''}
                  </p>
                  <h3>{bot ? (seat.botName ?? '脚本 AI') : (member?.displayName ?? '等待入座')}</h3>
                  <p className="muted">
                    {bot ? (
                      seat.botPolicyId === 'model' ? (
                        '模型 AI · 已就绪'
                      ) : (
                        '脚本 AI · 已就绪'
                      )
                    ) : member ? (
                      <>
                        {seat.ownerAccountId === room.hostAccountId ? '房主 · ' : ''}
                        {seat.ready ? '已准备' : '未准备'} ·{' '}
                        {online.includes(member.accountId) ? '在线' : '离线'}
                      </>
                    ) : (
                      '邀请朋友，或由房主添加 AI'
                    )}
                  </p>
                  <div className="seat-controls">
                    {!seat.ownerAccountId && !bot && waiting && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => void run({ type: 'seat', seatIndex: seat.seatIndex })}
                        >
                          坐这里
                        </button>
                        {room.permissions.isHost && (
                          <button
                            className="secondary"
                            onClick={() =>
                              void run({
                                type: 'add-bot',
                                seatId: seat.seatId,
                                settings: { policyId: 'basic-v1' },
                              })
                            }
                          >
                            添加脚本 AI
                          </button>
                        )}
                      </>
                    )}
                    {room.permissions.isHost && waiting && (bot || !seat.ownerAccountId) && (
                      <BotSeatSettings
                        key={`${seat.botPolicyId}:${seat.botModelProfileId}`}
                        editing={bot}
                        policyId={seat.botPolicyId}
                        profileId={seat.botModelProfileId ?? null}
                        profiles={modelProfiles}
                        loading={modelsLoading}
                        error={modelsError}
                        refresh={() => setModelsRefresh((value) => value + 1)}
                        save={(settings) =>
                          void run({
                            type: bot ? 'configure-bot' : 'add-bot',
                            seatId: seat.seatId,
                            settings,
                          })
                        }
                        {...(bot
                          ? { remove: () => void run({ type: 'remove-bot', seatId: seat.seatId }) }
                          : {})}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {waiting &&
            room.members.some(
              (member) => !room.seats.some((seat) => seat.ownerAccountId === member.accountId),
            ) && (
              <div className="waiting-members">
                <h3>候场成员</h3>
                {room.members
                  .filter(
                    (member) =>
                      !room.seats.some((seat) => seat.ownerAccountId === member.accountId),
                  )
                  .map((member) => (
                    <p key={member.accountId}>{member.displayName} · 请先选择空座位</p>
                  ))}
              </div>
            )}
        </section>
      </fieldset>
      <div className="room-support">
        {waiting && (
          <details
            className="room-disclosure"
            open={inviteOpen}
            onToggle={(event) => setInviteOpen(event.currentTarget.open)}
          >
            <summary>邀请朋友</summary>
            <div className="room-support-body">
              {invite ? (
                <div className="invite-box">
                  <span>点击邀请码即可复制</span>
                  <button
                    type="button"
                    className="secondary"
                    aria-label="复制邀请码"
                    onClick={() => void copyInvite()}
                  >
                    <strong>{invite.match(/.{1,4}/g)?.join('-') ?? invite}</strong>
                  </button>
                </div>
              ) : (
                <p className="muted">邀请码仅在创建或刷新时显示；也可直接邀请好友。</p>
              )}
              {copyNotice && <p role="status">{copyNotice}</p>}
              {copyNotice.startsWith('复制失败') && (
                <label className="form-stack invite-manual">
                  手动复制邀请码
                  <input
                    readOnly
                    value={invite}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              )}
              {room.permissions.isHost && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => void run({ type: 'invite' })}
                >
                  刷新邀请码
                </button>
              )}
              {inviteOpen && (
                <InviteFriends
                  roomId={id}
                  revision={room.roomRevision}
                  memberIds={room.members.map((member: { accountId: string }) => member.accountId)}
                />
              )}
            </div>
          </details>
        )}
        <details className="room-disclosure">
          <summary>{room.permissions.isHost ? '房间设置' : '房间信息'}</summary>
          <div className="room-support-body">
            <p className="muted">游戏版本：{room.gameVersion}</p>
            {assetVersions.length > 0 && (
              <section className="room-assets">
                <h3>图片与音效</h3>
                <p>
                  当前：
                  {assetVersions.find((version) => version.id === room.assetVersionId)?.name ??
                    (room.assetVersionId ? '已锁定版本（可能已归档）' : '历史 CSS 默认包')}
                </p>
                {waiting && room.permissions.isHost && (
                  <label className="form-stack">
                    资源包
                    <select
                      aria-label="资源包"
                      value={room.assetVersionId ?? ''}
                      disabled={disabled}
                      onChange={(event) =>
                        void run({ type: 'assets', versionId: event.target.value })
                      }
                    >
                      {!assetVersions.some((version) => version.id === room.assetVersionId) && (
                        <option value={room.assetVersionId ?? ''}>保持当前绑定</option>
                      )}
                      {assetVersions.map((version) => (
                        <option value={version.id} key={version.id}>
                          {version.name} · {version.version}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="muted">更换会取消真人准备；开局后锁定本版本。</p>
              </section>
            )}
            {room.permissions.isHost && waiting && (
              <form className="form-stack" onSubmit={configure}>
                <fieldset className="room-fieldset form-stack" disabled={disabled}>
                  <label>
                    房间名
                    <input name="name" defaultValue={room.name} maxLength={40} required />
                  </label>
                  <label>
                    座位数
                    <input
                      name="seatCount"
                      type="number"
                      min={players.min}
                      max={players.max}
                      defaultValue={room.seatCount}
                      required
                    />
                  </label>
                  <button className="secondary">保存配置（规则变更会清除准备）</button>
                </fieldset>
              </form>
            )}
          </div>
        </details>
        <GameRules gameId={room.gameId} version={room.gameVersion} />
        <details className="room-disclosure">
          <summary>更多操作</summary>
          <fieldset className="room-fieldset room-support-body form-stack" disabled={disabled}>
            {waiting && mine && (
              <button className="secondary" onClick={() => void run({ type: 'unseat' })}>
                离座
              </button>
            )}
            {room.permissions.isHost && waiting && room.members.length > 1 && (
              <details className="room-disclosure">
                <summary>转让房主</summary>
                <p className="muted">将房间管理交给另一位成员。</p>
                {room.members
                  .filter((member) => member.accountId !== me.account.id)
                  .map((member) => (
                    <button
                      className="secondary"
                      key={member.accountId}
                      onClick={() => {
                        if (confirm(`确定将房主转让给 ${member.displayName} 吗？`))
                          void run({ type: 'host', targetAccountId: member.accountId });
                      }}
                    >
                      转让给 {member.displayName}
                    </button>
                  ))}
              </details>
            )}
            {room.permissions.isHost && (
              <div className="room-danger-zone">
                <p className="muted">
                  {playing
                    ? '关闭将终止当前对局，让所有玩家返回大厅。'
                    : '关闭将让所有成员返回大厅，并释放建房名额。'}
                </p>
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      confirm(
                        playing
                          ? '强制关闭将终止当前对局，并让所有玩家返回首页。确定关闭吗？'
                          : '确定关闭房间并返回首页吗？',
                      )
                    )
                      void run({ type: 'close' });
                  }}
                >
                  {playing ? '强制关闭房间' : '关闭房间'}
                </button>
              </div>
            )}
          </fieldset>
        </details>
      </div>
    </div>
  );
}
