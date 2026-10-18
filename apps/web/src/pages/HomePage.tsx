import { GameCatalog } from './GameCatalog.js';
import { RoomInviteEntry } from './RoomInviteEntry.js';

export function HomePage() {
  return (
    <>
      <section className="page-heading discovery-heading">
        <div>
          <p className="eyebrow">PLAYBOARD · 和朋友，共享一张桌</p>
          <h1>游戏大厅</h1>
          <p>还没决定玩什么？先试一手，再约朋友开一桌。</p>
        </div>
      </section>
      <RoomInviteEntry />
      <div className="mobile-lobby-actions" aria-label="大厅快捷入口">
        <a href="/friends">
          <span aria-hidden="true">♧</span>
          <span>
            好友一起玩<small>找到你的桌友</small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
        <a href="/friends/invitations">
          <span aria-hidden="true">✉</span>
          <span>
            房间邀请<small>赴一场桌游之约</small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>
      <GameCatalog />
    </>
  );
}
