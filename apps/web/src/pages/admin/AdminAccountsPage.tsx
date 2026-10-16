import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminAccount } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../../platform.js';
import { AdminLayout, adminError, useAdminRequestId } from './AdminLayout.js';

function Accounts() {
  const requestId = useAdminRequestId();
  const [page, setPage] =
    useState<Awaited<ReturnType<typeof api.adminAccounts>>>();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [before, setBefore] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setPage(undefined);
    setError('');
    void api
      .adminAccounts(search, before)
      .then((value) => {
        if (!disposed) setPage(value);
      })
      .catch((cause) => {
        if (!disposed) setError(adminError(cause));
      });
    return () => {
      disposed = true;
    };
  }, [search, before, attempt]);
  function find(event: FormEvent) {
    event.preventDefault();
    setBefore(undefined);
    setSearch(draft.trim());
    setAttempt((value) => value + 1);
    setNotice('');
  }
  async function change(account: AdminAccount) {
    if (lock.current) return;
    const status = account.status === 'active' ? 'disabled' : 'active';
    if (
      !window.confirm(
        status === 'disabled'
          ? `停用「${account.displayName}」？该账户将立即退出所有会话，无法登录。`
          : `启用「${account.displayName}」？该账户将可以重新登录。`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.setAdminAccountStatus(account.id, {
        requestId: requestId([account.id, account.revision, status]),
        expectedRevision: account.revision,
        status,
      });
      if (!alive.current) return;
      setPage(
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((item) =>
              item.id === saved.id ? saved : item,
            ),
          },
      );
      setNotice(
        `${saved.displayName}已${saved.status === 'active' ? '启用' : '停用'}。`,
      );
    } catch (cause) {
      if (alive.current) setError(adminError(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <form className="admin-search panel" onSubmit={find}>
        <label>
          搜索账户
          <input
            maxLength={32}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="用户名或昵称"
          />
        </label>
        <button disabled={busy}>搜索</button>
      </form>
      <p className="muted">
        停用会撤销所有会话；启用后需重新登录。管理员账户由维护者通过账户命令管理。
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!page ? (
        error ? (
          <button
            className="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            刷新账户
          </button>
        ) : (
          <PageFeedback title="正在加载账户…" loading />
        )
      ) : (
        <>
          <div className="admin-records">
            {page.items.map((account) => (
              <article
                className="panel admin-record"
                key={account.id}
                aria-label={account.username}
              >
                <div>
                  <h2>{account.displayName}</h2>
                  <p>
                    {account.username} ·{' '}
                    {account.role === 'administrator' ? '管理员' : '玩家'}
                  </p>
                  <small className="muted">{account.id}</small>
                </div>
                <div className="admin-record-actions">
                  <a href={`/admin/accounts/${account.id}/badges`}>管理徽章</a>
                  <a href={`/admin/accounts/${account.id}/coins`}>管理桌游币</a>
                  <span className="status-badge">
                    {account.status === 'active' ? '已启用' : '已停用'}
                  </span>
                  {account.role === 'user' && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void change(account)}
                    >
                      {account.status === 'active' ? '停用账户' : '启用账户'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {page.items.length === 0 && (
            <p className="panel">未找到匹配账户，请调整用户名或昵称。</p>
          )}
          <div className="admin-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setBefore(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              刷新账户
            </button>
            {before && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setBefore(undefined)}
              >
                返回第一页
              </button>
            )}
            {page.nextCursor && (
              <button
                disabled={busy}
                onClick={() => setBefore(page.nextCursor!)}
              >
                下一页
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
export function AdminAccountsPage() {
  return (
    <AdminLayout
      path="/admin/accounts"
      title="账户管理"
      description="查看玩家账户与状态，管理登录资格。"
    >
      <Accounts />
    </AdminLayout>
  );
}
