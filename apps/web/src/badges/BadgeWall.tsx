import { badgeRuleLabel } from './rule-label.js';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { manualBadgeIdSchema } from '@boardgame/protocol';
import type {
  Badge,
  BadgeCollection,
  BadgeDisplayInput,
  BadgeGrantInput,
} from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../platform.js';
import { BadgeArtwork } from './BadgeArtwork.js';
import '../styles/badges.css';

export function BadgeWall({ accountId }: { accountId?: string }) {
  const [collection, setCollection] = useState<BadgeCollection>();
  const [chosen, setChosen] = useState<Badge['id'][]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState<BadgeDisplayInput | BadgeGrantInput>();
  const alive = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    alive.current = true;
    setCollection(undefined);
    setError('');
    setPending(undefined);
    void (accountId ? api.adminBadges(accountId, controller.signal) : api.badges(controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        setCollection(result);
        setChosen(result.displayed);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof ApiError ? cause.message : '徽章加载失败，请重试。');
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [accountId, attempt]);

  async function save(input: BadgeDisplayInput | BadgeGrantInput) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setPending(input);
    try {
      if (!accountId) await api.me();
      if (accountId && 'badgeId' in input) await api.grantBadge(accountId, input);
      else if ('displayed' in input) await api.saveDisplayedBadges(input);
      // A successful replay can contain an older revision; read the current authoritative collection.
      const saved = accountId ? await api.adminBadges(accountId) : await api.badges();
      if (!alive.current) return;
      setCollection(saved);
      setChosen(saved.displayed);
      setPending(undefined);
      setNotice(accountId ? '身份徽章已更新。' : '展示徽章已保存。');
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && !cause.retryable) setPending(undefined);
      setError(
        cause instanceof ApiError ? cause.message : '操作结果未确认，请重试原操作或刷新核对。',
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (!collection)
    return (
      <PageFeedback
        title={error ? '徽章加载失败' : '正在打开徽章收藏…'}
        loading={!error}
        {...(error ? { retry: () => setAttempt((value) => value + 1) } : {})}
      >
        {error}
      </PageFeedback>
    );
  const items = collection.items.filter(
    (item) => filter === 'all' || (filter === 'earned' ? item.earned : item.kind === filter),
  );
  const changed = JSON.stringify(chosen) !== JSON.stringify(collection.displayed);
  return (
    <div className="badge-wall">
      <header className="badge-heading">
        <div>
          <p className="eyebrow">PLAYBOARD · 收藏每一次相聚</p>
          <h1>{accountId ? `${collection.displayName}的徽章` : '我的徽章'}</h1>
          <p className="muted">
            已获得 {collection.items.filter((item) => item.earned).length} /{' '}
            {collection.items.length} 枚
            {accountId ? ' · 身份荣誉由管理员授予或收回' : ' · 选择最多 3 枚展示在名片上'}
          </p>
        </div>
        {!accountId && (
          <button
            disabled={busy || !!pending || !changed}
            onClick={() =>
              void save({
                requestId: crypto.randomUUID(),
                expectedRevision: collection.revision,
                displayed: chosen,
              })
            }
          >
            {busy ? '保存中…' : `保存展示（${chosen.length}/3）`}
          </button>
        )}
      </header>
      {error && (
        <div className="badge-feedback" role="alert">
          <p>{error}</p>
          {pending && (
            <button disabled={busy} onClick={() => void save(pending)}>
              重试原操作
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setNotice('');
              setAttempt((value) => value + 1);
            }}
          >
            刷新徽章
          </button>
        </div>
      )}
      {notice && (
        <p className="badge-feedback" role="status">
          ✓ {notice}
        </p>
      )}
      <div className="badge-filters" role="group" aria-label="筛选徽章">
        {[
          ['all', '全部'],
          ['earned', '已获得'],
          ['achievement', '成就'],
          ['honor', '身份荣誉'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'badge-filter-active' : 'secondary'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="badge-grid">
        {items.map((item) => (
          <article
            key={item.id}
            className={`badge-card ${item.earned ? 'is-earned' : 'is-locked'}`}
            aria-label={item.name}
            data-kind={item.kind}
          >
            <BadgeArtwork badge={item} />
            <div className="badge-card-body">
              <small>
                {item.kind === 'honor' ? '身份荣誉' : '成长成就'} ·{' '}
                {item.earned ? '已获得' : '未解锁'}
              </small>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
              {item.rule && <p className="muted">{badgeRuleLabel(item.rule)}</p>}
              {item.kind === 'achievement' && (
                <div className="badge-progress">
                  <progress
                    aria-label={`${item.name}进度`}
                    max={item.target}
                    value={item.progress}
                  />
                  <span>
                    {item.progress} / {item.target}
                  </span>
                </div>
              )}
              {item.awardedAt && (
                <small>授予于 {new Date(item.awardedAt).toLocaleDateString('zh-CN')}</small>
              )}
              {accountId ? (
                item.kind === 'honor' && (
                  <button
                    className="secondary"
                    disabled={busy || !!pending}
                    onClick={() =>
                      void save({
                        requestId: crypto.randomUUID(),
                        expectedRevision: collection.revision,
                        badgeId: manualBadgeIdSchema.parse(item.id),
                        granted: !item.earned,
                      })
                    }
                  >
                    {item.earned ? '收回徽章' : '授予徽章'}
                  </button>
                )
              ) : (
                <label className="badge-select">
                  <input
                    type="checkbox"
                    checked={chosen.includes(item.id)}
                    disabled={
                      busy ||
                      !!pending ||
                      (!item.earned && !chosen.includes(item.id)) ||
                      (chosen.length >= 3 && !chosen.includes(item.id))
                    }
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {chosen.includes(item.id) ? '已选展示' : '展示在名片'}
                </label>
              )}
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 && <p className="muted">还没有这一类徽章，下一次相聚就是新的开始。</p>}
      <p className="muted">
        成就按服务端记录计算；进行中、中止和开发实验对局不计入完成数。与 AI
        的正式对局计入，托管不影响参与资格。
      </p>
    </div>
  );
}
