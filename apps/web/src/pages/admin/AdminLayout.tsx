import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { ApiError } from '@boardgame/client-sdk';
import { PageFeedback } from '@boardgame/ui';
import { api, navigate } from '../../platform.js';
import '../../styles/admin.css';

const meSchema = z.object({
  account: z.object({ role: z.enum(['user', 'administrator']) }),
});
const links = [
  ['/admin', '管理总览'],
  ['/admin/accounts', '账户管理'],
  ['/admin/catalog', '游戏管理'],
  ['/admin/submissions', '接入审核'],
  ['/admin/games', '游戏展示'],
  ['/admin/assets', '资源管理'],
  ['/admin/updates', '服务更新'],
] as const;

export function AdminLayout({
  path,
  title,
  description,
  children,
}: {
  path: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<
    'loading' | 'allowed' | 'denied' | 'error'
  >('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setState('loading');
    void api
      .me()
      .then((raw) => {
        if (!disposed)
          setState(
            meSchema.parse(raw).account.role === 'administrator'
              ? 'allowed'
              : 'denied',
          );
      })
      .catch((cause) => {
        if (disposed) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED')
          navigate('/login');
        else setState('error');
      });
    return () => {
      disposed = true;
    };
  }, [attempt]);
  if (state === 'denied')
    return (
      <PageFeedback title="需要管理员权限">
        请使用管理员账户登录后访问后台。<a href="/profile">查看我的账户</a>
      </PageFeedback>
    );
  if (state === 'error')
    return (
      <PageFeedback
        title="无法验证管理权限"
        retry={() => setAttempt((value) => value + 1)}
      >
        请检查连接后重试。
      </PageFeedback>
    );
  if (state === 'loading')
    return <PageFeedback title="正在验证管理权限…" loading />;
  return (
    <div className="admin-workspace">
      <section className="page-heading">
        <div>
          <p className="eyebrow">平台管理</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <a className="button secondary" href="/">
          返回大厅
        </a>
      </section>
      <nav className="admin-nav" aria-label="后台导航">
        {links.map(([href, label]) => (
          <a
            key={href}
            href={href}
            aria-current={path === href ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}

export function adminError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.code === 'UNAUTHENTICATED') return '会话已失效，请重新登录。';
    if (cause.code === 'STATE_CONFLICT')
      return '数据已被其他操作更新，请刷新后重新决定。';
    return cause.message;
  }
  return '操作未确认，请检查连接后重试或刷新。';
}

// Keep the original ID when a response is lost and the same decision is retried.
export function useAdminRequestId() {
  const previous = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  return (decision: unknown) => {
    const fingerprint = JSON.stringify(decision);
    if (previous.current?.fingerprint !== fingerprint)
      previous.current = { fingerprint, id: crypto.randomUUID() };
    return previous.current.id;
  };
}
