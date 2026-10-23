import { GameCatalog } from './GameCatalog.js';
import { LobbyHeading } from './LobbyHeading.js';

export function HomePage() {
  return (
    <>
      <LobbyHeading />
      <GameCatalog />
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
    </>
  );
}
