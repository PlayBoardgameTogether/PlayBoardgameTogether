import { api } from '../platform.js';
import { useSocial, useSocialCommand } from './useSocial.js';
import { PersonAvatar } from './PersonAvatar.js';
import '../styles/social.css';

export function InviteFriends({ roomId, revision, memberIds }: { roomId: string; revision: number; memberIds: string[] }) {
  const { data, error, refresh } = useSocial();
  const action = useSocialCommand();
  return <section className="panel"><h2>邀请好友</h2><p className="muted">邀请将发送给好友，对方确认后即可加入房间。</p>
    {(error || action.error) && <p role="alert" className="error-notice">{error || action.error}<button className="secondary" onClick={() => void refresh()}>重试读取好友</button></p>}
    {action.notice && <p role="status">{action.notice}</p>}
    {!data ? <p>正在读取好友…</p> : data.friends.length === 0 ? <p>还没有好友。<a href="/friends/add">添加好友</a></p> : data.friends.map(item => <article className="social-row" key={item.person.id}>
      <div className="social-person"><PersonAvatar person={item.person} /><strong>{item.person.displayName}</strong></div><button className="secondary" disabled={action.busy || memberIds.includes(item.person.id)} onClick={() => void action.run(`invite:${roomId}:${item.person.id}:${revision}`, requestId => api.inviteFriendToRoom(roomId, { requestId, friendAccountId: item.person.id, expectedRoomRevision: revision }), `已邀请 ${item.person.displayName}`)}>{memberIds.includes(item.person.id) ? '已在房间' : `邀请 ${item.person.displayName}`}</button>
    </article>)}
  </section>;
}
