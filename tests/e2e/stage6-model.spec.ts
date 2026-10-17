import { openRoomCreation } from './fixtures.js';
import { expect, test } from './fixtures.js';

test('model settings save and test an explicitly labelled mock profile', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/login');
  await page.getByLabel('用户名').fill(test.info().project.name === 'mobile' ? 'stage3_b' : 'stage3_a');
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await page.goto('/settings/models');
  await expect(page.getByRole('heading', { name: '模型配置', exact: true })).toBeVisible();
  await expect(page.locator('.provider-presets-section, .model-metrics-grid')).toHaveCount(0);
  await expect(page.getByText('高级设置', { exact: true })).toBeVisible();
  await expect(page.getByLabel('采样温度')).toBeHidden();
  await page.getByLabel('配置名称').fill('浏览器模拟配置');
  await page.getByLabel('服务端点').selectOption('mock');
  await page.getByLabel('模型标识').fill('mock-v1');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('heading', { name: '浏览器模拟配置', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('未配置凭证')).toBeVisible();
  await expect(page.locator('input[name="apiKey"]')).toHaveValue('');
  await page.getByRole('button', { name: '测试连接' }).last().click();
  await expect(page.getByText('模拟连接测试通过')).toBeVisible();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '浏览器模拟配置', exact: true }) });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('配置名称')).toHaveValue('浏览器模拟配置');
  await page.getByLabel('配置名称').fill('已修改模拟配置');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已修改模拟配置', exact: true })).toBeVisible();
  await page.reload();
  const updated = page.locator('article').filter({ has: page.getByRole('heading', { name: '已修改模拟配置', exact: true }) });
  await expect(updated.getByText('mock-v1 · 版本 2')).toBeVisible();
  if ((await updated.locator('details').getAttribute('open')) === null) {
    await updated.getByText('更多', { exact: true }).click();
  }
  await updated.getByRole('button', { name: '删除', exact: true }).click();
  await updated.getByRole('button', { name: '取消删除', exact: true }).click();
  await expect(updated).toBeVisible();
  if ((await updated.locator('details').getAttribute('open')) === null) {
    await updated.getByText('更多', { exact: true }).click();
  }
  await updated.getByRole('button', { name: '删除', exact: true }).click();
  await updated.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(updated).toHaveCount(0);
  await page.getByLabel('配置名称').fill('浏览器模拟配置');
  await page.getByLabel('服务端点').selectOption('mock');
  await page.getByLabel('模型标识').fill('mock-v1');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '浏览器模拟配置', exact: true })).toBeVisible();
  await page.getByText('高级设置', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('采样温度')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('采样温度')).toBeHidden();
  for (const width of (test.info().project.name === 'mobile' ? [390, 320] : [1440, 1280])) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.waitForTimeout(250); // Allow theme color transitions to settle before visual inspection.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`model-settings-${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.getByRole('link', { name: '游戏大厅', exact: true }).click();
  await openRoomCreation(page);
  await page.getByLabel('游戏与版本').selectOption('color-match@1.0.0');
  await page.getByLabel('房间名').fill(`模型托管 ${test.info().project.name}`);
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page.getByRole('heading', { name: /模型托管/ })).toBeVisible();
  await page.getByRole('button', { name: '添加脚本 AI' }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect(page.getByRole('heading', { name: 'Color Match', exact: true })).toBeVisible();
  await page.locator('.controller-panel summary').click();
  await page.getByRole('button', { name: '启用模型 · 浏览器模拟配置' }).last().click();
  await expect(page.getByText(/座位 1 · 模型 AI/)).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/rooms\//, { timeout: 60000 });
  await page.getByRole('link', { name: '查看本局结果' }).click();
  await expect(page.locator('.page-heading').getByText(/已结束/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('model settings preserve keys on edit, show actionable failures and allow credential replacement', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage2_c');
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await page.goto('/settings/models');
  await page.getByLabel('配置名称').fill('自定义服务编辑测试');
  await page.getByLabel('服务端点').selectOption('custom');
  await page.getByLabel('Base URL（HTTPS）').fill('https://8.8.8.8/v1');
  await page.getByLabel('模型标识').fill('example-model');
  await page.getByLabel('API key', { exact: false }).fill('fake-e2e-original-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '自定义服务编辑测试', exact: true }) });
  await expect(card.getByText('凭证已配置', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('Base URL（HTTPS）')).toHaveValue('https://8.8.8.8/v1');
  await expect(page.getByLabel('API key', { exact: false })).toHaveValue('');
  await page.getByLabel('模型标识').fill('updated-model');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(card.getByText('updated-model · 版本 2')).toBeVisible();
  await expect(card.getByText('凭证已配置', { exact: true })).toBeVisible();
  // UI error placement only: no real provider calls or user credentials are used here.
  await page.route('**/me/model-profiles/*/test', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: { code: 'AI_PROVIDER_FAILED', message: 'API key 无效或已过期（HTTP 401），请编辑配置并更新密钥', retryable: false }, traceId: 'e2e' }) }));
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(card.getByRole('alert')).toContainText('API key 无效');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('API key', { exact: false }).fill('fake-e2e-replacement-key');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(card.getByText('updated-model · 版本 3')).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await card.getByText('更多', { exact: true }).click();
  await card.getByRole('button', { name: '撤销凭证' }).click();
  await expect(card.getByText('未配置凭证，请编辑并填写 API key')).toBeVisible();
  await expect(card.getByRole('button', { name: '测试连接' })).toBeDisabled();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('API key', { exact: false }).fill('fake-e2e-restored-key');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(card.getByText('updated-model · 版本 4')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('model-settings-custom.png'), fullPage: true });
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await card.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
});
