import { sessionFixture } from '../fixtures/session.js';
import { test, expect } from '@playwright/test';

test('administrator can request an update and distinguish waiting, maintenance and completion', async ({ page }, info) => {
  const state = { enabled: true, branch: 'main', currentSha: 'a'.repeat(40), candidateSha: null as string | null,
    lastCheckedAt: null as string | null, phase: 'idle' };
  let commands = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (path === '/api/v1/admin/updates') data = { ...state };
    else if (path === '/api/v1/admin/updates/check') {
      commands++;
      expect(route.request().method()).toBe('POST');
      expect(Object.keys(route.request().postDataJSON())).toEqual(['requestId']);
      Object.assign(state, { phase: 'building', candidateSha: 'b'.repeat(40), lastCheckedAt: new Date().toISOString() });
      data = { ...state };
    } else { await route.abort(); return; }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui-test' } });
  });
  await page.goto('/admin/updates');
  await expect(page.getByRole('heading', { name: '服务更新', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即检测并更新' })).toBeEnabled();
  await page.getByRole('button', { name: '立即检测并更新' }).click();
  await expect(page.getByRole('button', { name: '更新处理中…' })).toBeDisabled();
  expect(commands).toBe(1);
  state.phase = 'waiting';
  await expect(page.getByRole('status')).toContainText('等待已接收的请求完成');
  await expect(page.getByText(/等待在途请求最多 30 秒/)).toBeVisible();
  await expect(page.getByRole('button', { name: '等待安全切换' })).toBeDisabled();
  const progress = page.getByRole('list', { name: '更新步骤' });
  await expect(progress.getByText('安装依赖并构建')).toBeVisible();
  await expect(progress.locator('[data-state="complete"]')).toHaveCount(2);
  await expect(progress.locator('[aria-current="step"]')).toContainText('等待安全切换');
  await expect(page.getByText('构建已完成，尚未切换版本。', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('updates-waiting.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.phase = 'maintenance';
  await expect(page.getByRole('status')).toContainText('需要维护者');
  state.phase = 'updated';
  state.currentSha = 'b'.repeat(40);
  state.candidateSha = null;
  await expect(page.getByRole('status')).toContainText('更新成功');
  await expect(progress.locator('[data-state="complete"]')).toHaveCount(4);
  await expect(progress.locator('[aria-current="step"]')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: '后台导航' });
  expect((await navigation.boundingBox())?.height).toBeLessThan(130);
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await navigation.boundingBox())?.height).toBeLessThan(130);
    await page.screenshot({ path: info.outputPath('updates-320.png'), fullPage: true });
  }
  await page.evaluate(() => { (window as Window & { updateNavigationMarker?: boolean }).updateNavigationMarker = true; });
  await navigation.getByRole('link', { name: '游戏管理', exact: true }).click();
  await navigation.getByRole('link', { name: '服务更新', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { updateNavigationMarker?: boolean }).updateNavigationMarker)).toBe(true);
});

test('unavailable supervisors disable the button and ordinary users cannot see controls', async ({ page }) => {
  let role: 'administrator' | 'user' = 'administrator';
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/v1/auth/me' ? sessionFixture({ role }) : {
      enabled: false, branch: null, currentSha: null, candidateSha: null, lastCheckedAt: null, phase: 'unavailable',
    };
    await route.fulfill({ json: { ok: true, data, traceId: 'ui-test' } });
  });
  await page.goto('/admin/updates');
  await expect(page.getByRole('button', { name: '立即检测并更新' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('未启用在线更新托管');
  role = 'user';
  await page.reload();
  await expect(page.getByText('需要管理员权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即检测并更新' })).toHaveCount(0);
});
