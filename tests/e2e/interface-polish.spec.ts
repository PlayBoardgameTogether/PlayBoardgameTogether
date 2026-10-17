import { test, expect, type Page } from '@playwright/test';
import type { RoomSnapshot } from '@boardgame/protocol';
import { sessionFixture } from '../fixtures/session.js';

function room(index: number): RoomSnapshot {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `参与房间 ${index}`,
    status: 'waiting',
    hostAccountId: sessionFixture().account.id,
    gameId: 'color-match',
    gameVersion: '1.0.0',
    options: {},
    seatCount: 2,
    roomRevision: 1,
    activeMatchId: null,
    assetVersionId: null,
    matchStatus: null,
    visibility: 'private',
    hasPassword: false,
    members: [],
    seats: [],
    permissions: { isHost: true, canConfigure: true, canStart: false },
    startBlockers: [],
  };
}

async function contrast(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      };
      let surface = element;
      while (
        getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)' &&
        surface.parentElement
      )
        surface = surface.parentElement;
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(surface).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
}

test('light-theme reading links remain legible and mobile form controls avoid zoom', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('boardgame.theme', 'light'));
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  expect(await contrast(page, '.developer-article a')).toBeGreaterThanOrEqual(4.5);
  if (info.project.name === 'mobile') {
    for (const width of [320, 390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/register');
      await expect(page.getByLabel('用户 ID', { exact: true })).toHaveCSS('font-size', '16px');
      expect(
        await page
          .getByRole('button', { name: '显示密码', exact: true })
          .evaluate((button) => button.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test('participating-room pagination locks duplicate clicks and merges overlapping pages', async ({
  page,
}) => {
  const envelope = (data: unknown) => ({ ok: true, data, traceId: 'room-pagination' });
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: envelope(sessionFixture()) }),
  );
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route('**/api/v1/rooms*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/v1/rooms') return route.continue();
    if (!url.searchParams.has('cursor'))
      return route.fulfill({ json: envelope({ items: [room(1)], nextCursor: 'next-page' }) });
    reads++;
    await held;
    await route.fulfill({ json: envelope({ items: [room(1), room(2)], nextCursor: null }) });
  });
  try {
    await page.goto('/');
    const more = page.getByRole('button', { name: '加载更多参与房间', exact: true });
    await more.click();
    await expect(page.getByRole('button', { name: '正在加载房间…', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: '正在加载房间…', exact: true })
      .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(reads).toBe(1);
    release();
    await expect(page.locator('.continue-games .room-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '加载更多参与房间', exact: true })).toHaveCount(
      0,
    );
  } finally {
    release();
  }
});

test('a stalled service health request does not block database or realtime results and times out', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/health/live', async (route) => {
    calls++;
    await held;
    await route.abort('failed');
  });
  await page.route('**/health/ready', (route) =>
    route.fulfill({ json: { data: { database: { reason: '独立检查已完成' } } } }),
  );
  try {
    await page.goto('/status');
    await page.getByRole('button', { name: '立即检查', exact: true }).click();
    const database = page
      .locator('.status-service-card')
      .filter({ has: page.getByRole('heading', { name: '数据库', exact: true }) });
    const realtime = page
      .locator('.status-service-card')
      .filter({ has: page.getByRole('heading', { name: '实时连接', exact: true }) });
    await expect(database).toContainText('就绪');
    await expect(realtime).toContainText('可用');
    await page
      .getByRole('button', { name: '正在检查…', exact: true })
      .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(calls).toBe(1);
    await expect(page.getByText('检查超时，请重试', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: '立即检查', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});
