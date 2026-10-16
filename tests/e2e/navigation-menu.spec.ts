import { test, expect, type Page } from '@playwright/test';
import { sessionFixture } from '../fixtures/session.js';

async function accountFixture(page: Page, role: 'user' | 'administrator') {
  let expired = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (expired) return route.fulfill({ status: 401, json: {
      ok: false, traceId: 'navigation',
      error: { code: 'UNAUTHENTICATED', message: '请登录', retryable: false },
    } });
    let data: unknown;
    if (path === '/auth/me') data = sessionFixture({ role });
    else if (path === '/social/updates') data = {
      changed: true, version: 'a'.repeat(64), overview: {
        identity: { friendId: 'alice', revision: 1, changeIntervalDays: 30, nextChangeAt: null, canChange: true },
        friends: [], requests: [], invitations: [],
      },
    };
    else if (path === '/me/model-profiles' || path === '/model-endpoints') data = [];
    else if (path === '/me/model-settings') data = { credentialsAvailable: false };
    else if (path === '/admin/overview') data = {
      accounts: 1, disabledAccounts: 0, openRooms: 0, activeMatches: 0,
      installedGames: 0, enabledGames: 0, pendingSubmissions: 0,
    };
    else if (path === '/admin/social-settings') data = { friendIdChangeDays: 30, revision: 1 };
    else return route.abort();
    return route.fulfill({ json: { ok: true, traceId: 'navigation', data } });
  });
  return {
    expire: () => { expired = true; },
    switchToPlayer: () => { role = 'user'; },
  };
}

test('more tools remain unobscured on narrow screens', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Mobile menu regression');
  await page.route('**/api/**', route => route.abort());
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/developers');
    await page.locator('.nav-tools summary').click();
    const menu = page.locator('.nav-tools > div');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return [0.1, 0.5, 0.9].every(x => [0.05, 0.5, 0.95].every(y =>
        element.contains(document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y))));
    })).toBe(true);
    for (const control of await menu.locator('a, select').all()) {
      await expect(control).toBeInViewport();
      expect(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return top === element || element.contains(top);
      })).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`more-menu-${width}.png`), fullPage: true });
  }
});

test('more tools dismiss on outside click, Escape and navigation', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/developers');
  await page.evaluate(() => { document.body.dataset.navigationMarker = 'same-document'; });
  const more = page.locator('.nav-tools');
  const toggle = more.locator('summary');
  await toggle.click();
  await expect(more).toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await expect(more).not.toHaveAttribute('open');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('heading', { name: '开发者中心', exact: true }).click();
  await expect(more).not.toHaveAttribute('open');
  await toggle.click();
  await page.getByRole('link', { name: '模型设置', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(more).not.toHaveAttribute('open');
  await toggle.click();
  await page.getByRole('link', { name: '模型设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/models$/);
  await expect(more).not.toHaveAttribute('open');
  await page.goBack();
  await expect(more).not.toHaveAttribute('open');
  expect(await page.evaluate(() => document.body.dataset.navigationMarker)).toBe('same-document');
});

test('touch links navigate even when the browser clears focus before click', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Touch focus regression');
  await accountFixture(page, 'administrator');
  await page.goto('/developers');
  await page.evaluate(() => { document.body.dataset.navigationMarker = 'same-document'; });
  const more = page.locator('.nav-tools');
  for (const [label, path, heading] of [
    ['模型设置', '/settings/models', '模型配置'],
    ['管理员后台', '/admin', '管理员后台'],
  ]) {
    await more.locator('summary').tap();
    const link = more.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    await more.locator('summary').focus();
    // Touch browsers can blur the summary without focusing the tapped anchor.
    await link.evaluate(element => element.addEventListener('pointerdown', () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, { once: true }));
    await link.tap();
    await expect(page).toHaveURL(path!);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(more).not.toHaveAttribute('open');
    expect(await page.evaluate(() => document.body.dataset.navigationMarker)).toBe('same-document');
  }
  await more.locator('summary').tap();
  await page.screenshot({ path: info.outputPath('administrator-menu.png'), fullPage: true });
});

test('administrator entry follows the authenticated account and clears with the session', async ({ page }) => {
  const state = await accountFixture(page, 'administrator');
  await page.goto('/developers');
  const more = page.locator('.nav-tools');
  await more.locator('summary').click();
  await expect(more.getByRole('link', { name: '管理员后台', exact: true })).toBeVisible();
  state.expire();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  await expect(more.getByRole('link', { name: '模型设置', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
});

test('ordinary users see no administrator entrances, including on direct admin URLs', async ({ page }, info) => {
  await accountFixture(page, 'user');
  await page.goto('/developers');
  const more = page.locator('.nav-tools');
  await more.locator('summary').click();
  await expect(more.getByRole('link', { name: '模型设置', exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('player-menu.png'), fullPage: true });
  for (const path of ['/admin', '/admin/accounts', '/admin/badges', '/admin/catalog', '/admin/submissions',
    '/admin/games', '/admin/assets', '/admin/updates', '/admin/official-ai',
    '/admin/accounts/10000000-0000-4000-8000-000000000001/badges',
    '/admin/accounts/10000000-0000-4000-8000-000000000001/coins']) {
    await page.goto(path);
    await expect(page.getByText('需要管理员权限', { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  }
});

test('switching from administrator to player never retains the administrator entry', async ({ page }) => {
  const state = await accountFixture(page, 'administrator');
  await page.goto('/developers');
  await page.locator('.nav-tools summary').click();
  await expect(page.getByRole('link', { name: '管理员后台', exact: true })).toBeVisible();
  // The login route clears the current shell session before a different account signs in.
  await page.evaluate(() => {
    history.pushState(null, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: '回到游戏桌', exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  state.switchToPlayer();
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.getByRole('button', { name: '通知', exact: true })).toBeVisible();
  await page.locator('.nav-tools summary').click();
  await expect(page.getByRole('link', { name: '模型设置', exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
});

test('unverified sessions keep administrator entrances hidden', async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    await pending;
    await route.abort();
  });
  await page.goto('/developers');
  await page.locator('.nav-tools summary').click();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/auth/me'));
  release();
  await failed;
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
});
