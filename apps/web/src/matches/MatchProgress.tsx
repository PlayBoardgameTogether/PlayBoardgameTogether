import { useEffect, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { BadgeCollection } from '@boardgame/protocol';
import { api } from '../platform.js';
import { useSocialContext } from '../social/SocialProvider.js';

export function MatchProgress({ matchId }: { matchId: string }) {
  const { account, clearSession } = useSocialContext();
  if (!account || account.status !== 'active') return null;
  return (
    <CurrentProgress
      key={`${matchId}:${account.id}`}
      accountId={account.id}
      onExpired={clearSession}
    />
  );
}

function CurrentProgress({ accountId, onExpired }: { accountId: string; onExpired: () => void }) {
  const [collection, setCollection] = useState<BadgeCollection>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCollection(undefined);
    setError(false);
    void api
      .badges(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.accountId === accountId) setCollection(next);
        else setError(true);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') onExpired();
        else setError(true);
      });
    return () => controller.abort();
  }, [accountId, attempt, onExpired]);

  const milestones = ['first-match', 'ten-matches', 'fifty-matches']
    .map((id) => collection?.items.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  // Badge progress is capped by the API; reaching the cap is a lower bound, not a total.
  const completed = milestones.at(-1);
  const next = milestones.find((item) => !item.earned);
  return (
    <section className="match-progress" aria-label="我的成长">
      <div className="match-progress-heading">
        <h3>我的成长</h3>
        <a href="/profile/badges">查看我的徽章</a>
      </div>
      {!collection ? (
        <p role="status">
          {error ? (
            <>
              成长进度暂时无法读取。
              <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
                重试读取成长进度
              </button>
            </>
          ) : (
            '正在读取当前成长进度…'
          )}
        </p>
      ) : (
        <>
          {completed && (
            <p>
              当前已完成{completed.progress >= completed.target ? '至少' : ''}{' '}
              <strong>{completed.progress}</strong> 局正式对局
            </p>
          )}
          {next ? (
            <div className="match-progress-milestone">
              <span>
                {next.name} · {next.progress} / {next.target} 局
              </span>
              <progress aria-label={next.name} value={next.progress} max={next.target} />
            </div>
          ) : (
            completed && <p className="muted">已达成全部场次成长徽章</p>
          )}
        </>
      )}
    </section>
  );
}
