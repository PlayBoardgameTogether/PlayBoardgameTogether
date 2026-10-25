import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SocialOverview } from '@boardgame/protocol';
import { useSocialContext } from './SocialProvider.js';
import { PixelBellIcon } from '../ui/PixelIcons.js';
import '../styles/social.css';

const receivedInvites = (data: SocialOverview) => data.invitations.filter(item =>
  item.recipient.friendId === data.identity.friendId && item.status === 'pending' && item.available);

export function SocialNotifications() {
  const { data, error, refresh, openChat } = useSocialContext();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const previous = useRef<SocialOverview | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = previous.current;
    previous.current = data;
    if (!data) { setOpen(false); setToast(false); return; }
    if (old && (data.friends.some(item => item.unread > (old.friends.find(friend => friend.person.id === item.person.id)?.unread ?? 0)) ||
      receivedInvites(data).some(item => !receivedInvites(old).some(before => before.id === item.id)) ||
      data.requests.some(item => item.direction === 'incoming' && !old.requests.some(before => before.person.id === item.person.id)))) setToast(true);
  }, [data]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!data) return null;
  const messages = data.friends.filter(item => item.unread > 0);
  const invitations = receivedInvites(data);
  const requests = data.requests.filter(item => item.direction === 'incoming');
  const count = messages.reduce((sum, item) => sum + item.unread, 0) + invitations.length + requests.length;
  return <div className="social-notifications" ref={container}>
    <button ref={trigger} className="secondary notification-trigger" aria-label={count ? `通知，${count} 条未处理` : '通知'} aria-expanded={open} aria-controls="notification-list" onClick={() => { setOpen(value => !value); setToast(false); }}>
      <PixelBellIcon />
      <span>通知</span>{count > 0 && <span className="unread-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      {error && <span aria-label="同步失败">!</span>}
    </button>
    {open && <section id="notification-list" className="notification-list" aria-label="消息与邀请通知">
      <h2>通知</h2>
      {error && <p role="alert">{error}<button className="secondary" onClick={() => void refresh()}>重试同步</button></p>}
      {count === 0 && <p className="muted">暂无新通知</p>}
      {messages.map(item => <a className="notification-row" key={item.person.id} href={`/friends/chat/${item.person.id}`} onClick={event => {
        setOpen(false);
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && matchMedia('(min-width: 761px)').matches) {
          event.preventDefault(); openChat(item.person.id);
        }
      }}><strong>{item.person.displayName}</strong><small>{item.unread} 条未读消息</small></a>)}
      {invitations.map(item => <a className="notification-row" key={item.id} href="/friends/invitations" onClick={() => setOpen(false)}><strong>{item.sender.displayName} 邀请你加入 {item.roomName}</strong><small>房间邀请 · {item.hasPassword ? '需要房间密码' : '点击查看邀请'}</small></a>)}
      {requests.length > 0 && <a className="notification-row" href="/friends/requests" onClick={() => setOpen(false)}><strong>{requests.length} 条好友申请</strong><small>查看并处理</small></a>}
      <a className="notification-all" href="/friends" onClick={() => setOpen(false)}>查看好友</a>
    </section>}
    {toast && createPortal(<div className="notification-toast" role="status"><span>收到新消息或房间邀请</span><button className="secondary" onClick={() => { setOpen(true); setToast(false); trigger.current?.focus(); }}>查看通知</button><button className="secondary" aria-label="关闭通知提示" onClick={() => setToast(false)}>×</button></div>, document.body)}
  </div>;
}
