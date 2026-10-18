import { test, expect } from '@playwright/test';

const games = [
  { id: 'azul.base', name: '花砖物语', description: '花砖拼图', players: { min: 2, max: 4 } },
  { id: 'color-match', name: 'Color Match', description: '颜色卡牌', players: { min: 2, max: 4 } },
  { id: 'grid-garden', name: 'Grid Garden', description: '规划花园', players: { min: 2, max: 4 } },
  { id: 'splendor.base', name: '璀璨宝石', description: '收集宝石', players: { min: 2, max: 4 } },
  { id: 'duel', name: '双人棋', description: '双人对弈', players: { min: 2, max: 2 } },
  { id: 'party', name: '聚会桌游', description: '多人合作', players: { min: 3, max: 4 } },
].map(game => ({ ...game, version: '1.0.0', developmentOnly: false }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/games')) return route.fulfill({ json: { ok: true, traceId: 'discovery', data: games } });
    if (path.endsWith('/games/presentations')) return route.fulfill({ json: { ok: true, traceId: 'discovery', data: [] } });
    return route.fulfill({ status: 401, json: { ok: false, traceId: 'discovery', error: {
      code: 'UNAUTHENTICATED', message: '请登录', retryable: false,
    } } });
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(6);
});

test('search and player filters compose, recover from an empty result and retain game links', async ({ page }) => {
  await page.getByRole('button', { name: '双人对战', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(5);
  await page.getByRole('button', { name: '多人聚会', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(5);
  await page.getByRole('searchbox', { name: '搜索游戏' }).fill('  COLOR  ');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.game-card')).toHaveAttribute('href', '/games/color-match/1.0.0');
  await page.getByRole('searchbox').fill('不存在的桌游');
  await expect(page.getByText('还没找到合适的游戏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.getByRole('button', { name: '全部游戏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('.game-card')).toHaveCount(6);
});

test('mobile navigation stays reachable and content clears the bar at narrow widths', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Mobile navigation and grid');
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    const first = await page.locator('.game-card').nth(0).boundingBox();
    const second = await page.locator('.game-card').nth(1).boundingBox();
    expect(first!.y).toBe(second!.y);
    expect(second!.x).toBeGreaterThan(first!.x);
    await expect(nav).toBeInViewport();
    const bar = await nav.boundingBox();
    expect(bar!.y + bar!.height).toBe(844);
    for (const control of await nav.locator(':scope > a, summary').all()) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expect(nav).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`mobile-lobby-${width}.png`), fullPage: true });
  }
  await page.locator('.nav-tools summary').click();
  const menu = page.locator('.nav-tools > div');
  await expect(menu).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-tools')).not.toHaveAttribute('open');
  await expect(page.locator('.nav-tools summary')).toBeFocused();
  await page.getByRole('link', { name: '公共聊天', exact: true }).click();
  await expect(page).toHaveURL('/chat');
  await expect(page.getByRole('link', { name: '公共聊天', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main')).toBeFocused();
});

test('mobile tabs switch without page fades or a document reload', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch navigation regression');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    document.body.dataset.transitionCalls = '0';
    const original = document.startViewTransition;
    if (original) document.startViewTransition = update => {
      document.body.dataset.transitionCalls = String(Number(document.body.dataset.transitionCalls) + 1);
      return original.call(document, update);
    };
  });
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(nav.locator(':scope > a').first()).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  await expect(nav.locator(':scope > a').first()).toHaveCSS('transition-duration', '0s');
  for (const path of ['/friends', '/chat', '/profile', '/']) {
    await nav.locator(`:scope > a[href="${path}"]`).tap();
    await expect(page).toHaveURL(path);
    await expect(nav.locator(`:scope > a[href="${path}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main')).toBeFocused();
    await expect(page.locator('main')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('body')).toHaveAttribute('data-transition-calls', '0');
  }
});

test('game navigation collapses on mobile and remains available above the table', async ({ page, isMobile }, info) => {
  await page.goto('/games/azul.base/1.0.0/tutorial');
  await expect(page.locator('.az-table')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  const toggle = page.getByRole('button', { name: '导航', exact: true });
  if (!isMobile) {
    await expect(nav).toBeVisible();
    await expect(toggle).toBeHidden();
    return;
  }
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 700, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator('.desktop-shell').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--platform-bottom-inset').trim())).toBe('0px');
    await page.screenshot({ path: info.outputPath(`mobile-game-collapsed-${viewport.width}.png`) });
    await toggle.tap();
    await expect(nav).toBeVisible();
    const bar = await nav.boundingBox();
    expect(bar!.y + bar!.height).toBeLessThan(viewport.height);
    await page.locator('.nav-tools summary').tap();
    await expect(page.locator('.nav-tools > div')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.locator('.nav-tools')).not.toHaveAttribute('open');
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await toggle.tap();
  await nav.getByRole('link', { name: '公共聊天', exact: true }).tap();
  await expect(page).toHaveURL('/chat');
  await expect(nav).toBeVisible();
  await page.goBack();
  await expect(nav).toBeHidden();
});

test('light mobile game chrome retains readable text around the immersive table', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Mobile game shell');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('boardgame.theme', 'light'));
  await page.goto('/games/azul.base/1.0.0/tutorial');
  await expect(page.locator('.az-table')).toBeVisible();
  const contrast = await page.locator('.brand-name').evaluate(element => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const text = luminance(getComputedStyle(element).color);
    const surface = luminance(getComputedStyle(element.closest('header')!).backgroundColor);
    return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-light-tutorial.png'), fullPage: true });
  await page.goto('/games/splendor.base/1.0.0/tutorial');
  const bank = page.getByRole('region', { name: '公共宝石库存' });
  await bank.getByRole('button', { name: /^祖母绿库存/ }).click();
  const decision = page.getByRole('region', { name: '确认本回合操作' });
  await expect(decision).toBeVisible();
  const decisionBox = await decision.boundingBox();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeHidden();
  expect(decisionBox!.y + decisionBox!.height).toBeLessThanOrEqual(844);
  expect(decisionBox!.y + decisionBox!.height).toBeGreaterThan(744);
  await page.screenshot({ path: info.outputPath('mobile-decision-above-navigation.png') });
});
