import { test, expect, type Page } from './fixtures.js';
import { z } from 'zod';

async function expectInstalledCatalog(page: Page) {
  const response = await page.request.get('/api/v1/games');
  expect(response.ok()).toBe(true);
  const { data } = z
    .object({
      ok: z.literal(true),
      data: z.array(
        z.object({ id: z.string(), version: z.string(), developmentOnly: z.boolean() }),
      ),
    })
    .parse(await response.json());
  const playable = data.filter((game) => !game.developmentOnly);
  await expect(page.locator('a.game-card')).toHaveCount(playable.length);
  for (const game of playable)
    await expect(page.locator(`a.game-card[href="/games/${game.id}/${game.version}"]`)).toHaveCount(
      1,
    );
}

test('catalog opens details, preserves selected game and supports history and reload', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '创建房间', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('12 位邀请码')).toHaveCount(0);
  await expectInstalledCatalog(page);
  await page.evaluate(() => {
    document.body.dataset.catalogMarker = 'same-document';
  });
  await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true });
  const splendor = page.locator('a.game-card[href="/games/splendor.base/1.0.0"]');
  await splendor.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '璀璨宝石', exact: true })).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('heading', { name: '公开房间', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加入房间', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('筛选游戏')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('detail.png'), fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: '创建房间', exact: true }).click();
  await expect(page.getByLabel('游戏与版本')).toHaveValue('splendor.base@1.0.0');
  await expect(page.getByLabel('人数', { exact: true })).toHaveValue('2');
  expect(await page.evaluate(() => document.body.dataset.catalogMarker)).toBe('same-document');
  await page.reload();
  await expect(page.getByLabel('游戏与版本')).toHaveValue('splendor.base@1.0.0');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '璀璨宝石', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '璀璨宝石', exact: true })).toBeVisible();
  await page.goto('/games/splendor.base/9.9.9/new');
  await expect(page.getByRole('alert')).toContainText('所选游戏或版本已不可用');
  await expect(page.getByRole('button', { name: '创建并生成邀请码' })).toBeDisabled();
});

test('guest can browse games and catalog failures offer retry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.locator('a.game-card[href="/games/grid-garden/1.0.0"]').click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Grid Garden', exact: true })).toBeVisible();
  await expect(page.getByText('登录后查看并加入公开房间。')).toBeVisible();
  await page.goto('/games/missing/1.0.0');
  await expect(page.getByRole('heading', { name: '游戏暂不可用' })).toBeVisible();
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'temporary', retryable: true },
        traceId: 'catalog',
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '游戏加载失败' })).toBeVisible();
  await page.unroute('**/api/v1/games');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expectInstalledCatalog(page);
});
