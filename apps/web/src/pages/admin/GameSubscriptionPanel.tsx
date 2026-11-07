import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { GameSubscription, GameSubscriptionInput } from '@boardgame/protocol';
import { api } from '../../platform.js';
import { adminError } from './AdminLayout.js';

type Pending =
  | { kind: 'save'; input: GameSubscriptionInput }
  | { kind: 'check'; input: Pick<GameSubscriptionInput, 'requestId' | 'expectedRevision'> };

const statusLabels: Record<GameSubscription['status'], string> = {
  idle: '尚未同步',
  running: '正在同步',
  succeeded: '同步完成',
  partial: '部分失败',
  failed: '同步失败',
  interrupted: '上次同步中断，可重试',
};

const outcomeLabels = {
  added: '已添加',
  updated: '已更新',
  current: '已是最新',
  skipped: '已跳过',
  failed: '失败',
};

const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

function SubscriptionSettings({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<GameSubscription>();
  const [draft, setDraft] = useState<{ autoAdd: boolean; autoUpdate: boolean; revision: number }>();
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const lastFinished = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function read() {
      const sequence = ++generation.current;
      try {
        const next = await api.gameSubscription(controller.signal);
        if (controller.signal.aborted || sequence !== generation.current) return;
        if (lastFinished.current !== next.finishedAt && next.finishedAt) onChanged();
        lastFinished.current = next.finishedAt;
        setData(next);
        setReadError('');
        setDraft(
          (previous) =>
            previous ?? {
              autoAdd: next.autoAdd,
              autoUpdate: next.autoUpdate,
              revision: next.revision,
            },
        );
      } catch (cause) {
        if (!controller.signal.aborted && sequence === generation.current)
          setReadError(adminError(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void read(), 5000);
      }
    }

    void read();
    return () => {
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt, onChanged]);

  async function submit(kind: 'save' | 'check') {
    if (!data || !draft || lock.current) return;
    const command: Pending =
      pending ??
      (kind === 'save'
        ? {
            kind,
            input: {
              autoAdd: draft.autoAdd,
              autoUpdate: draft.autoUpdate,
              expectedRevision: draft.revision,
              requestId: crypto.randomUUID(),
            },
          }
        : { kind, input: { expectedRevision: data.revision, requestId: crypto.randomUUID() } });
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    ++generation.current;
    try {
      const saved =
        command.kind === 'save'
          ? await api.saveGameSubscription(command.input)
          : await api.checkGameSubscription(command.input);
      if (!alive.current) return;
      setPending(undefined);
      if (command.kind === 'save') {
        setDraft({
          autoAdd: saved.autoAdd,
          autoUpdate: saved.autoUpdate,
          revision: saved.revision,
        });
        setNotice(
          saved.autoAdd || saved.autoUpdate
            ? '订阅已保存，后台将自动同步官方游戏。'
            : '自动订阅已关闭，已安装游戏保留。',
        );
      } else setNotice('已请求同步，结果将在下方自动更新。');
      setAttempt((value) => value + 1);
    } catch (cause) {
      if (!alive.current) return;
      if (
        !(cause instanceof ApiError) ||
        ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'].includes(cause.code)
      ) {
        setPending(command);
        setError('请求结果尚未确认，请使用原请求重试。');
      } else {
        setPending(undefined);
        setError(adminError(cause));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const dirty =
    draft && data && (draft.autoAdd !== data.autoAdd || draft.autoUpdate !== data.autoUpdate);
  const stale = draft && data && draft.revision !== data.revision;
  const canReauthorize = data?.status === 'failed' || data?.status === 'interrupted';

  return (
    <div className="game-subscription game-subscription-body">
      <div className="game-sub-intro-banner">
        <svg
          className="game-sub-intro-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="muted">
          订阅 PlayBoard 官方目录，每小时检查一次。启用后允许服务器自动校验、安装并上架官方 ZIP
          游戏；内置游戏随平台更新。
        </p>
      </div>

      {!data && !error && !readError && <p role="status">正在读取订阅设置…</p>}

      {data && draft && (
        <>
          <fieldset className="game-sub-scope-section" disabled={busy || !!pending}>
            <legend className="game-sub-scope-legend">自动同步范围</legend>
            <div className="game-sub-cards-grid">
              <div className={`game-sub-option-card ${draft.autoAdd ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  id="game-sub-auto-add"
                  checked={draft.autoAdd}
                  onChange={(event) => setDraft({ ...draft, autoAdd: event.target.checked })}
                />
                <div className="game-sub-option-body">
                  <label htmlFor="game-sub-auto-add" className="game-sub-option-label">
                    自动添加新游戏
                  </label>
                  <p className="game-sub-option-desc">
                    官方目录发布全新游戏时，自动校验安装并上架到游戏大厅
                  </p>
                </div>
              </div>

              <div className={`game-sub-option-card ${draft.autoUpdate ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  id="game-sub-auto-update"
                  checked={draft.autoUpdate}
                  onChange={(event) => setDraft({ ...draft, autoUpdate: event.target.checked })}
                />
                <div className="game-sub-option-body">
                  <label htmlFor="game-sub-auto-update" className="game-sub-option-label">
                    自动更新已安装游戏
                  </label>
                  <p className="game-sub-option-desc">
                    检测到已安装游戏的新版本时自动升级；旧对局仍安全保留原版本规则
                  </p>
                </div>
              </div>
            </div>
            <p className="game-sub-scope-footnote muted">
              已下架游戏保持下架；更新保留旧规则和正在进行的对局。关闭订阅不会卸载游戏。
            </p>
          </fieldset>

          <div className="admin-actions game-sub-toolbar">
            <button
              disabled={
                busy ||
                (!pending && ((!dirty && !canReauthorize) || !!stale)) ||
                pending?.kind === 'check'
              }
              onClick={() => void submit('save')}
            >
              {pending?.kind === 'save' ? '确认原保存请求' : '保存订阅'}
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                (!pending &&
                  (!!dirty ||
                    !!stale ||
                    (!data.autoAdd && !data.autoUpdate) ||
                    data.status === 'running')) ||
                pending?.kind === 'save'
              }
              onClick={() => void submit('check')}
            >
              {pending?.kind === 'check' ? (
                '确认原同步请求'
              ) : (
                <>
                  <svg
                    className={data.status === 'running' ? 'spin-icon' : ''}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 16h5v5" />
                  </svg>
                  <span>立即同步</span>
                </>
              )}
            </button>
            <button
              className="secondary"
              disabled={busy || !!pending}
              onClick={() => {
                setDraft(undefined);
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              重新读取设置
            </button>
          </div>

          {stale && !pending && (
            <p className="game-sub-alert game-sub-alert--warn" role="status">
              订阅设置已被其他操作修改，请重新读取设置后再保存。
            </p>
          )}

          <div className="game-subscription-status" aria-live="polite">
            <div className="game-sub-metric-tile">
              <div className="game-sub-metric-header">
                <span
                  className={`game-sub-status-dot game-sub-status-dot--${
                    data.status === 'succeeded'
                      ? 'ok'
                      : data.status === 'running'
                        ? 'running'
                        : data.status === 'failed'
                          ? 'error'
                          : data.status === 'partial' || data.status === 'interrupted'
                            ? 'warn'
                            : 'idle'
                  }`}
                  aria-hidden="true"
                />
                <span>同步状态</span>
              </div>
              <div className="game-sub-metric-value">
                <strong>
                  {statusLabels[data.status]}
                  {!data.autoAdd && !data.autoUpdate ? ' · 自动订阅已关闭' : ''}
                </strong>
              </div>
              {data.message && <span className="game-sub-metric-sub">{data.message}</span>}
            </div>

            <div className="game-sub-metric-tile">
              <div className="game-sub-metric-header">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>最近完成记录</span>
              </div>
              <div className="game-sub-metric-value">
                <span>最近完成：{time(data.finishedAt)}</span>
              </div>
              <span className="game-sub-metric-sub">
                {data.finishedAt ? '已与官方目录保持一致' : '尚未进行同步'}
              </span>
            </div>

            <div className="game-sub-metric-tile">
              <div className="game-sub-metric-header">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>下次自动检查</span>
              </div>
              <div className="game-sub-metric-value">
                <span>下次检查：{time(data.nextCheckAt)}</span>
              </div>
              <span className="game-sub-metric-sub">
                {data.autoAdd || data.autoUpdate ? '每 60 分钟自动检查一次' : '自动检查已停用'}
              </span>
            </div>
          </div>

          {data.items.length > 0 && (
            <details className="game-sub-detail-panel">
              <summary className="game-sub-detail-summary">
                <span>同步明细（{data.items.length}）</span>
                <div className="game-sub-detail-summary-right">
                  <span className="game-sub-detail-count">共 {data.items.length} 款游戏</span>
                  <svg
                    className="game-subscription-chevron" width="14" height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </summary>
              <ul className="game-subscription-results">
                {data.items.map((item) => (
                  <li key={item.gameId}>
                    <div className="game-sub-item-header">
                      <svg
                        className="game-sub-item-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <circle cx="8" cy="12" r="1.5" />
                        <path d="M14 10h4" />
                        <path d="M16 12v-4" />
                      </svg>
                      <strong>
                        {item.gameId} · {item.version}
                      </strong>
                    </div>
                    <div className="game-sub-item-meta">
                      <span className={`game-sub-badge game-sub-badge--${item.outcome}`}>
                        {outcomeLabels[item.outcome]}
                      </span>
                      <span className="game-sub-item-desc">{item.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {(error || readError) && (
        <p className="error-notice game-sub-alert game-sub-alert--error" role="alert">
          {error || readError}
        </p>
      )}
      {notice && (
        <p className="success-notice game-sub-alert game-sub-alert--success" role="status">
          {notice}
        </p>
      )}
      {!data && (error || readError) && (
        <button
          className="secondary"
          onClick={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}
        >
          重试读取订阅
        </button>
      )}
    </div>
  );
}

export function GameSubscriptionPanel({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="admin-guidance game-subscription-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="game-subscription-summary">
        <div className="game-subscription-header-left">
          <div className="game-subscription-icon-box" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </div>
          <div className="game-subscription-title-wrap">
            <strong>官方游戏订阅</strong>
            <span className="game-subscription-subtitle">
              自动检查、校验并上架 PlayBoard 官方目录 ZIP 游戏
            </span>
          </div>
        </div>
        <div className="game-subscription-header-right">
          <span className="game-subscription-toggle-pill">
            {open ? '收起设置' : '展开管理'}
            <svg
              className="game-subscription-chevron" width="14" height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </summary>
      {open && <SubscriptionSettings onChanged={onChanged} />}
    </details>
  );
}
