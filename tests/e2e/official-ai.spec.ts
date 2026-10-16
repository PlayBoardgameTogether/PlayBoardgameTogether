import { test, expect, openRoomCreation, type Page } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
}

test('administrator publishes and grants points; player enrolls and authorizes an official AI seat', async ({
  page,
}) => {
  await login(page, 'stage7_admin');
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  // Test-only credential: this flow stops before dispatching any external request.
  const source = await page.request.post('/api/v1/me/model-profiles', {
    headers: { origin: 'http://127.0.0.1:5273', 'x-csrf-token': me.csrfToken },
    data: {
      name: '官方模型测试来源',
      endpointId: 'openai',
      modelId: 'fixture-not-dispatched',
      apiKey: 'fixture-official-api-key',
    },
  });
  expect(source.ok()).toBe(true);
  await page.goto('/admin/official-ai');
  await expect(page.getByRole('heading', { name: '官方 AI 与点数', exact: true })).toBeVisible();
  await page.getByLabel('来源模型配置').selectOption((await source.json()).data.id);
  await page.getByLabel('玩家可见名称').fill('标准陪玩');
  await page.getByLabel('每次成功行动扣点').fill('2');
  await page.getByRole('button', { name: '发布官方 AI', exact: true }).click();
  await expect(page.locator('.ai-ledger')).toContainText('标准陪玩');
  await page.getByLabel('搜索玩家').fill('stage3_a');
  await page.getByRole('button', { name: '搜索账户', exact: true }).click();
  await expect(page.getByLabel('收取点数的玩家')).toContainText('stage3_a');
  await page.getByLabel('收取点数的玩家').selectOption({ label: '玩家 D · @stage3_a' });
  await page.getByLabel('发放点数', { exact: true }).fill('100');
  let lost = false;
  let originalGrant: string | null = null;
  await page.route('**/api/v1/admin/ai-points/grant', async (route) => {
    if (!lost) {
      originalGrant = route.request().postData();
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      lost = true;
      await route.abort('failed');
    } else {
      expect(route.request().postData()).toBe(originalGrant);
      await route.continue();
    }
  });
  await page.getByRole('button', { name: '发放点数', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次未确认操作' })).toBeVisible();
  await expect(page.getByLabel('发放点数', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试上次未确认操作' }).click();
  await expect(page.getByRole('status')).toContainText('点数已发放');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('official-ai-admin.png'), fullPage: true });
  await page.request.post('/api/v1/auth/logout', {
    headers: { origin: 'http://127.0.0.1:5273', 'x-csrf-token': me.csrfToken },
  });
  await login(page, 'stage3_a');
  await page.goto('/official-ai');
  await expect(page.locator('.ai-wallet strong')).toHaveText('100');
  await page.getByLabel('每席位单局上限（点）').fill('20');
  await page.getByRole('button', { name: '启用此官方 AI' }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await expect(page.getByText('已启用 · 当前上限 20 点')).toBeVisible();
  await expect(page.locator('.ai-ledger')).toContainText('+100 点');
  await expect(page.getByRole('link', { name: '自带模型配置' })).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('official-ai-player-light.png'),
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.screenshot({
    path: test.info().outputPath('official-ai-player-dark.png'),
    fullPage: true,
  });
  await page.goto('/');
  await openRoomCreation(page);
  await page.getByLabel('房间名').fill('官方 AI 点数桌');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  const empty = page.locator('.seat-card').nth(1);
  await empty.getByText('选择模型 AI', { exact: true }).click();
  await expect(empty.getByLabel('模型配置')).toContainText('官方 AI · 标准陪玩 · 2 点/行动');
  await expect(empty).toContainText('此席位单局上限 20 点');
  await empty.getByRole('button', { name: '添加模型 AI', exact: true }).click();
  await expect(empty.getByText('模型 AI · 已就绪', { exact: true })).toBeVisible();
  await page.reload();
  await expect(empty.getByText('模型 AI · 已就绪', { exact: true })).toBeVisible();
  // No external model call occurs until start; scheduler/charging are integration-tested separately.
  const wallet = await (await page.request.get('/api/v1/me/ai-points')).json();
  expect(wallet.data).toEqual({ balance: 100, reserved: 0, available: 100 });
});

test('official AI has real empty states, phone/laptop layouts and denies player administration', async ({
  page,
}) => {
  await login(page, 'stage3_a');
  await page.goto('/official-ai');
  await expect(page.locator('.ai-wallet strong')).toHaveText('0');
  await expect(page.getByText('还没有点数记录。')).toBeVisible();
  await expect(page.getByText(/官方 AI 尚未开放/)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('official-ai-empty-laptop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('official-ai-empty-narrow.png'),
    fullPage: true,
  });
  await page.goto('/admin/official-ai');
  await expect(page.getByRole('heading', { name: '需要管理员权限' })).toBeVisible();
  const forbidden = await page.request.get('/api/v1/admin/official-ai/stats');
  expect(forbidden.status()).toBe(403);
});
