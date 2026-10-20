import { sessionFixture } from '../fixtures/session.js';
import { test, expect } from '@playwright/test';
import type { AdminUpdateStatus } from '../../packages/protocol/src/admin.js';

function fixture(): AdminUpdateStatus {
  return {
    enabled: true,
    branch: 'main',
    currentSha: 'a'.repeat(40),
    candidateSha: null,
    lastCheckedAt: null,
    phase: 'idle',
    failure: null,
    currentVersion: '0.12.0',
    candidateVersion: null,
    stage: null,
    stageStartedAt: null,
    checkIntervalMs: 300000,
  };
}

test('updates show actual server versions, stages, reconnection and actionable failures', async ({
  page,
}, info) => {
  const state = fixture();
  let commands = 0;
  let disconnected = false;
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (path === '/api/v1/admin/updates') {
      if (disconnected) {
        await route.fulfill({ status: 503, body: '' });
        return;
      }
      data = { ...state };
    } else if (path === '/api/v1/admin/updates/check') {
      commands++;
      expect(route.request().method()).toBe('POST');
      expect(Object.keys(route.request().postDataJSON())).toEqual(['requestId']);
      Object.assign(state, {
        phase: 'building',
        stage: 'install',
        candidateSha: 'b'.repeat(40),
        candidateVersion: '0.13.0',
        stageStartedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
      });
      data = { ...state };
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui-test' } });
  });
  await page.goto('/admin/updates');
  const panel = page.getByRole('region', { name: '服务更新', exact: true });
  await expect(panel.getByText('v0.12.0', { exact: true })).toBeVisible();
  await expect(panel.getByText('每 5 分钟自动检查', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '检查并更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '更新进行中…' })).toBeDisabled();
  await expect(panel.getByText('→ v0.13.0')).toBeVisible();
  await expect(panel.getByText('当前步骤：安装构建依赖')).toBeVisible();
  expect(commands).toBe(1);
  const progress = page.getByRole('list', { name: '更新步骤' });
  state.phase = 'waiting';
  state.stage = 'drain';
  await expect(progress.locator('[data-state="complete"]')).toHaveCount(2);
  await expect(panel.getByText(/等待在途请求最多 30 秒/)).toBeVisible();
  disconnected = true;
  await expect(panel.getByRole('status').first()).toContainText('正在恢复连接');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更新进行中…' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('updates-reconnecting.png'), fullPage: true });
  disconnected = false;
  state.phase = 'updated';
  state.stage = null;
  state.currentVersion = '0.13.0';
  state.currentSha = 'b'.repeat(40);
  state.candidateSha = null;
  state.candidateVersion = null;
  await expect(panel.getByRole('heading', { name: '更新成功', exact: true })).toBeVisible();
  await expect(panel.getByText('v0.13.0', { exact: true })).toBeVisible();
  await expect(progress.locator('[data-state="complete"]')).toHaveCount(4);
  await page.getByRole('button', { name: '刷新使用新版' }).click();
  await expect(panel.getByRole('heading', { name: '更新成功', exact: true })).toBeVisible();
  expect(commands).toBe(1);
  state.phase = 'failed';
  state.stage = 'install';
  state.failure = {
    stage: 'install',
    reason: 'network',
    exitCode: 1,
    occurredAt: new Date().toISOString(),
  };
  await expect(panel.getByRole('alert')).toContainText('失败步骤：安装构建依赖');
  await expect(panel.getByRole('alert')).toContainText('网络连接失败');
  await expect(page.getByRole('button', { name: '重试更新', exact: true })).toBeEnabled();
  await panel.getByText('版本详情与诊断', { exact: true }).click();
  await expect(page.getByLabel('诊断信息', { exact: true })).toHaveValue(/原因代码：network/);
  // Clipboard failure provides a selectable fallback instead of hiding diagnostics.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
  );
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click();
  await expect(panel.getByText('复制失败，请选中诊断信息手动复制。')).toBeVisible();
  await page.screenshot({ path: info.outputPath('updates-failure.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ path: info.outputPath('updates-dark.png'), fullPage: true });
  for (const width of info.project.name === 'mobile' ? [390, 320] : [1440, 1280]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: '重试更新', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`updates-${width}.png`), fullPage: true });
  }
});

test('lost command replies retain request identity even after successful polling', async ({
  page,
}) => {
  const state = fixture();
  const ids: string[] = [];
  let readsAfterCommand = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill({
        json: { ok: true, data: sessionFixture({ role: 'administrator' }), traceId: 'ui-test' },
      });
      return;
    }
    if (path === '/api/v1/admin/updates/check') {
      ids.push(route.request().postDataJSON().requestId);
      if (ids.length === 1) {
        await route.abort();
        return;
      }
      state.phase = 'current';
    } else if (path === '/api/v1/admin/updates' && ids.length) readsAfterCommand++;
    await route.fulfill({ json: { ok: true, data: { ...state }, traceId: 'ui-test' } });
  });
  await page.goto('/admin/updates');
  const check = page.getByRole('button', { name: '检查并更新', exact: true });
  await check.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('更新请求尚未确认');
  await expect.poll(() => readsAfterCommand).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toContainText('更新请求尚未确认');
  await page.getByRole('button', { name: '确认原更新请求', exact: true }).click();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '已是最新版本', exact: true })).toBeVisible();
});

test('unavailable and disabled installations explain setup, and users cannot see controls', async ({
  page,
}, info) => {
  let role: 'administrator' | 'user' = 'administrator';
  const state = {
    ...fixture(),
    enabled: false,
    phase: 'unavailable' as AdminUpdateStatus['phase'],
  };
  let commands = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/check')) commands++;
    const data = path === '/api/v1/auth/me' ? sessionFixture({ role }) : { ...state };
    await route.fulfill({ json: { ok: true, data, traceId: 'ui-test' } });
  });
  await page.goto('/admin/updates');
  await expect(page.getByRole('heading', { name: '先接通在线更新', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查并更新', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重新读取状态', exact: true }).click();
  expect(commands).toBe(0);
  await page.screenshot({ path: info.outputPath('updates-setup.png'), fullPage: true });
  await page.getByRole('link', { name: '查看完整配置与恢复指南 →' }).click();
  await expect(page.getByRole('heading', { name: '在线更新与恢复', exact: true })).toBeVisible();
  await page.goto('/admin/updates');
  state.phase = 'disabled';
  await expect(page.getByRole('heading', { name: '自动更新已停用', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '更新配置指引' })).toContainText('UPDATE_ENABLED');
  role = 'user';
  await page.reload();
  await expect(page.getByText('需要管理员权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '服务更新', exact: true })).toHaveCount(0);
});

test('legacy status has an honest version fallback and maintenance leads to guidance', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/v1/auth/me'
        ? sessionFixture({ role: 'administrator' })
        : {
            enabled: true,
            branch: 'main',
            currentSha: 'a'.repeat(40),
            candidateSha: 'b'.repeat(40),
            lastCheckedAt: new Date().toISOString(),
            phase: 'maintenance',
          };
    await route.fulfill({ json: { ok: true, data, traceId: 'legacy-test' } });
  });
  await page.goto('/admin/updates');
  const panel = page.getByRole('region', { name: '服务更新', exact: true });
  await expect(panel.getByText('版本信息未提供', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: '查看维护指引' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '检查并更新', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: '更新步骤' }).locator('[data-state="complete"]'),
  ).toHaveCount(2);
});
