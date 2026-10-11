import { GameCatalog } from './GameCatalog.js';

export function HomePage() {
  return (
    <>
      <section className="page-heading hero-playboard">
        <div>
          <span
            className="eyebrow"
            style={{ color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em' }}
          >
            ⭐ PLAYBOARD · 桌游乐园
          </span>
          <h1 style={{ color: 'var(--text)', fontWeight: 900 }}>游戏大厅</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '640px' }}>
            选一款桌游，和朋友一起坐下来玩。在云端随时开桌，结识同好。
          </p>
        </div>
      </section>
      <GameCatalog />
    </>
  );
}
