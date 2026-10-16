import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import {
  coinAdjustmentSchema,
  type CoinAdjustment,
  type CoinWalletPage,
} from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api, navigate } from '../platform.js';
import '../styles/coins.css';

export function CoinWallet({ accountId }: { accountId?: string }) {
  const [wallet, setWallet] = useState<CoinWalletPage>();
  const [direction, setDirection] = useState('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CoinAdjustment>();
  const alive = useRef(false);
  const locked = useRef(false);
  const generation = useRef(0);

  const read = (before?: number, signal?: AbortSignal) =>
    accountId ? api.adminCoinWallet(accountId, before, signal) : api.coinWallet(before, signal);
  function failure(cause: unknown) {
    if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
      setWallet(undefined);
      navigate('/login');
    } else setError(cause instanceof ApiError ? cause.message : '无法确认结果，请检查连接后重试。');
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const current = ++generation.current;
    void read(undefined, controller.signal)
      .then((value) => {
        if (alive.current && current === generation.current) setWallet(value);
      })
      .catch((cause) => {
        if (alive.current && current === generation.current) failure(cause);
      });
    return () => {
      alive.current = false;
      controller.abort();
      generation.current += 1;
    };
    // The parent keys this component by the account identity.
  }, [accountId]);

  async function refresh(before?: number) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await read(before);
      if (alive.current)
        setWallet((previous) =>
          before && previous
            ? { ...value, entries: [...previous.entries, ...value.entries] }
            : value,
        );
    } catch (cause) {
      if (alive.current) failure(cause);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function adjust(input: CoinAdjustment) {
    if (!accountId || locked.current) return;
    locked.current = true;
    setBusy(true);
    setPending(input);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await api.adjustAdminCoins(accountId, input);
      saved = true;
      if (!alive.current) return;
      setPending(undefined);
      setAmount('');
      setReason('');
      setNotice('桌游币调整已保存。');
      // A retried receipt may describe an older balance. Always read the current wallet.
      const value = await read();
      if (alive.current) setWallet(value);
    } catch (cause) {
      if (!alive.current) return;
      const rejected =
        cause instanceof ApiError &&
        [
          'VALIDATION_ERROR',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'STATE_CONFLICT',
          'REQUEST_ID_CONFLICT',
          'ACTION_NOT_ALLOWED',
        ].includes(cause.code);
      if (saved || rejected) setPending(undefined);
      failure(cause);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!wallet || pending) return;
    const parsed = coinAdjustmentSchema.safeParse({
      requestId: crypto.randomUUID(),
      expectedRevision: wallet.revision,
      delta: Number(amount) * (direction === 'grant' ? 1 : -1),
      reason,
    });
    if (!parsed.success) {
      setError('请输入有效的整数数量和调整原因。');
      return;
    }
    void adjust(parsed.data);
  }

  return (
    <div className="coin-wallet">
      <p className="muted">
        桌游币是 PlayBoard 的通用货币。AI 点数仅用于 AI，两者独立记账，不互相兑换。
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="panel">
          <p>
            正在确认：{pending.delta > 0 ? '发放' : '扣回'}{' '}
            {Math.abs(pending.delta).toLocaleString()} 桌游币。{pending.reason}
          </p>
          {!busy && (
            <>
              <p>操作结果尚未确认，重试将核对原操作。</p>
              <button onClick={() => void adjust(pending)}>重试原操作</button>
            </>
          )}
        </div>
      )}
      {!wallet ? (
        <PageFeedback
          title={error ? '无法读取桌游币钱包' : '正在读取桌游币…'}
          loading={!error}
          {...(error ? { retry: () => void refresh() } : {})}
        />
      ) : (
        <>
          <section className="panel coin-balance" aria-label="桌游币余额" aria-busy={busy}>
            <div>
              <p>{accountId ? `${wallet.displayName}的桌游币` : '可用桌游币'}</p>
              <strong className="coin-amount">{wallet.balance.toLocaleString()}</strong>
              <span> 枚</span>
              {accountId && <p className="muted coin-account-id">账户 ID：{wallet.accountId}</p>}
            </div>
            <button
              className="secondary"
              disabled={busy || !!pending}
              onClick={() => void refresh()}
            >
              刷新钱包
            </button>
          </section>
          {accountId && (
            <form className="panel" onSubmit={submit}>
              <h2>调整桌游币</h2>
              <fieldset className="room-fieldset form-stack" disabled={busy || !!pending}>
                <div>
                  <label htmlFor="coin-operation">操作</label>
                  <select
                    id="coin-operation"
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                  >
                    <option value="grant">发放</option>
                    <option value="revoke">扣回</option>
                  </select>
                </div>
                <label>
                  数量
                  <input
                    type="number"
                    min="1"
                    max="1000000000"
                    step="1"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label>
                  调整原因
                  <textarea
                    required
                    maxLength={200}
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <p className="muted">原因将显示在玩家流水中。扣回后余额不能小于 0。</p>
                <button>{busy ? '保存中…' : '确认调整'}</button>
              </fieldset>
            </form>
          )}
          <section aria-labelledby="coin-history-title">
            <h2 id="coin-history-title">桌游币流水</h2>
            {wallet.entries.length === 0 ? (
              <p className="panel">暂无流水。初始余额为 0，管理员发放或扣回后会显示记录。</p>
            ) : (
              <ol className="coin-ledger">
                {wallet.entries.map((entry) => (
                  <li className="panel coin-entry" key={entry.id}>
                    <div>
                      <strong>{entry.reason}</strong>
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString('zh-CN')}
                      </time>
                    </div>
                    <div className="coin-entry-amount">
                      <strong>
                        {entry.delta > 0 ? '+' : ''}
                        {entry.delta.toLocaleString()}
                      </strong>
                      <small>余额 {entry.balanceAfter.toLocaleString()}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {wallet.nextCursor !== null && (
              <button
                className="secondary"
                disabled={busy || !!pending}
                onClick={() => void refresh(wallet.nextCursor!)}
              >
                加载更多流水
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
