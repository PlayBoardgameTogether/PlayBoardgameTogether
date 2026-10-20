import { test, expect } from '@playwright/test';

test('real administrator reads update setup while ordinary accounts are denied', async ({
  page,
}, info) => {
  async function login(username: string) {
    await page.goto('/login');
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill('stage two password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  }
  await login('stage7_admin');
  await page.goto('/admin/updates');
  await expect(page.getByRole('heading', { name: '先接通在线更新', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '更新配置指引' })).toContainText('deploy.sh');
  await page.getByRole('button', { name: '重新读取状态', exact: true }).click();
  await expect(page.getByRole('region', { name: '更新配置指引' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('real-updates-setup.png'), fullPage: true });
  await page.getByRole('link', { name: '查看完整配置与恢复指南 →' }).click();
  await expect(page.getByRole('heading', { name: '在线更新与恢复', exact: true })).toBeVisible();
  // A new browser session proves the ordinary-account boundary without mocks.
  await page.context().clearCookies();
  await login('stage2_a');
  await page.goto('/admin/updates');
  await expect(page.getByText('需要管理员权限', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/updates')).status()).toBe(403);
});
