import { useEffect, useRef, useState } from 'react';
import type { AdminUpdateStatus } from '@boardgame/protocol';
import { Button } from '@boardgame/ui';
import { api } from '../../platform.js';
import { AdminLayout, adminError } from './AdminLayout.js';

const messages: Record<AdminUpdateStatus['phase'], string> = {
  unavailable: '当前服务未启用在线更新托管，或仍使用旧版更新器，请由维护者启用或重启后使用。',
  disabled: '在线更新已由部署配置停用。',
  idle: '可以检测已发布的新版本。',
  checking: '正在检测发布分支…',
  building: '发现新版本，正在后台安装依赖并构建…',
  current: '当前已是最新版本。',
  waiting: '新版已准备，正在暂停新请求并等待已接收的请求完成，随后自动切换。',
  maintenance: '新版包含数据库迁移，需要维护者确认兼容性并备份后安排更新。',
  applying: '正在切换版本，服务暂时不可用；对局进度保留，连接恢复后继续。',
  updated: '新版本已更新成功。已打开的页面可手动刷新以使用新版界面。',
  failed: '更新未完成，请根据下方原因处理后重试。',
};
type Failure = NonNullable<AdminUpdateStatus['failure']>;
const failureStages: Record<Failure['stage'], string> = {
  fetch: '拉取发布版本', history: '检查版本历史', checkout: '准备版本目录',
  install: '安装构建依赖', build: '构建生产版本', drain: '等待在途请求',
  stop: '停止旧服务', migrate: '数据库迁移', sync: '同步游戏版本',
  start: '启动并验证新版服务', persist: '保存激活版本', restart: '恢复当前服务',
};
const failureReasons: Record<Failure['reason'], string> = {
  migration_changed: '已应用的数据库迁移与发布文件不一致，已拒绝继续。请维护者核对迁移历史，保留数据库和校验保护。',
  build_tool_missing: '所需模块或构建工具缺失，请检查发布依赖声明与完整依赖安装。',
  compilation: '发布代码未通过编译，请维护者在相同提交执行 pnpm build 修复后重新发布。',
  disk_full: '磁盘空间不足，请清理可安全删除的文件后重试，保留数据库、资源和仍在使用的旧构建。',
  permission: '部署账户无文件访问或执行权限，请检查更新目录权限。',
  authentication: '仓库访问认证失败，请检查部署账户的 GitHub 权限和 Git credential helper。',
  network: '网络连接失败，请检查服务器到 GitHub 或依赖仓库的连接后重试。',
  lockfile: '依赖锁文件与安装配置不一致，需要维护者修复并提交锁文件后重新发布。',
  branch_missing: '远程发布分支不存在，请检查 UPDATE_BRANCH 配置并重启更新器。',
  command_failed: '命令执行失败，请结合失败步骤和退出码检查发布代码、依赖或部署配置。',
  command_missing: '所需命令未安装或不在服务 PATH 中，请检查 Git、Node.js 和 pnpm。',
  pnpm_unavailable: '未找到 pnpm 启动入口，请通过 pnpm start:online 启动，或配置 UPDATE_PNPM_CLI 后重启。',
  timeout: '命令执行超时，请检查网络、磁盘和构建负载后重试。',
  history_diverged: '当前版本不在发布分支的历史中，已阻止自动切换；请维护者核对部署版本与发布分支。',
  drain_timeout: '在途请求未在 30 秒内结束，已取消切换并恢复接收请求；请稍后重试。',
  readiness: 'API 退出或未通过就绪检查，请检查服务日志、端口、数据库连接和游戏版本。',
  recovery_failed: '更新失败且旧服务恢复失败，需要维护者立即检查 API 日志和 /health/ready。',
  unknown: '此步骤发生未分类错误，请按下方时间检查更新器和 API 日志。',
};
const working = new Set(['checking', 'building', 'waiting', 'applying']);
const steps = ['检测发布版本', '安装依赖并构建', '等待安全切换', '切换并验证服务'];
const progressPhase: Partial<Record<AdminUpdateStatus['phase'], number>> = {
  checking: 0, building: 1, waiting: 2, maintenance: 2, applying: 3, updated: 4,
};

