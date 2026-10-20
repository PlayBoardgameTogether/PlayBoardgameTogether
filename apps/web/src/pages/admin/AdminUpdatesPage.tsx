import { useState } from 'react';
import type { AdminUpdateStatus } from '@boardgame/protocol';
import { Button, ErrorNotice } from '@boardgame/ui';
import { AdminLayout } from './AdminLayout.js';
import { updateWorking, useAdminUpdates } from './useAdminUpdates.js';

type Failure = NonNullable<AdminUpdateStatus['failure']>;
const failureStages: Record<NonNullable<AdminUpdateStatus['stage']>, string> = {
  fetch: '拉取发布版本',
  history: '检查版本历史',
  checkout: '准备版本目录',
  install: '安装构建依赖',
  build: '构建生产版本',
  drain: '等待在途请求',
  stop: '停止旧服务',
  backup: '自动备份并校验',
  migrate: '数据库迁移',
  sync: '同步游戏版本',
  start: '启动并验证新版服务',
  persist: '保存激活版本',
  restart: '恢复当前服务',
};
const failureReasons: Record<Failure['reason'], string> = {
  migration_changed:
    '已应用的数据库迁移与发布文件不一致，已拒绝继续。请维护者核对迁移历史，保留数据库和校验保护。',
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
  pnpm_unavailable:
    '未找到 pnpm 启动入口，请通过 pnpm start:online 启动，或配置 UPDATE_PNPM_CLI 后重启。',
  timeout: '命令执行超时，请检查网络、磁盘和构建负载后重试。',
  history_diverged:
    '当前版本不在发布分支的历史中，已阻止自动切换；请维护者核对部署版本与发布分支。',
  drain_timeout: '在途请求未在 30 秒内结束，已取消切换并恢复接收请求；请稍后重试。',
  readiness: 'API 退出或未通过就绪检查，请检查服务日志、端口、数据库连接和游戏版本。',
  recovery_failed: '更新失败且旧服务恢复失败，需要维护者立即检查 API 日志和 /health/ready。',
  unknown: '此步骤发生未分类错误，请按下方时间检查更新器和 API 日志。',
};

const titles: Record<AdminUpdateStatus['phase'], string> = {
  unavailable: '先接通在线更新',
  disabled: '自动更新已停用',
  idle: '随时可以检查更新',
  checking: '正在检查新版本',
  building: '正在准备新版本',
  current: '已是最新版本',
  waiting: '新版已准备，等待安全切换',
  maintenance: '新版需要维护者处理',
  applying: '正在更新服务',
  updated: '更新成功',
  failed: '本次更新未完成',
};
const descriptions: Record<AdminUpdateStatus['phase'], string> = {
  unavailable: '当前启动方式没有连接在线更新器。完成一次配置后，就能在这里更新。',
  disabled: '服务器配置关闭了检查和更新。如需恢复，请由维护者启用后重启更新器。',
  idle: '发现发布分支的新提交后，会自动构建、备份并更新。也可以立即检查。',
  checking: '正在连接发布仓库。检查完成后，有新版本会继续自动更新。',
  building: '服务仍在运行。准备完成后，将自动备份并切换版本。',
  current: '服务器已运行发布分支的最新提交。',
  waiting: '等待已接收的请求完成，随后自动备份并切换。对局进度会保留。',
  maintenance: '部署配置要求人工处理数据库迁移。请安排维护后更新，不要反复点击重试。',
  applying: '连接可能短暂中断，这里会自动重连并确认结果。无需重复操作。',
  updated: '服务器已通过就绪检查。刷新此页面即可加载当前版本的界面。',
  failed: '请先查看失败原因。处理完成后，可重新检查并更新。',
};
const steps = ['检查版本', '准备新版', '备份与更新', '验证服务'];
function activeStep(status: AdminUpdateStatus) {
  if (status.phase === 'updated') return 4;
  if (status.stage) {
    if (['start', 'persist'].includes(status.stage)) return 3;
    if (['drain', 'stop', 'backup', 'migrate', 'sync'].includes(status.stage)) return 2;
    if (['checkout', 'install', 'build'].includes(status.stage)) return 1;
  }
  return (
    { checking: 0, building: 1, waiting: 2, maintenance: 2, applying: 2 } as Partial<
      Record<AdminUpdateStatus['phase'], number>
    >
  )[status.phase];
}
function date(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚无记录';
}
function UpdateProgress({ status }: { status: AdminUpdateStatus }) {
  const active = activeStep(status);
  if (active === undefined || status.phase === 'failed' || status.phase === 'current') return null;
  return (
    <ol className="admin-update-progress" aria-label="更新步骤">
      {steps.map((label, index) => (
        <li
          key={label}
          data-state={index < active ? 'complete' : index === active ? 'active' : 'pending'}
          aria-current={index === active ? 'step' : undefined}
        >
          <span className="admin-update-step-number" aria-hidden="true">
            {index < active ? '✓' : index + 1}
          </span>
          <span>{label}</span>
          <small>
            {index < active
              ? '已完成'
              : index === active
                ? status.phase === 'maintenance'
                  ? '待处理'
                  : '进行中'
                : '待开始'}
          </small>
        </li>
      ))}
    </ol>
  );
}
function SetupHelp({ disabled }: { disabled: boolean }) {
  return (
    <section className="admin-update-help" aria-label="更新配置指引">
      <h3>{disabled ? '恢复在线更新' : '只需配置一次'}</h3>
      {disabled ? (
        <p>
          维护者在现有部署配置中将 <code>UPDATE_ENABLED</code> 设为 <code>true</code>
          ，再重启更新托管进程。
        </p>
      ) : (
        <ol>
          <li>
            如果使用 <code>deploy.sh</code>{' '}
            部署，按配置指南接入在线更新托管，并让网站全部请求转发到更新器。
          </li>
          <li>
            如果手动部署，完成首次构建后使用 <code>pnpm start:online</code> 启动，并由系统服务托管。
          </li>
          <li>已有更新器但仍不可用时，需要同时加载新版 API 和更新脚本，再重启托管进程。</li>
        </ol>
      )}
      <a href="/developers/online-update">查看完整配置与恢复指南 →</a>
    </section>
  );
}

