import { useEffect, useState } from 'react';
import type { Badge } from '@boardgame/protocol';
import { api } from '../platform.js';
import '../styles/badges.css';

export function BadgeShelf({ accountId, own = false }: { accountId: string; own?: boolean }) {
  const [items, setItems] = useState<Badge[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setItems(undefined);
    setFailed(false);
    void api
      .displayedBadges(accountId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [accountId, attempt]);
  return (
    <section className="badge-shelf" aria-label="精选徽章">
      {items ? (
        items.length ? (
          <ul className="badge-pins">
            {items.map((item) => (
              <li key={item.id} title={item.description}>
                <span aria-hidden="true">{item.symbol}</span> {item.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{own ? '挑选几枚徽章，装点你的桌游名片。' : '暂未展示徽章'}</p>
        )
      ) : failed ? (
        <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
          重试加载徽章
        </button>
      ) : (
        <p className="muted">正在加载徽章…</p>
      )}
      {own && <a href="/profile/badges">我的徽章 →</a>}
    </section>
  );
}