function UpdateProgress({ phase }: { phase: AdminUpdateStatus['phase'] }) {
  const active = progressPhase[phase];
  if (active === undefined) return null;
  return (
    <ol className="admin-update-progress" aria-label="更新步骤">
      {steps.map((label, index) => {
        const complete = index < active;
        const current = index === active;
        return (
          <li key={label} data-state={complete ? 'complete' : current ? 'active' : 'pending'}
            aria-current={current ? 'step' : undefined}>
            <span className="admin-update-step-number" aria-hidden="true">{complete ? '✓' : index + 1}</span>
            <span>{label}</span>
            <small>{complete ? '已完成' : current ? phase === 'waiting' || phase === 'maintenance' ? '等待中' : '进行中' : '待开始'}</small>
          </li>
        );
      })}
    </ol>
  );
}

function UpdatePanel() {
  const [status, setStatus] = useState<AdminUpdateStatus>();
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const mounted = useRef(false);
  const command = useRef<AbortController | null>(null);
  const retryId = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const version = generation.current;
      try {
        const value = await api.adminUpdateStatus(controller.signal);
        if (!controller.signal.aborted && version === generation.current && !command.current) {
          setStatus(value);
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted && version === generation.current) setError(adminError(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 3000);
      }
    }
    void load();
    return () => {
      mounted.current = false;
      controller.abort();
      command.current?.abort();
      clearTimeout(timer);
    };
  }, []);
  async function check() {
    if (command.current) return;
    const controller = new AbortController();
    command.current = controller;
    generation.current++;
    setSending(true);
    setError('');
    retryId.current ??= crypto.randomUUID();
    try {
      const value = await api.checkAdminUpdate(retryId.current, controller.signal);
      if (mounted.current) { setStatus(value); retryId.current = null; }
    } catch (cause) {
      if (mounted.current) setError(adminError(cause));
    } finally {
      command.current = null;
      if (mounted.current) setSending(false);
    }
  }
  return (
    <section className="admin-update-section" aria-label="服务更新">
      <p role="status">{status ? messages[status.phase] : '正在读取更新状态…'}</p>
      {status?.phase === 'failed' && <div role="alert">
        {status.failure ? <>
          <p><strong>失败步骤：{failureStages[status.failure.stage]}</strong></p>
          <p>{failureReasons[status.failure.reason]}</p>
          <p className="muted">失败时间：{new Date(status.failure.occurredAt).toLocaleString('zh-CN')}
            {status.failure.exitCode !== null && ` · 退出码：${status.failure.exitCode}`}
            {` · 原因代码：${status.failure.reason}`}</p>
        </> : <p>旧版更新器未提供失败详情。请维护者升级并重启托管进程后再次检测。</p>}
      </div>}
      {status && <UpdateProgress phase={status.phase} />}
      {status?.phase === 'waiting' && <div className="admin-update-waiting">
        <p>构建已完成，尚未切换版本。</p>
        <p className="muted">等待在途请求最多 30 秒，超时会恢复服务并报告失败。未结束对局和常驻连接不会阻塞更新；切换时连接会短暂断开，对局进度保留。</p>
      </div>}
      <dl className="admin-update-details">
        <div><dt>发布分支</dt><dd>{status?.branch ?? '—'}</dd></div>
        <div><dt>当前版本</dt><dd>{status?.currentSha?.slice(0, 12) ?? '—'}</dd></div>
        {status?.candidateSha && <div><dt>候选版本</dt><dd>{status.candidateSha.slice(0, 12)}</dd></div>}
        <div><dt>最近检测</dt><dd>{status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString('zh-CN') : '尚未检测'}</dd></div>
      </dl>
      {error && <p role="alert">{error}</p>}
      <Button onClick={() => { void check(); }} disabled={!status?.enabled || sending || working.has(status.phase)}>
        {sending ? '正在提交…' : status?.phase === 'waiting' ? '等待安全切换' : status && working.has(status.phase) ? '更新处理中…' : '立即检测并更新'}
      </Button>
      <p className="muted">检测已合并到发布分支的代码。更新会短暂重连，不结束对局或自动刷新玩家页面。新版更新器首次启用需要维护者重启托管进程。</p>
    </section>
  );
}

export function AdminUpdatesPage() {
  return <AdminLayout path="/admin/updates" title="服务更新" description="检测发布版本，在安全条件满足后更新服务。">
    <UpdatePanel />
  </AdminLayout>;
}
