import { test, expect } from '@playwright/test';
import { sessionFixture } from '../fixtures/session.js';
import type { GameSubscription } from '@boardgame/protocol';

test('subscription retains an unknown save request and shows independent controls without mobile overflow', async ({
  page,
}, info) => {
  let value: GameSubscription = {
    source: 'playboard-official',
    autoAdd: false,
    autoUpdate: false,
    revision: 0,
    intervalMinutes: 60,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    nextCheckAt: null,
    message: '',
    items: [],
  };
  let firstId: string | undefined;
  let writes = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me')
      return route.fulfill({
        json: { ok: true, data: sessionFixture({ role: 'administrator' }), traceId: 'ui' },
      });
    if (path === '/api/v1/admin/games')
      return route.fulfill({ json: { ok: true, data: [], traceId: 'ui' } });
    if (path !== '/api/v1/admin/game-subscription') return route.abort();
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      writes++;
      if (writes === 1) {
        firstId = input.requestId;
        value = { ...value, autoAdd: true, revision: 1 };
        return route.abort();
      }
      expect(input.requestId).toBe(firstId);
      expect(input.expectedRevision).toBe(0);
      expect(input.autoUpdate).toBe(false);
    }
    return route.fulfill({ json: { ok: true, data: value, traceId: 'ui' } });
  });
  await page.goto('/admin/catalog');
  await page.getByText('官方游戏订阅', { exact: true }).click();
  await page.getByLabel('自动添加新游戏', { exact: true }).check();
  await page.getByRole('button', { name: '保存订阅', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请求结果尚未确认');
  await expect(page.getByLabel('自动添加新游戏', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '确认原保存请求', exact: true }).click();
  await expect(
    page.getByText('订阅已保存，后台将自动同步官方游戏。', { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(2);
  await expect(page.getByLabel('自动添加新游戏', { exact: true })).toBeChecked();
  expect(
    await page
      .getByLabel('自动添加新游戏', { exact: true })
      .evaluate((element) => getComputedStyle(element).appearance),
  ).toBe('auto');
  await expect(page.getByLabel('自动更新已安装游戏', { exact: true })).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('subscription-settings.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  value = { ...value, revision: 2, autoAdd: false };
  await expect(
    page.getByText('订阅设置已被其他操作修改，请重新读取设置后再保存。', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: '保存订阅', exact: true })).toBeDisabled();
  expect(writes).toBe(2);
});

test('displays official game sync status metrics and items breakdown', async ({ page }, info) => {
  const value: GameSubscription = {
    source: 'playboard-official',
    autoAdd: true,
    autoUpdate: true,
    revision: 1,
    intervalMinutes: 60,
    status: 'succeeded',
    startedAt: '2026-11-01T02:03:50.000Z',
    finishedAt: '2026-11-01T02:03:58.000Z',
    nextCheckAt: '2026-11-01T03:03:30.000Z',
    message: '官方游戏目录同步完成',
    items: [
      {
        gameId: 'online.uno',
        version: '1.2.0',
        outcome: 'updated',
        message: '新版已上架，旧对局保留原版本',
      },
      {
        gameId: 'online.uno-no-mercy',
        version: '1.0.0',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
      {
        gameId: 'online.gomoku',
        version: '1.0.3',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
      {
        gameId: 'online.rummikub',
        version: '1.0.3',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
      {
        gameId: 'online.catan',
        version: '1.0.1',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
      {
        gameId: 'online.puerto-rico',
        version: '1.0.0',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
      {
        gameId: 'online.awari',
        version: '1.0.0',
        outcome: 'current',
        message: '已安装相同或更高版本',
      },
    ],
  };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me')
      return route.fulfill({
        json: { ok: true, data: sessionFixture({ role: 'administrator' }), traceId: 'ui' },
      });
    if (path === '/api/v1/admin/games')
      return route.fulfill({ json: { ok: true, data: [], traceId: 'ui' } });
    if (path !== '/api/v1/admin/game-subscription') return route.abort();
    return route.fulfill({ json: { ok: true, data: value, traceId: 'ui' } });
  });

  await page.goto('/admin/catalog');
  await page.locator('.game-subscription-summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('同步完成', { exact: true })).toBeVisible();
  await expect(page.getByText('官方游戏目录同步完成', { exact: true })).toBeVisible();
  await page.getByText('同步明细（7）', { exact: true }).click();
  await expect(page.getByText('online.uno · 1.2.0', { exact: true })).toBeVisible();
  await expect(page.getByText('新版已上架，旧对局保留原版本', { exact: true })).toBeVisible();
  // Missing component CSS used to stretch both chevrons across the page.
  const chevrons = page.locator('.game-subscription-chevron, .game-sub-results-chevron');
  await expect(chevrons).toHaveCount(2);
  for (const chevron of await chevrons.all()) {
    const bounds = await chevron.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.width).toBeLessThanOrEqual(24);
    expect(bounds!.height).toBeLessThanOrEqual(24);
  }
  const metrics = await page.locator('.game-sub-metric-tile').all();
  const boxes = await Promise.all(metrics.map((metric) => metric.boundingBox()));
  expect(boxes).toHaveLength(3);
  for (const box of boxes) expect(box).not.toBeNull();
  const wide = page.viewportSize()!.width > 760;
  if (wide) {
    expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThan(2);
  } else {
    expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
    expect(boxes[2]!.y).toBeGreaterThanOrEqual(boxes[1]!.y + boxes[1]!.height);
  }
  await page.screenshot({
    path: info.outputPath('subscription-items-breakdown.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('自动添加新游戏', { exact: true })).toBeChecked();
  await page.screenshot({
    path: info.outputPath('subscription-items-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