function UpdatePanel() {
  const { status, readError, commandError, sending, disconnected, check, reload } =
    useAdminUpdates();
  const [copied, setCopied] = useState('');
  const busy = !!status && updateWorking.has(status.phase);
  const expectedDisconnect = disconnected && busy;
  const failure = status?.phase === 'failed' ? status.failure : null;
  const failureStage =
    status?.stage === 'backup' && failure?.stage === 'migrate' ? 'backup' : failure?.stage;
  const diagnostics = status
    ? [
        'PlayBoard 服务更新诊断',
        `状态：${titles[status.phase]}`,
        `发布分支：${status.branch ?? '未知'}`,
        `运行版本：${status.currentVersion ?? '未知'} (${status.currentSha ?? '未知'})`,
        `目标版本：${status.candidateVersion ?? '未知'} (${status.candidateSha ?? '无'})`,
        `最近检查：${status.lastCheckedAt ?? '无'}`,
        ...(failure
          ? [
              `失败步骤：${failureStage ? failureStages[failureStage] : '未知'}`,
              `原因代码：${failure.reason}`,
              `退出码：${failure.exitCode ?? '无'}`,
              `失败时间：${failure.occurredAt}`,
            ]
          : []),
      ].join('\n')
    : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied('诊断已复制');
    } catch {
      setCopied('复制失败，请选中诊断信息手动复制。');
    }
  }
  return (
    <section className="admin-update-section" aria-label="服务更新">
      <div
        className="admin-update-summary"
        data-tone={
          status?.phase === 'failed'
            ? 'error'
            : status?.phase === 'updated' || status?.phase === 'current'
              ? 'success'
              : 'normal'
        }
      >
        <p className="eyebrow">服务器版本</p>
        <div className="admin-update-version">
          <strong>
            {status?.currentVersion
              ? `v${status.currentVersion}`
              : status
                ? '版本信息未提供'
                : '读取中…'}
          </strong>
          {status?.candidateVersion && <span>→ v{status.candidateVersion}</span>}
        </div>
        <div role="status" aria-live="polite" className="admin-update-status">
          <h2>
            {status
              ? titles[status.phase]
              : readError
                ? '暂时无法读取更新状态'
                : '正在连接更新服务'}
          </h2>
          <p>
            {expectedDisconnect
              ? '正在恢复连接，更新结果尚未确认。连接恢复后会自动显示最新状态。'
              : status
                ? descriptions[status.phase]
                : '连接后会显示服务器的真实版本和更新状态。'}
          </p>
        </div>
        <div className="admin-update-actions">
          {status && !['unavailable', 'disabled', 'maintenance'].includes(status.phase) && (
            <Button
              onClick={() => {
                void check();
              }}
              disabled={!status.enabled || sending || busy || disconnected}
            >
              {sending
                ? '正在提交…'
                : busy
                  ? '更新进行中…'
                  : commandError
                    ? '确认原更新请求'
                    : status.phase === 'failed'
                      ? '重试更新'
                      : '检查并更新'}
            </Button>
          )}
          {status?.phase === 'maintenance' && (
            <a className="button-link" href="/developers/online-update">
              查看维护指引
            </a>
          )}
          {status?.phase === 'updated' && !disconnected && (
            <Button className="secondary" onClick={() => window.location.reload()}>
              刷新使用新版
            </Button>
          )}
          {(!status ||
            disconnected ||
            status.phase === 'unavailable' ||
            status.phase === 'disabled') && (
            <Button className="secondary" onClick={reload}>
              重新读取状态
            </Button>
          )}
        </div>
        {status?.enabled && (
          <p className="muted admin-update-caption">
            {status.checkIntervalMs
              ? `每 ${Number((status.checkIntervalMs / 60000).toFixed(2))} 分钟自动检查`
              : '自动检查已启用'}
            {` · 最近检查：${status.lastCheckedAt ? date(status.lastCheckedAt) : '尚未检查'}`}
          </p>
        )}
      </div>

      {commandError && (
        <ErrorNotice>
          <strong>更新请求尚未确认</strong>
          <p>{commandError}</p>
          <p>状态会继续同步。再次确认时沿用原请求编号，避免重复启动更新。</p>
        </ErrorNotice>
      )}
      {readError && !expectedDisconnect && (
        <ErrorNotice>
          {readError}
          <p>页面会自动尝试恢复连接，也可以重新读取状态。</p>
        </ErrorNotice>
      )}
      {status && <UpdateProgress status={status} />}
      {busy && status?.stage && !disconnected && (
        <p className="admin-update-live-step">
          <strong>当前步骤：{failureStages[status.stage]}</strong>
          <span className="muted">开始于 {date(status.stageStartedAt)}</span>
        </p>
      )}
      {status?.phase === 'waiting' && (
        <p className="muted">
          等待在途请求最多 30 秒，超时会取消切换并恢复接收请求。未结束的对局不会阻塞更新。
        </p>
      )}
      {status?.phase === 'failed' && (
        <section className="admin-update-failure" role="alert">
          <h3>
            {failureStage ? `失败步骤：${failureStages[failureStage]}` : '更新器未提供失败详情'}
          </h3>
          <p>
            {failure
              ? failureReasons[failure.reason]
              : '请维护者升级并重启更新托管进程，才能获取具体失败原因。'}
          </p>
          {failure && (
            <p className="muted">
              {date(failure.occurredAt)}
              {failure.exitCode !== null && ` · 退出码：${failure.exitCode}`}
            </p>
          )}
          <p className="muted">
            更新器会尝试恢复原服务；代码恢复不会回退数据库。服务是否可用请结合就绪检查和日志确认。
          </p>
        </section>
      )}
      {status && ['unavailable', 'disabled'].includes(status.phase) && (
        <SetupHelp disabled={status.phase === 'disabled'} />
      )}
      {status && status.phase !== 'unavailable' && (
        <details className="admin-update-technical">
          <summary>版本详情与诊断</summary>
          <dl className="admin-update-details">
            <div>
              <dt>发布分支</dt>
              <dd>{status.branch ?? '未提供'}</dd>
            </div>
            <div>
              <dt>运行提交</dt>
              <dd>
                <code>{status.currentSha?.slice(0, 12) ?? '未提供'}</code>
              </dd>
            </div>
            {status.candidateSha && (
              <div>
                <dt>目标提交</dt>
                <dd>
                  <code>{status.candidateSha.slice(0, 12)}</code>
                </dd>
              </div>
            )}
            {failure && (
              <div>
                <dt>原因代码</dt>
                <dd>
                  <code>{failure.reason}</code>
                </dd>
              </div>
            )}
          </dl>
          <div className="admin-update-diagnostic">
            <label htmlFor="update-diagnostics">诊断信息</label>
            <textarea id="update-diagnostics" readOnly rows={7} value={diagnostics} />
          </div>
          <Button
            className="secondary"
            onClick={() => {
              void copy();
            }}
          >
            复制诊断信息
          </Button>
          <p role="status">{copied}</p>
        </details>
      )}
      {status?.enabled && (
        <p className="muted admin-update-footnote">
          更新前自动备份数据库和资源。切换会短暂断开连接，对局进度保留；玩家页面不会自动刷新。
        </p>
      )}
    </section>
  );
}

export function AdminUpdatesPage() {
  return (
    <AdminLayout
      path="/admin/updates"
      title="服务更新"
      description="检查新版本、跟踪更新进度，遇到问题也知道下一步。"
    >
      <UpdatePanel />
    </AdminLayout>
  );
}
