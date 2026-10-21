import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username = 'stage7_admin') {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('administrator overview and account lifecycle work on desktop and mobile', async ({
  page,
}, info) => {
  await login(page);
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '管理员后台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '管理员后台', exact: true })).toBeVisible();
  await expect(page.getByLabel('平台统计')).toContainText('账户');
  await page.getByRole('link', { name: '账户管理', exact: true }).click();
  await page.getByLabel('搜索账户').fill('stage3_a');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const record = page.getByRole('article', { name: 'stage3_a', exact: true });
  await expect(record).toContainText('已启用');
  const navigation = await page.getByLabel('后台导航').boundingBox();
  if (info.project.name === 'mobile') expect(navigation?.height).toBeLessThan(80);
  else expect(navigation?.width).toBeLessThan(220);
  page.on('dialog', (dialog) => dialog.accept());
  await record.getByRole('button', { name: '停用账户' }).click();
  await expect(record).toContainText('已停用');
  await page.reload();
  await page.getByLabel('搜索账户').fill('stage3_a');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(record).toContainText('已停用');
  await record.getByRole('button', { name: '启用账户' }).click();
  await expect(record).toContainText('已启用');
  await page.screenshot({
    path: info.outputPath('admin-accounts.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('administrator downlists and relists a game without breaking catalog readiness', async ({
  page,
}, info) => {
  await login(page);
  await expect(page.locator('a.game-card[href="/games/color-match/1.0.0"]')).toBeVisible();
  const initialGames = await page.locator('a.game-card').count();
  await page.goto('/admin/catalog');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Color Match color-match', exact: false }).click();
  const record = page.getByRole('article', {
    name: 'Color Match 1.0.0',
    exact: true,
  });
  await expect(record).toContainText('已上架');
  const navigation = await page.getByLabel('后台导航').boundingBox();
  if (info.project.name === 'mobile') expect(navigation?.height).toBeLessThan(80);
  else expect(navigation?.width).toBeLessThan(220);
  page.on('dialog', (dialog) => dialog.accept());
  await record.getByRole('button', { name: '下架版本' }).click();
  await expect(record).toContainText('已下架');
  await page.goto('/');
  await expect(page.locator('a.game-card')).toHaveCount(initialGames - 1);
  await expect(page.locator('a.game-card[href="/games/color-match/1.0.0"]')).toHaveCount(0);
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: 'Color Match color-match', exact: false }).click();
  await record.getByRole('button', { name: '上架版本' }).click();
  await expect(record).toContainText('已上架');
  await page.screenshot({
    path: info.outputPath('admin-games.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/');
  await expect(page.locator('a.game-card')).toHaveCount(initialGames);
});

test('administrator reviews real submissions and preserves review notes after reload', async ({
  page,
}, info) => {
  await login(page, 'stage3_a');
  const me = await page.request.get('/api/v1/auth/me');
  const csrf = (await me.json()).data.csrfToken;
  const submission = await page.request.post('/api/v1/game-submissions', {
    headers: { origin: 'http://127.0.0.1:5273', 'x-csrf-token': csrf },
    data: {
      requestId: randomUUID(),
      gameId: 'test-board',
      version: '1.0.0',
      name: '测试棋盘',
      description: '两人交替放置棋子',
      repositoryUrl: 'https://github.com/example/test-board',
    },
  });
  expect(submission.status()).toBe(200);
  await login(page);
  await page.goto('/admin/submissions');
  await expect(page.getByRole('heading', { name: '测试棋盘 1.0.0' })).toBeVisible();
  await page.getByLabel('审核意见').fill('资料已审阅，等待可信代码部署。');
  await page.getByRole('button', { name: '保存审核结果' }).click();
  await expect(page.getByRole('status')).toContainText('资料已审阅');
  await page.reload();
  await expect(
    page.getByText('审核意见：资料已审阅，等待可信代码部署。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '保存审核结果' })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('admin-submissions.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ordinary players cannot access administrator controls', async ({ page }) => {
  await login(page, 'stage3_a');
  for (const path of [
    '/admin',
    '/admin/accounts',
    '/admin/catalog',
    '/admin/submissions',
    '/admin/games',
    '/admin/assets',
    '/admin/updates',
  ]) {
    await page.goto(path);
    await expect(page.getByText('请使用管理员账户登录后访问后台。')).toBeVisible();
    await expect(page.getByLabel('后台导航')).toHaveCount(0);
  }
});

test('administrator update page reports that the standalone test API has no supervisor', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/admin/updates');
  await expect(page.getByRole('heading', { name: '先接通在线更新', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取状态' })).toBeEnabled();
  const navigation = await page.getByLabel('后台导航').boundingBox();
  if (info.project.name === 'mobile') expect(navigation?.height).toBeLessThan(80);
  else expect(navigation?.width).toBeLessThan(220);
});
