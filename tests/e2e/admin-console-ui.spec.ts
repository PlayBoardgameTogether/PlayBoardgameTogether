import { test, expect } from '@playwright/test';
import { sessionFixture } from '../fixtures/session.js';

// Synthetic public data isolates rendering and read failures; real writes use admin-management.
test('console overview preserves confirmed data on refresh failure and recovers', async ({
  page,
}, info) => {
  let fail = false;
  let blocked = false;
  let release: (() => void) | undefined;
  let pending = 3;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (path === '/api/v1/admin/overview') {
      if (blocked)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (fail) {
        await route.fulfill({
          status: 503,
          json: {
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: '暂时不可用' },
            traceId: 'ui',
          },
        });
        return;
      }
      data = {
        accounts: 128,
        disabledAccounts: 2,
        openRooms: 8,
        activeMatches: 5,
        installedGames: 12,
        enabledGames: 9,
        pendingSubmissions: pending,
      };
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui' } });
  });
  await page.goto('/admin');
  const metrics = page.getByLabel('平台统计');
  await expect(metrics).toContainText('128');
  await expect(page.getByRole('heading', { name: '3 份申请等待处理' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '后台导航' });
  await expect(navigation.getByRole('link')).toHaveCount(9);
  await expect(navigation.getByRole('link', { name: '管理总览' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: '查看待审申请' })).toHaveAttribute(
    'href',
    '/admin/submissions',
  );
  const settings = page.locator('.admin-settings');
  await expect(settings).not.toHaveAttribute('open');
  await settings.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(settings).not.toHaveAttribute('open');
  const refresh = page.getByRole('button', { name: '刷新统计', exact: true });
  blocked = true;
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(metrics).toHaveAttribute('aria-busy', 'true');
  await expect(metrics).toContainText('128');
  await expect.poll(() => Boolean(release)).toBe(true);
  fail = true;
  blocked = false;
  release!();
  await expect(page.getByRole('alert')).toContainText('保留上次读取的数据');
  await expect(metrics).toContainText('128');
  await expect(refresh).toBeEnabled();
  fail = false;
  pending = 0;
  await refresh.click();
  await expect(page.getByRole('heading', { name: '暂时没有待审申请' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('console layouts keep current navigation reachable across themes and narrow screens', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (path === '/api/v1/admin/overview')
      data = {
        accounts: 0,
        disabledAccounts: 0,
        openRooms: 0,
        activeMatches: 0,
        installedGames: 0,
        enabledGames: 0,
        pendingSubmissions: 0,
      };
    else if (path === '/api/v1/admin/accounts')
      data = {
        items: [
          {
            ...sessionFixture().account,
            displayName: '很长的玩家昵称用于检查窄屏换行',
            revision: 1,
            createdAt: '2026-10-21T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      };
    else if (path.includes('/coins')) {
      await route.abort();
      return;
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui' } });
  });
  for (const width of info.project.name === 'mobile' ? [390, 320] : [1440, 1280, 844]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.goto('/admin');
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.getByLabel('平台统计')).toContainText('账户');
      await page.screenshot({
        path: info.outputPath(`overview-${width}-${theme}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .getByLabel('后台导航')
        .getByRole('link', { name: '账户管理', exact: true })
        .click();
      await expect(page.getByRole('article')).toHaveCount(1);
      const record = page.getByRole('article');
      await record.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(record.locator('code')).toHaveText(sessionFixture().account.id);
      await expect(
        page.getByLabel('后台导航').getByRole('link', { name: '账户管理', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await page.screenshot({
        path: info.outputPath(`accounts-${width}-${theme}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await record.getByRole('link', { name: '管理桌游币' }).click();
      const current = page
        .getByLabel('后台导航')
        .getByRole('link', { name: '账户管理', exact: true });
      await expect(current).toHaveAttribute('aria-current', 'page');
      const box = (await current.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect(
        page.getByLabel('后台导航').getByRole('link', { name: '服务更新' }),
      ).toBeVisible();
    }
  }
});
