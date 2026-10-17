import { test, expect } from './fixtures.js';

test('the model settings shortcut creates a mock profile without opening provider recommendations', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goto('/settings/models');
  const presets = page.locator('details.model-presets-bar');
  await expect(presets).not.toHaveAttribute('open');
  await page.getByRole('button', { name: '配置内置模拟', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '配置名称', exact: true })).toBeFocused();
  await expect(page.getByRole('combobox', { name: /服务端点/ })).toHaveValue('mock');
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('mock-v1');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('.model-cards-list .model-profile')).toHaveCount(1);
  const filters = page.getByRole('group', { name: '状态过滤' });
  await filters.getByRole('button', { name: '沙盒模拟' }).click();
  await expect(filters.getByRole('button', { name: '沙盒模拟' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('searchbox', { name: '搜索配置' }).fill('没有这个模型');
  await expect(page.getByRole('searchbox', { name: '搜索配置' })).toHaveCSS('padding-left', '40px');
  expect(
    (await page.getByRole('button', { name: '清除搜索', exact: true }).boundingBox())!.width,
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: '重置筛选与搜索', exact: true }).click();
  await expect(page.locator('.model-cards-list .model-profile')).toHaveCount(1);
  await expect(presets).not.toHaveAttribute('open');
  await page.screenshot({ path: info.outputPath('compact-model-settings.png'), fullPage: true });
});
