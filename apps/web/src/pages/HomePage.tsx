import { GameCatalog } from './GameCatalog.js';
import { RoomInviteEntry } from './RoomInviteEntry.js';

export function HomePage() {
  return (
    <>
      <section className="page-heading hero-playboard">
        <div>
          <span
            className="eyebrow"
            style={{ color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em' }}
          >
            ⭐ PLAYBOARD · 顶尖桌游联盟
          </span>
          <h1 style={{ color: 'var(--text)', fontWeight: 900 }}>游戏大厅</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '640px' }}>
            选一款桌游，和朋友一起坐下来玩。在云端随时开桌，结识同好。
          </p>
        </div>
      </section>
      <RoomInviteEntry />
      <div className="mobile-lobby-actions" aria-label="大厅快捷入口">
        <a href="/friends"><span aria-hidden="true">♧</span><span>好友一起玩<small>找到你的桌友</small></span><span aria-hidden="true">↗</span></a>
        <a href="/friends/invitations"><span aria-hidden="true">✉</span><span>房间邀请<small>赴一场桌游之约</small></span><span aria-hidden="true">↗</span></a>
      </div>
      <GameCatalog />
    </>
  );
}
