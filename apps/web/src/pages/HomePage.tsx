import { GameCatalog } from './GameCatalog.js';

export function HomePage() {
  return (
    <>
      <section className="page-heading hero-playboard">
        <div>
          <span className="eyebrow" style={{ color: 'var(--muted)', fontWeight: 600 }}>PlayBoard · 桌游乐园</span>
          <h1>游戏大厅</h1>
          <p>把桌游的快乐，带给更多人。在云端随时开桌，结识同好，让每一局都有新的故事。</p>
          <div className="hero-stats">
            <span className="hero-stat-pill">👥 <strong>1,280+</strong> 在线玩家</span>
            <span className="hero-stat-pill">🎲 <strong>200+</strong> 欢乐房间</span>
            <span className="hero-stat-pill">❤️ <strong>50万+</strong> 精彩对局</span>
          </div>
        </div>
      </section>
      <GameCatalog />
    </>
  );
}
