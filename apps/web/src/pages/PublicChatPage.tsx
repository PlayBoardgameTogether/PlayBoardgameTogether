import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { formatFriendId, type SocialPerson } from '@boardgame/protocol';
import { api } from '../platform.js';
import { DirectChat } from '../social/DirectChat.js';
import { PersonAvatar } from '../social/PersonAvatar.js';
import { BadgeShelf } from '../badges/BadgeShelf.js';
import { useSocialContext } from '../social/SocialProvider.js';

export function PublicChatPage({ compact = false, visible = true }: { compact?: boolean; visible?: boolean }) {
  const social = useSocialContext();
  const [selected, setSelected] = useState<SocialPerson>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const sending = useRef(false);
  const selectionVersion = useRef(0);
  const pending = useRef<{ requestId: string; friendId: string; expectedAccountId: string } | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  useEffect(() => {
    if (social.guest) { setSelected(undefined); pending.current = undefined; setNotice(''); setError(''); }
  }, [social.guest]);
  async function add() {
    if (!selected || sending.current) return;
    const version = selectionVersion.current;
    sending.current = true; setBusy(true); setError('');
    pending.current ??= { requestId: crypto.randomUUID(), friendId: selected.friendId, expectedAccountId: selected.id };
    try {
      await api.requestFriend(pending.current);
      if (active.current && selectionVersion.current === version) {
        pending.current = undefined;
        setNotice('好友申请已发送');
      }
      if (active.current) await social.refresh();
    } catch (cause) {
      if (active.current && selectionVersion.current === version) {
        if (cause instanceof ApiError && !cause.retryable) pending.current = undefined;
        setError(cause instanceof ApiError ? cause.message : '申请结果未知，请重试原申请。');
      }
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (social.guest) return <section className="panel"><h1>公共聊天</h1><p>登录后即可参与公共聊天，结识更多桌友。</p><a className="button-link" href="/login">前往登录</a></section>;
  if (!social.data) return <section className="panel"><h1>公共聊天</h1><p role={social.error ? 'alert' : 'status'}>{social.error || '正在加载…'}</p>
    {social.error && <button onClick={() => void social.refresh()}>重试加载</button>}</section>;
  const own = selected?.friendId === social.data.identity.friendId;
  const friend = social.data.friends.find(item => item.person.id === selected?.id);
  const request = social.data.requests.find(item => item.person.id === selected?.id);
  return <div className="social-page public-chat-page">
    <DirectChat publicChat compact={compact} visible={visible} refresh={social.refresh} onPerson={person => {
      selectionVersion.current++;
      setSelected(person); setError(''); setNotice(''); pending.current = undefined;
    }} />
    <dialog className="public-person-dialog" ref={dialog} onCancel={() => setSelected(undefined)} onClose={() => setSelected(undefined)}>
      {selected && <>
        <div className="public-person-heading"><PersonAvatar person={selected} /><div><h2>{selected.displayName}</h2><p className="muted">{formatFriendId(selected.friendId)}</p></div>
          <button type="button" className="secondary" aria-label="关闭名片" onClick={() => setSelected(undefined)}>×</button></div>
        <BadgeShelf key={selected.id} accountId={selected.id} />
        {notice && <p role="status">{notice}</p>}{error && <p className="error-notice" role="alert">{error}</p>}
        {own ? <a href="/profile">查看我的资料</a> : friend ? <a className="button-link" href={`/friends/chat/${selected.id}`} onClick={() => setSelected(undefined)}>私聊</a> :
          request ? <><p>{request.direction === 'incoming' ? '对方已向你发送好友申请' : '等待对方确认申请'}</p><a href="/friends/requests">查看好友申请</a></> :
          !notice && <button disabled={busy} onClick={() => void add()}>{busy ? '发送中…' : pending.current ? '重试好友申请' : '发送好友申请'}</button>}
      </>}
    </dialog>
  </div>;
}
