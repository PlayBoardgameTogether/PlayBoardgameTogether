import { loadGames, type AvailableGame } from './game-catalog.js';
import '../styles/match-results.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { formatFriendId, type Profile, type MatchHistory } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api, navigate } from '../platform.js';
import { FriendIdCard } from '../social/FriendIdCard.js';
import { useSocialContext } from '../social/SocialProvider.js';
import { avatars } from '../social/PersonAvatar.js';
import { BadgeShelf } from '../badges/BadgeShelf.js';
import '../styles/social.css';
import '../styles/profile.css';

const statuses = { active: '进行中', finished: '已结束', aborted: '已中止' };
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export function ProfilePage({
  section = 'summary',
}: {
  section?: 'summary' | 'edit' | 'history' | 'identity';
}) {
  const social = useSocialContext();
  const [profile, setProfile] = useState<Profile>();
  const [history, setHistory] = useState<MatchHistory>();
  const [historyGames, setHistoryGames] = useState<AvailableGame[]>([]);
  const [gameFilter, setGameFilter] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyEpoch = useRef(0);
  const [draft, setDraft] = useState<Profile>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const active = useRef(false);
  const saveLock = useRef(false);
  const moreLock = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    active.current = true;
    setError('');
    void api
      .me()
      .then(() => api.profile())
      .then((account) => {
        if (!disposed) {
          setProfile(account);
          setDraft(account);
        }
      })
      .catch((cause) => {
        if (disposed) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
        else setError('资料加载失败，请重试。');
      });
    return () => {
      disposed = true;
      active.current = false;
      clearTimeout(copyTimer.current);
    };
  }, [attempt, section]);

  useEffect(() => {
    if (section !== 'history') return;
    let disposed = false;
    void loadGames()
      .then((items) => {
        if (!disposed) setHistoryGames(items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== 'history') return;
    const epoch = ++historyEpoch.current;
    setHistoryLoading(true);
    setError('');
    void api
      .matchHistory(undefined, gameFilter || undefined)
      .then((records) => {
        if (epoch === historyEpoch.current) setHistory(records);
      })
      .catch((cause) => {
        if (epoch === historyEpoch.current) {
          setHistory(undefined);
          setError(cause instanceof Error ? cause.message : '记录加载失败');
        }
      })
      .finally(() => {
        if (epoch === historyEpoch.current) setHistoryLoading(false);
      });
    return () => {
      historyEpoch.current++;
    };
  }, [section, gameFilter, attempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.saveProfile({
        displayName: draft.displayName,
        avatar: draft.avatar,
        bio: draft.bio,
      });
      if (active.current) {
        setProfile(saved);
        setDraft(saved);
        void social.refresh();
        navigate('/profile', { profileSaved: true });
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      saveLock.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function more() {
    if (!history?.nextCursor || moreLock.current || historyLoading) return;
    const epoch = historyEpoch.current;
    moreLock.current = true;
    setLoadingMore(true);
    try {
      const page = await api.matchHistory(history.nextCursor, gameFilter || undefined);
      if (active.current && epoch === historyEpoch.current)
        setHistory((current) => ({
          items: [
            ...(current?.items ?? []),
            ...page.items.filter((item) => !current?.items.some((old) => old.id === item.id)),
          ],
          nextCursor: page.nextCursor,
        }));
    } catch (cause) {
      if (active.current && epoch === historyEpoch.current)
        setError(cause instanceof Error ? cause.message : '记录加载失败');
    } finally {
      moreLock.current = false;
      if (active.current) setLoadingMore(false);
    }
  }

  async function logout() {
    if (saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    try {
      await api.logout();
      social.clearSession();
      if (active.current) navigate('/login');
    } catch {
      if (active.current) setError('退出失败，请重试。');
    } finally {
      saveLock.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function handleCopyFriendId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      if (!active.current) return;
      clearTimeout(copyTimer.current);
      setCopiedId(true);
      copyTimer.current = setTimeout(() => {
        if (active.current) setCopiedId(false);
      }, 2200);
    } catch {
      if (active.current) setError('复制失败，请选中好友 ID 手动复制。');
    }
  }

  if (!profile || !draft || (section === 'history' && !history))
    return error ? (
      <PageFeedback
        title={section === 'history' ? '对局记录加载失败' : '资料加载失败'}
        retry={() => setAttempt((value) => value + 1)}
      >
        {error}
      </PageFeedback>
    ) : (
      <PageFeedback
        title={section === 'history' ? '正在加载对局记录…' : '正在加载我的资料…'}
        loading
      />
    );
  const navigationState: unknown = window.history.state;
  const saved =
    !dismissedNotice &&
    !!navigationState &&
    typeof navigationState === 'object' &&
    'profileSaved' in navigationState &&
    navigationState.profileSaved === true;
  const title = {
    summary: '我的资料',
    edit: '编辑资料',
    history: '对局记录',
    identity: '管理好友 ID',
  }[section];
  const activeAvatar = avatars.find((avatar) => avatar.id === profile.avatar);
  const statusMessage = notice || (saved && section === 'summary' ? '资料已保存' : '');
  const friendId = social.data ? formatFriendId(social.data.identity.friendId) : undefined;

  return (
    <div className="profile-page">
      {section !== 'summary' && (
        <a className="social-back" href="/profile">
          ← 返回我的资料
        </a>
      )}
      <header className="page-heading profile-heading">
        <div>
          <h1>{title}</h1>
        </div>
        {section === 'summary' && (
          <details className="profile-options">
            <summary>账户操作</summary>
            <div className="profile-options-popover">
              <dl>
                <div className="profile-options-item">
                  <dt>登录用户名</dt>
                  <dd>{profile.username}</dd>
                </div>
                <div className="profile-options-item">
                  <dt>账户 ID</dt>
                  <dd className="account-id">{profile.id}</dd>
                </div>
                <div className="profile-options-item">
                  <dt>加入时间</dt>
                  <dd>{date(profile.createdAt)}</dd>
                </div>
              </dl>
              <div className="profile-options-actions">
                <button
                  type="button"
                  className="secondary danger-action"
                  disabled={busy}
                  onClick={() => void logout()}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  退出登录
                </button>
              </div>
            </div>
          </details>
        )}
      </header>

      {error && (
        <div className="profile-feedback-toast profile-feedback-toast--error" role="alert">
          <span className="toast-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div className="toast-body">
            <strong className="toast-title">提示</strong>
            <span className="error-notice">{error}</span>
          </div>
          <button
            type="button"
            className="secondary toast-close"
            onClick={() => setError('')}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="profile-feedback-toast profile-feedback-toast--success">
          <span className="toast-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="toast-body">
            <strong className="toast-title">操作成功</strong>
            <span role="status" className="toast-msg">
              {statusMessage}
            </span>
          </div>
          <button
            type="button"
            className="secondary toast-close"
            onClick={() => {
              setNotice('');
              setDismissedNotice(true);
            }}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      {section === 'summary' && (
        <>
          <section className="profile-card panel" aria-label="我的桌游名片">
            <div className="profile-card-header">
              <span className="profile-badge">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                PlayBoard 桌游名片
              </span>
              <span className="profile-player-role">正式桌友</span>
            </div>
            <div className="profile-card-content">
              <div className="profile-avatar-container">
                <span className="profile-avatar" role="img" aria-label={activeAvatar?.label}>
                  {activeAvatar?.symbol}
                </span>
              </div>
              <div className="profile-info">
                <div className="profile-identity">
                  <h2>{profile.displayName}</h2>
                  {friendId ? (
                    <div className="friend-id-pill">
                      <p className="muted friend-id">{friendId}</p>
                      <button
                        type="button"
                        className="secondary copy-id-chip-btn"
                        onClick={() => void handleCopyFriendId(friendId)}
                        aria-label="复制好友 ID"
                        title="复制好友 ID"
                      >
                        {copiedId ? (
                          <span className="copied-tag">✓ 已复制</span>
                        ) : (
                          <span className="copy-tag">
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                            复制
                          </span>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="muted friend-id">正在读取好友 ID…</p>
                  )}
                </div>

                <BadgeShelf accountId={profile.id} own />
                {profile.bio ? (
                  <div className="profile-bio-box">
                    <span className="bio-quote-mark" aria-hidden="true">
                      “
                    </span>
                    <p className="profile-bio">{profile.bio}</p>
                  </div>
                ) : (
                  <div className="profile-bio-empty">
                    <span className="bio-empty-icon" aria-hidden="true">
                      ✍️
                    </span>
                    <div className="bio-empty-details">
                      <p className="profile-bio">还没有个人简介。</p>
                      <span className="bio-empty-prompt" aria-hidden="true">
                        写写常玩的桌游和对局宣言，让桌友认识你～
                      </span>
                    </div>
                    <a href="/profile/edit" className="bio-empty-cta">
                      去添加
                    </a>
                  </div>
                )}
              </div>
              <div className="profile-actions">
                <a className="button-link" href="/profile/edit">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                  编辑资料
                </a>
              </div>
            </div>
          </section>

          <nav className="profile-links" aria-label="资料功能">
            <a href="/profile/coins" className="profile-feature-card">
              <div className="profile-feature-text">
                <span className="profile-feature-title">我的桌游币</span>
                <span className="profile-feature-desc">查看余额与明细</span>
              </div>
              <span aria-hidden="true">→</span>
            </a>
            <a href="/profile/history" className="profile-feature-card">
              <div className="profile-feature-lead">
                <span
                  className="profile-feature-icon profile-feature-icon--history"
                  aria-hidden="true"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </span>
                <div className="profile-feature-text">
                  <span className="profile-feature-title">对局记录</span>
                  <span className="profile-feature-desc" aria-hidden="true">
                    查看往期战绩与精彩回放
                  </span>
                </div>
              </div>
              <span className="profile-feature-arrow" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </a>

            <a href="/profile/identity" className="profile-feature-card">
              <div className="profile-feature-lead">
                <span
                  className="profile-feature-icon profile-feature-icon--identity"
                  aria-hidden="true"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="20" height="14" x="2" y="5" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                </span>
                <div className="profile-feature-text">
                  <span className="profile-feature-title">管理好友 ID</span>
                  <span className="profile-feature-desc" aria-hidden="true">
                    专属 @ID，方便朋友精准找到你
                  </span>
                </div>
              </div>
              <span className="profile-feature-arrow" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </a>
          </nav>
        </>
      )}

      {section === 'edit' && (
        <section className="panel profile-editor-card">
          <header className="profile-editor-header">
            <h2>修改个人名片</h2>
            <p className="muted">定制你的昵称、头像与个性宣言。</p>
          </header>
          <form className="form-stack profile-editor" onSubmit={save}>
            <fieldset className="room-fieldset form-stack" disabled={busy}>
              <div className="profile-form-row">
                <div className="profile-form-label-row">
                  <label htmlFor="profile-displayName">昵称</label>
                  <small className="muted">{draft.displayName.length}/32</small>
                </div>
                <input
                  id="profile-displayName"
                  required
                  maxLength={32}
                  value={draft.displayName}
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                  placeholder="填写你的桌游昵称"
                />
              </div>
              <fieldset className="avatar-options">
                <legend>头像选择</legend>
                <div className="avatar-grid">
                  {avatars.map((avatar) => (
                    <label
                      key={avatar.id}
                      className={`avatar-item ${draft.avatar === avatar.id ? 'avatar-item--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="avatar"
                        value={avatar.id}
                        checked={draft.avatar === avatar.id}
                        onChange={() => setDraft({ ...draft, avatar: avatar.id })}
                      />
                      <span className="avatar-symbol" aria-hidden="true">
                        {avatar.symbol}
                      </span>
                      <span className="avatar-label">{avatar.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="profile-form-row">
                <div className="profile-form-label-row">
                  <label htmlFor="profile-bio">个人简介</label>
                  <small className="muted">{draft.bio.length}/300</small>
                </div>
                <textarea
                  id="profile-bio"
                  rows={4}
                  maxLength={300}
                  placeholder="喜欢的桌游、常玩的时间，或想对桌友说的话。"
                  value={draft.bio}
                  onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
                />
              </div>
              <div className="profile-save">
                <button disabled={!draft.displayName.trim()}>
                  {busy ? '保存中…' : '保存资料'}
                </button>
                <a className="button-link secondary" href="/profile">
                  取消
                </a>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      {section === 'identity' && <FriendIdCard />}

      {section === 'history' && history && (
        <section className="room-list" aria-busy={historyLoading}>
          <div className="history-filters">
            <label>
              按游戏筛选
              <select
                value={gameFilter}
                onChange={(event) => {
                  historyEpoch.current++;
                  setHistoryLoading(true);
                  setGameFilter(event.target.value);
                }}
              >
                <option value="">全部游戏</option>
                {[
                  ...new Map([
                    ...historyGames.map((game) => [game.id, game.name] as const),
                    ...history.items
                      .filter((match) => !historyGames.some((game) => game.id === match.gameId))
                      .map((match) => [match.gameId, match.gameId] as const),
                    ...(gameFilter && !historyGames.some((game) => game.id === gameFilter)
                      ? [[gameFilter, gameFilter] as const]
                      : []),
                  ]).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {gameFilter && (
              <button
                className="secondary"
                onClick={() => {
                  historyEpoch.current++;
                  setHistoryLoading(true);
                  setGameFilter('');
                }}
              >
                查看全部游戏
              </button>
            )}
          </div>
          {historyLoading ? (
            <p role="status">正在读取对局记录…</p>
          ) : history.items.length === 0 ? (
            <div className="profile-empty-history panel">
              <div className="empty-history-icon" aria-hidden="true">
                🎲
              </div>
              <p className="muted">
                {gameFilter ? '这款游戏还没有对局记录。' : '暂无对局记录。'}
                <a href="/">去大厅开始第一局</a>
              </p>
            </div>
          ) : (
            history.items.map((match) => (
              <article className="room-row match-history-row" key={match.id}>
                <span>
                  <strong>{match.roomName}</strong>
                  <small>
                    {historyGames.find((game) => game.id === match.gameId)?.name ?? match.gameId} ·{' '}
                    {match.gameVersion} · {date(match.createdAt)}
                  </small>
                </span>
                <span className="match-history-result">
                  {match.status === 'finished' && (
                    <strong>
                      {match.result
                        ? match.result.winner
                          ? match.result.sharedWin
                            ? '共同胜出'
                            : '胜出'
                          : '未胜出'
                        : '未记录结果'}
                    </strong>
                  )}
                  {match.result?.score !== undefined && <span>{match.result.score} 分</span>}
                </span>
                <span className={`match-status-tag match-status-tag--${match.status}`}>
                  {statuses[match.status]}
                </span>
                <div className="match-history-links">
                  {match.status === 'finished' && <a href={`/matches/${match.id}`}>查看结果</a>}
                  <a
                    className="button-link secondary"
                    href={`/matches/${match.id}${match.status === 'active' ? '' : '/replay'}`}
                  >
                    {match.status === 'active' ? '继续对局' : '查看回放'}
                  </a>
                </div>
              </article>
            ))
          )}
          {!historyLoading && history.nextCursor && (
            <button
              className="secondary history-more-btn"
              disabled={loadingMore}
              onClick={() => void more()}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
