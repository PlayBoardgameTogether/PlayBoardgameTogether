import { useState, type FormEvent } from 'react';
import type { SocialPerson, SocialOverview } from '@boardgame/protocol';
import { formatFriendId } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api, navigate } from '../platform.js';
import { useSocial, useSocialCommand } from '../social/useSocial.js';
import { DirectChat } from '../social/DirectChat.js';
import { FriendIdCard } from '../social/FriendIdCard.js';
import { PersonAvatar } from '../social/PersonAvatar.js';
import { FriendOptions } from '../social/FriendOptions.js';
import '../styles/social.css';

function Invitation({
  invite,
  me,
  run,
  busy,
  refresh,
}: {
  invite: SocialOverview['invitations'][number];
  me: string;
  run: ReturnType<typeof useSocialCommand>['run'];
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const incoming = invite.recipient.id === me;
  const respond = (action: 'accept' | 'reject') => {
    const input = { action, ...(action === 'accept' && invite.hasPassword ? { password } : {}) };
    void run(
      JSON.stringify({ id: invite.id, ...input }),
      async (requestId) => {
        const result = await api.respondFriendInvitation(invite.id, { requestId, ...input });
        if (action === 'accept') return result.roomId;
      },
      action === 'accept' ? '已加入房间' : '已拒绝邀请',
      () => {
        if (action === 'accept') navigate(`/rooms/${invite.roomId}`);
        else void refresh();
      },
    );
  };
  const state =
    invite.status === 'accepted'
      ? 'accepted'
      : invite.status === 'rejected'
        ? 'rejected'
        : invite.available
          ? 'pending'
          : 'expired';
  const labels = { accepted: '已接受', rejected: '已拒绝', pending: '等待回应', expired: '已失效' };
  const person = incoming ? invite.sender : invite.recipient;
  return (
    <article className={'social-row invitation-row invitation-row--' + state}>
      <div className="social-person invitation-person">
        <PersonAvatar person={person} />
        <div className="invitation-content">
          <div className="invitation-title">
            <strong>{invite.roomName}</strong>
            <span className={'invitation-status invitation-status--' + state}>{labels[state]}</span>
          </div>
          <p className="invitation-direction">
            {incoming ? person.displayName + ' 邀请你' : '已邀请 ' + person.displayName}
          </p>
          <small className="muted invitation-meta">
            有效至{' '}
            <time dateTime={invite.expiresAt}>
              {new Date(invite.expiresAt).toLocaleString('zh-CN')}
            </time>
            {invite.hasPassword ? ' · 需要房间密码' : ''}
          </small>
        </div>
      </div>
      {incoming && invite.status === 'accepted' && (
        <a className="button-link secondary" href={'/rooms/' + invite.roomId}>
          进入已接受的房间
        </a>
      )}
      {incoming && invite.status === 'pending' && invite.available && (
        <div className="form-stack invitation-response">
          {invite.hasPassword && (
            <label>
              邀请房间密码
              <input
                type="password"
                autoComplete="off"
                maxLength={128}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <div className="social-actions">
            <button
              disabled={busy || (invite.hasPassword && !password)}
              onClick={() => respond('accept')}
            >
              接受并加入
            </button>
            <button className="secondary" disabled={busy} onClick={() => respond('reject')}>
              拒绝邀请
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export type FriendsSection = 'list' | 'add' | 'requests' | 'invitations' | 'chat';

const headings: Record<FriendsSection, [string, string]> = {
  list: ['好友', '找一位朋友，聊聊下一局。'],
  add: ['添加好友', '通过对方的好友 ID 找到朋友。'],
  requests: ['好友申请', '处理收到的申请，或查看已发送的申请。'],
  invitations: ['房间邀请', '查看朋友的开桌邀请和你发出的邀请。'],
  chat: ['好友私聊', '约个时间，一起开桌。'],
};

export function FriendsPage({
  section = 'list',
  friendId,
}: {
  section?: FriendsSection;
  friendId?: string;
}) {
  const { data, error, refresh } = useSocial();
  const action = useSocialCommand();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<SocialPerson | null>();
  const selected = data?.friends.find((item) => item.person.id === friendId)?.person;
  function find(event: FormEvent) {
    event.preventDefault();
    const handle = search.trim().toLowerCase();
    setResult(undefined);
    void action.run(`search:${handle}`, async () => {
      setResult(await api.searchFriend(handle));
    });
  }
  if (!data)
    return (
      <PageFeedback title="正在读取好友…" loading={!error} retry={() => void refresh()}>
        {error}
      </PageFeedback>
    );
  const incoming = data.requests.filter((item) => item.direction === 'incoming');
  const outgoing = data.requests.filter((item) => item.direction === 'outgoing');
  const invitationCount = data.invitations.filter(
    (item) =>
      item.recipient.friendId === data.identity.friendId &&
      item.status === 'pending' &&
      item.available,
  ).length;
  const unread = data.friends.reduce((sum, item) => sum + item.unread, 0);
  const query = filter.trim().toLowerCase();
  const friends = data.friends.filter((item) =>
    `${item.person.displayName} ${formatFriendId(item.person.friendId)}`
      .toLowerCase()
      .includes(query),
  );
  const [title, description] = headings[section];
  return (
    <div className={`social-page social-page--${section}`}>
      {section !== 'chat' && (
        <section className="page-heading">
          <div>
            <p className="eyebrow">一起玩，也一起聊</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {section !== 'add' && (
            <a className="button-link" href="/friends/add">
              添加好友
            </a>
          )}
        </section>
      )}
      <nav className="social-navigation" aria-label="好友功能">
        {(
          [
            ['/friends', '我的好友', section === 'list' || section === 'chat', unread],
            ['/friends/requests', '好友申请', section === 'requests', incoming.length],
            ['/friends/invitations', '房间邀请', section === 'invitations', invitationCount],
          ] as const
        ).map(([href, label, current, count]) => (
          <a key={href} href={href} aria-current={current ? 'page' : undefined}>
            {label}
            {count > 0 && (
              <span
                className="unread-count"
                aria-label={`${count}${label === '我的好友' ? ' 条未读' : ' 条待处理'}`}
              >
                {count}
              </span>
            )}
          </a>
        ))}
      </nav>
      {(error || action.error) && (
        <p className="error-notice" role="alert">
          {error || action.error}
          <button className="secondary" onClick={() => void refresh()}>
            刷新好友信息
          </button>
        </p>
      )}
      {action.notice && <p role="status">{action.notice}</p>}

      {section === 'list' && (
        <section className="panel social-directory" aria-label="好友列表">
          <header className="social-section-heading">
            <h2>
              我的好友 <small>({data.friends.length})</small>
            </h2>
            <a href="/profile">我的资料与好友 ID</a>
          </header>
          {data.friends.length > 0 && (
            <label className="social-filter">
              查找我的好友
              <input
                type="search"
                placeholder="昵称或好友 ID"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          )}
          {data.friends.length === 0 && (
            <div className="social-empty">
              <h3>还没有好友</h3>
              <p className="muted">添加一位朋友，私聊约时间，也能在房间里邀请对方。</p>
              <a className="button-link" href="/friends/add">
                去添加好友
              </a>
            </div>
          )}
          {data.friends.length > 0 && friends.length === 0 && (
            <p className="social-empty muted">
              没有匹配的好友。
              <button type="button" className="secondary" onClick={() => setFilter('')}>
                清除筛选
              </button>
            </p>
          )}
          {friends.map((item) => (
            <article className="social-row" key={item.person.id}>
              <div className="social-person">
                <PersonAvatar person={item.person} />
                <div>
                  <strong>{item.person.displayName}</strong>
                  <p className="muted friend-id">{formatFriendId(item.person.friendId)}</p>
                  {item.unread > 0 && <span className="unread-count">{item.unread} 条未读</span>}
                </div>
              </div>
              <div className="social-actions">
                <a className="button-link secondary" href={`/friends/chat/${item.person.id}`}>
                  私聊 {item.person.displayName}
                </a>
                <FriendOptions
                  name={item.person.displayName}
                  busy={action.busy}
                  onRemove={() => {
                    if (
                      confirm(`删除好友 ${item.person.displayName}？删除后将不能继续私聊或邀请。`)
                    )
                      void action.run(
                        `remove:${item.person.id}:${item.revision}`,
                        (id) =>
                          api.updateFriend(item.person.id, {
                            requestId: id,
                            expectedRevision: item.revision,
                            action: 'remove',
                          }),
                        '好友已删除',
                        () => void refresh(),
                      );
                  }}
                />
              </div>
            </article>
          ))}
        </section>
      )}

      {section === 'add' && (
        <>
          <a className="social-back" href="/friends">
            ← 返回好友列表
          </a>
          <div className="social-add-layout">
            <section className="panel">
              <h2>搜索朋友</h2>
              <p className="muted">输入完整的好友 ID，搜索后确认昵称再发送申请。</p>
              <form className="form-stack" onSubmit={find}>
                <label>
                  搜索好友 ID
                  <input
                    required
                    minLength={3}
                    maxLength={37}
                    pattern="@?[A-Za-z0-9_]{3,36}"
                    placeholder="@rst307"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={search}
                    disabled={action.busy}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setResult(undefined);
                    }}
                  />
                </label>
                <button disabled={action.busy}>{action.busy ? '处理中…' : '搜索用户'}</button>
              </form>
              {result === null && <p role="status">没有找到这个好友 ID。</p>}
              {result && (
                <article className="social-row">
                  <div className="social-person">
                    <PersonAvatar person={result} />
                    <div>
                      <strong>{result.displayName}</strong>
                      <p className="friend-id">{formatFriendId(result.friendId)}</p>
                    </div>
                  </div>
                  {result.friendId === data.identity.friendId ? (
                    <span>这是你自己</span>
                  ) : data.friends.some((item) => item.person.id === result.id) ? (
                    <span>已是好友</span>
                  ) : data.requests.some((item) => item.person.id === result.id) ? (
                    <a href="/friends/requests">查看待处理申请</a>
                  ) : (
                    <button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          `request:${result.friendId}`,
                          (id) =>
                            api.requestFriend({
                              requestId: id,
                              friendId: result.friendId,
                              expectedAccountId: result.id,
                            }),
                          '好友申请已提交，请等待对方确认',
                          () => void refresh(),
                        )
                      }
                    >
                      发送好友申请
                    </button>
                  )}
                </article>
              )}
              <p className="muted">
                申请进度可在 <a href="/friends/requests">好友申请</a> 中查看。
              </p>
            </section>
            <FriendIdCard />
          </div>
        </>
      )}

      {section === 'requests' && (
        <div className="social-request-layout">
          {(
            [
              ['收到的申请', incoming],
              ['发出的申请', outgoing],
            ] as const
          ).map(([heading, items]) => (
            <section className="panel" key={heading}>
              <h2>
                {heading} <small>({items.length})</small>
              </h2>
              {items.length === 0 && (
                <p className="social-empty muted">
                  {heading === '收到的申请'
                    ? '暂无待处理申请。朋友发来申请后会显示在这里。'
                    : '暂无发出的申请。'}{' '}
                </p>
              )}
              {items.map((item) => (
                <article className="social-row" key={item.person.id}>
                  <div className="social-person">
                    <PersonAvatar person={item.person} />
                    <div>
                      <strong>{item.person.displayName}</strong>
                      <p className="muted friend-id">
                        {formatFriendId(item.person.friendId)} ·{' '}
                        {item.direction === 'incoming' ? '请求添加你' : '等待对方确认'}
                      </p>
                    </div>
                  </div>
                  <div className="social-actions">
                    {(item.direction === 'incoming'
                      ? (['accept', 'reject'] as const)
                      : (['cancel'] as const)
                    ).map((operation) => (
                      <button
                        key={operation}
                        className={operation === 'accept' ? '' : 'secondary'}
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            `friend:${item.person.id}:${item.revision}:${operation}`,
                            (id) =>
                              api.updateFriend(item.person.id, {
                                requestId: id,
                                expectedRevision: item.revision,
                                action: operation,
                              }),
                            operation === 'accept'
                              ? '已成为好友，可返回好友列表开始私聊'
                              : '申请已处理',
                            () => void refresh(),
                          )
                        }
                      >
                        {operation === 'accept'
                          ? '接受申请'
                          : operation === 'reject'
                            ? '拒绝申请'
                            : '撤回申请'}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {section === 'invitations' && (
        <section className="panel social-invitations">
          <h2>开桌邀请</h2>
          <p className="muted invitation-help">
            在等待中的房间点击「邀请好友」。接受邀请后，选择座位即可准备。
          </p>
          {data.invitations.length === 0 && <p className="social-empty muted">暂无房间邀请。</p>}
          {data.invitations.map((invite) => (
            <Invitation
              key={invite.id}
              invite={invite}
              me={
                invite.sender.friendId === data.identity.friendId
                  ? invite.sender.id
                  : invite.recipient.id
              }
              run={action.run}
              busy={action.busy}
              refresh={refresh}
            />
          ))}
        </section>
      )}

      {section === 'chat' && (
        <div className="social-conversation">
          <a className="social-back" href="/friends">
            ← 返回好友列表
          </a>
          {selected ? (
            <DirectChat key={selected.id} person={selected} refresh={refresh} />
          ) : (
            <section className="panel">
              <h2>无法打开这段私聊</h2>
              <p className="muted">对方不在当前好友列表中。返回列表选择好友，或检查好友关系。</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
