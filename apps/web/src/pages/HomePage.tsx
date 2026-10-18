import { GameCatalog } from './GameCatalog.js';
import { RoomInviteEntry } from './RoomInviteEntry.js';

export function HomePage() {
  return (
    <>
      <section className="page-heading discovery-heading">
        <div>
          <p className="eyebrow">PLAYBOARD · 和朋友，共享一张桌</p>
          <h1>游戏大厅</h1>
          <p>挑一款喜欢的桌游，随时开局。</p>
        </div>
      </section>
      <RoomInviteEntry />
      <div className="mobile-lobby-actions" aria-label="大厅快捷入口">
        <a href="/friends">
          <span aria-hidden="true">♧</span>
          <span>
            好友<small>找桌友开黑</small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
        <a href="/friends/invitations">
          <span aria-hidden="true">✉</span>
          <span>
            房间邀请<small>赴好友之约</small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>
      <GameCatalog />
    </>
  );
}
