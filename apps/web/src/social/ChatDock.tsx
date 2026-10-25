import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DirectChat } from './DirectChat.js';
import { PersonAvatar } from './PersonAvatar.js';
import { useSocialContext } from './SocialProvider.js';
import { PixelChatIcon } from '../ui/PixelIcons.js';

const PublicChatPage = lazy(() => import('../pages/PublicChatPage.js').then(module => ({ default: module.PublicChatPage })));

export function ChatDock() {
  const {
    data, guest, error, chatId, minimized, setMinimized,
    openChat, closeChat, refresh, chatTab: tab, setChatTab: setTab,
  } = useSocialContext();
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 761px)').matches);
  const [opened, setOpened] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia('(min-width: 761px)');
    const change = () => setDesktop(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!minimized) setOpened(true);
    if (!data) setOpened(false);
  }, [minimized, data]);
  const friend = data?.friends.find(item => item.person.id === chatId);
  const unread = data?.friends.reduce((sum, item) => sum + item.unread, 0) ?? 0;
  if (!desktop) return null;
  const label = friend ? `与 ${friend.person.displayName} 的聊天` : '聊天';
  return <section className={`chat-dock ${minimized ? 'chat-dock--minimized' : ''}`} aria-label="聊天浮窗">
    <div className="chat-dock-toolbar">
      <button className="secondary chat-dock-title" ref={toggle} aria-label={`${minimized ? '展开' : '最小化'}${label}`} aria-expanded={!minimized} aria-controls="desktop-chat-body" onClick={() => setMinimized(!minimized)}>
        <PixelChatIcon />
        <span>聊天</span>{unread > 0 && <span className="unread-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <button className="secondary chat-dock-collapse" aria-label={minimized ? '展开聊天' : '最小化聊天'} onClick={() => { setMinimized(!minimized); toggle.current?.focus(); }}>{minimized ? '⌃' : '−'}</button>
    </div>
    <div id="desktop-chat-body" className="chat-dock-body" hidden={minimized}>
      {(!minimized || opened) && <>
      <div className="chat-dock-tabs" aria-label="聊天频道">
        <button className="secondary" aria-pressed={tab === 'public'} onClick={() => setTab('public')}>公共聊天</button>
        <button className="secondary" aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>好友聊天{unread > 0 && <span className="unread-count">{unread}</span>}</button>
      </div>
      <div hidden={tab !== 'public'}>
        <Suspense fallback={<p role="status">正在加载聊天…</p>}>
          <PublicChatPage compact visible={!minimized && tab === 'public'} />
        </Suspense>
      </div>
      <div hidden={tab !== 'friends'}>
        {friend ? <>
          <div className="chat-dock-peer">
            <button className="secondary" onClick={closeChat}>‹ 好友列表</button>
            <strong>{friend.person.displayName}</strong>
            <button className="secondary" aria-label="关闭聊天" onClick={closeChat}>×</button>
          </div>
          <DirectChat key={friend.person.id} person={friend.person} refresh={refresh} visible={!minimized && tab === 'friends'} compact />
        </> : <div className="chat-dock-friends">
          {guest ? <p><a href="/login">登录后与好友聊天</a></p> : !data ? <p role={error ? 'alert' : 'status'}>
            {error || '正在加载好友…'}
            {error && <button className="secondary" onClick={() => void refresh()}>重试</button>}
          </p> : <>
            {data.friends.map(item => <button
              className="secondary chat-dock-friend"
              aria-label={`私聊 ${item.person.displayName}`}
              key={item.person.id}
              onClick={() => openChat(item.person.id)}
            >
              <PersonAvatar person={item.person} />
              <span>{item.person.displayName}</span>
              {item.unread > 0 && <span className="unread-count">{item.unread}</span>}
            </button>)}
            {data.friends.length === 0 && <p className="muted">暂无好友，去大厅认识新桌友吧。</p>}
            <a className="chat-dock-manage" href="/friends">管理好友</a>
          </>}
        </div>}
      </div>
      </>}
    </div>
  </section>;
}
