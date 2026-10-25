import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AiPointBills, AiPointLedger } from '@boardgame/protocol';
import { api } from '../platform.js';
import { tokenSellingRates } from './OfficialAiPrice.js';
import '../styles/ai-point-bills.css';

function MatchCharges({ matchId }: { matchId: string }) {
  const [page, setPage] = useState<AiPointLedger>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(
    async (before?: string) => {
      if (request.current && !request.current.signal.aborted) return;
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setError('');
      try {
        const result = await api.aiPointMatchLedger(matchId, before, controller.signal);
        if (!controller.signal.aborted)
          setPage((old) => ({
            items: before && old ? [...old.items, ...result.items] : result.items,
            nextCursor: result.nextCursor,
          }));
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '明细读取失败');
      } finally {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [matchId],
  );

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
    };
  }, [load]);

  return (
    <>
      {busy && <p role="status">正在读取单局明细…</p>}
      {error && (
        <div className="ai-feedback" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void load(page?.nextCursor ?? undefined)}
          >
            重试明细
          </button>
        </div>
      )}
      {page && !page.items.length && <p className="muted">暂无已结算的扣点明细。</p>}
      <ol className="ai-charge-list" aria-label="单局扣点明细">
        {page?.items.map((item) => (
          <li key={item.id}>
            <div>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
              <p>
                输入 {item.usage?.inputTokens?.toLocaleString() ?? '未记录'} / 输出{' '}
                {item.usage?.outputTokens?.toLocaleString() ?? '未记录'} token
              </p>
              <small>
                {item.tokenBilling ? tokenSellingRates(item.tokenBilling.pricing) : '按次计费'} ·
                本次扣除 {-item.delta} 点
              </small>
            </div>
          </li>
        ))}
      </ol>
      {page?.nextCursor && !error && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(page.nextCursor!)}
        >
          更早行动明细
        </button>
      )}
      <a href={`/matches/${matchId}`}>查看对局（需参与权限）</a>
    </>
  );
}

export function AiPointBill({ item }: { item: AiPointBills['items'][number] }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const titleId = useId();
  if (!item.matchId)
    return (
      <li className="ai-point-grant">
        <div>
          <strong>{item.note}</strong>
          <small>{new Date(item.createdAt).toLocaleString()}</small>
        </div>
        <span className={item.delta > 0 ? 'ai-credit' : ''}>
          {item.delta > 0 ? '+' : ''}
          {item.delta} 点
        </span>
      </li>
    );
  return (
    <li className="ai-match-bill">
      <button
        type="button"
        className="ai-bill-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ai-bill-label">
          <strong id={titleId}>{item.gameName ?? '桌游对局'}</strong>
          <small>
            {new Date(item.createdAt).toLocaleString()} · {item.actionCount} 次计费行动
          </small>
          <small>
            单局 {item.matchId.slice(0, 8)} · {open ? '收起明细' : '查看 token 明细'}
          </small>
        </span>
        <span className="ai-bill-amount">
          {item.delta} 点 <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
      </button>
      {open && (
        <div className="ai-bill-detail" id={regionId} role="region" aria-labelledby={titleId}>
          <p className="ai-bill-tokens">
            输入 <strong>{item.inputTokens.toLocaleString()}</strong> / 输出{' '}
            <strong>{item.outputTokens.toLocaleString()}</strong> token
          </p>
          <p className="muted">
            {item.missingUsageCount > 0
              ? `以上为已记录用量；${item.missingUsageCount} 次行动的 token 记录不完整。`
              : '统计本局已结算的扣点行动。'}
            失败、免费兜底和未扣点调用不计入账单。
          </p>
          <MatchCharges matchId={item.matchId} />
        </div>
      )}
    </li>
  );
}
