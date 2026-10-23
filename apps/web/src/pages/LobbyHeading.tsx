import { RoomInviteEntry } from './RoomInviteEntry.js';

export function LobbyHeading({ displayName }: { displayName?: string }) {
  return (
    <section className="page-heading discovery-heading lobby-heading">
      <div className="lobby-heading-copy">
        <p className="eyebrow">
          {displayName ? `你好，${displayName}` : 'PLAYBOARD · 和朋友，共享一张桌'}
        </p>
        <h1>游戏大厅</h1>
        <p>{displayName ? '回到进行中的对局，或挑选新桌游。' : '挑一款喜欢的桌游，随时开局。'}</p>
      </div>
      <RoomInviteEntry />
    </section>
  );
}
