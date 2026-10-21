import { useEffect, useState } from 'react';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../../platform.js';
import { AdminLayout, adminError } from './AdminLayout.js';
import { SocialSettingsPanel } from './SocialSettingsPanel.js';

function Overview() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminOverview>>>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  useEffect(() => {
    let disposed = false;
    setError('');
    setLoading(true);
    void api
      .adminOverview()
      .then((value) => {
        if (!disposed) {
          setData(value);
          setUpdatedAt(new Date());
        }
      })
      .catch((cause) => {
        if (!disposed) setError(adminError(cause));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [attempt]);
  if (!data)
    return error ? (
      <PageFeedback title="总览加载失败" retry={() => setAttempt((value) => value + 1)}>
        {error}
      </PageFeedback>
    ) : (
      <PageFeedback title="正在加载平台总览…" loading />
    );
  const metrics = [
    {
      label: '账户',
      value: data.accounts,
      hint: `${data.disabledAccounts} 个已停用`,
      href: '/admin/accounts',
    },
    { label: '开放房间', value: data.openRooms, hint: `${data.activeMatches} 局进行中` },
    {
      label: '安装版本',
      value: data.installedGames,
      hint: `${data.enabledGames} 个已上架`,
      href: '/admin/catalog',
    },
    {
      label: '待审申请',
      value: data.pendingSubmissions,
      hint: '等待资料审核',
      href: '/admin/submissions',
    },
  ];
  return (
    <>
      <div className="admin-section-heading">
        <div>
          <h2>平台概况</h2>
          <p className="muted" role="status">
            {loading ? '正在刷新统计…' : `最近读取 ${updatedAt?.toLocaleTimeString('zh-CN')}`}
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          刷新统计
        </button>
      </div>
      {error && (
        <p role="alert" className="error-notice">
          刷新失败，以下保留上次读取的数据。{error}
        </p>
      )}
      <div className="admin-metrics" aria-label="平台统计" aria-busy={loading}>
        {metrics.map(({ label, value, hint, href }) => (
          <section className="admin-metric" key={label}>
            <h3>{label}</h3>
            <strong>{value.toLocaleString('zh-CN')}</strong>
            <p className="muted">{hint}</p>
            {href && (
              <a href={href} aria-label={`查看${label}`}>
                查看 <span aria-hidden="true">↗</span>
              </a>
            )}
          </section>
        ))}
      </div>
      <section
        className="admin-attention"
        aria-label="接入审核待办"
        data-pending={data.pendingSubmissions > 0}
      >
        <div>
          <span className="admin-kicker">接入审核</span>
          <h2>
            {data.pendingSubmissions > 0
              ? `${data.pendingSubmissions} 份申请等待处理`
              : '暂时没有待审申请'}
          </h2>
          <p>审阅游戏资料与仓库，记录处理意见；发布游戏请前往游戏管理。</p>
        </div>
        <a className="button-link" href="/admin/submissions">
          查看接入申请 →
        </a>
      </section>
      <section aria-labelledby="admin-shortcuts-title">
        <div className="admin-section-heading">
          <h2 id="admin-shortcuts-title">常用管理</h2>
          <span className="muted">选择一项，开始处理</span>
        </div>
        <div className="admin-shortcuts">
          {[
            ['/admin/accounts', '玩家账户', '查找玩家、管理状态、徽章与桌游币。'],
            ['/admin/catalog', '游戏版本', '上传游戏 ZIP，审核发布与管理上下架。'],
            ['/admin/official-ai', '官方 AI 与点数', '配置陪玩模型、发放点数与核对用量。'],
            ['/admin/updates', '服务更新', '检查可用更新，查看发布进度与诊断。'],
          ].map(([href, title, description]) => (
            <a key={href} href={href}>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>
      <details className="admin-settings panel">
        <summary>
          平台规则 <span className="muted">好友 ID 修改间隔</span>
        </summary>
        <SocialSettingsPanel />
      </details>
      <a className="admin-status-link" href="/status">
        查看 API、数据库与游戏目录状态 ↗
      </a>
    </>
  );
}
export function AdminOverviewPage() {
  return (
    <AdminLayout path="/admin" title="管理员后台" description="掌握平台近况，处理玩家与游戏事务。">
      <Overview />
    </AdminLayout>
  );
}
