import { test, expect } from '@playwright/test';

test('public pages load independently, retain navigation and fit small screens', async ({ page, request }, info) => {
  await page.route('**/api/**', route => route.abort());
  const scripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '回到游戏桌' })).toBeVisible();
  await expect(page).toHaveTitle('账户登录 · 桌游平台');
  expect(scripts.some(url => /\/(?:MatchPage|AssetAdminPage|DevelopersPage|RootPage)-/.test(url))).toBe(false);
  await page.getByLabel('密码', { exact: true }).fill('example-password');
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: '隐藏密码' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '隐藏密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('example-password');
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.nav-tools summary').click();
    await page.getByRole('link', { name: '开发者文档', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: '开发者文档', exact: true })).toBeInViewport();
    await page.locator('.nav-tools summary').click();
    await page.getByLabel('用户名').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`login-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('开发者中心 · 桌游平台开发文档');
  await expect(page.locator('main')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveTitle('账户登录 · 桌游平台');
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
  await expect(page).toHaveTitle('页面不存在 · 桌游平台');
  await page.getByRole('main').getByRole('link', { name: '开发者文档' }).click();
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  expect((await request.get('/favicon.svg')).ok()).toBe(true);
});

test('login locks pending requests and distinguishes connection, credentials and rate limiting', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('player_test');
  await page.getByLabel('密码', { exact: true }).fill('example-password');
  let calls = 0;
  let requestObserved!: () => void;
  const observedRequest = new Promise<void>(resolve => { requestObserved = resolve; });
  let release: (() => void) | undefined;
  await page.route('**/auth/login', async route => {
    calls++;
    requestObserved();
    await new Promise<void>(resolve => { release = resolve; });
    await route.abort();
  });
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByLabel('用户名')).toBeDisabled();
  await expect(page.getByLabel('密码', { exact: true })).toBeDisabled();
  await observedRequest;
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(calls).toBe(1);
  release!();
  await expect(page.getByRole('alert')).toHaveText('暂时无法登录，请检查连接后重试。');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('example-password');
  await page.unroute('**/auth/login');
  for (const [code, message] of [
    ['AUTH_INVALID_CREDENTIALS', '用户名或密码不正确，或账户已停用。'],
    ['RATE_LIMITED', '登录尝试过于频繁，请稍后再试。'],
  ] as const) {
    await page.route('**/auth/login', route => route.fulfill({
      status: code === 'RATE_LIMITED' ? 429 : 401,
      json: { ok: false, traceId: 'public-ui-test', error: { code, message: 'test', retryable: false } },
    }));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    await page.unroute('**/auth/login');
  }
});

test('failed page chunk keeps the shell usable and another route recovers', async ({ page }) => {
  const loginChunk = /(?:\/assets\/LoginPage-.*\.js|\/src\/pages\/LoginPage\.tsx)/;
  await page.route(loginChunk, route => route.abort());
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '页面暂时无法显示' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载页面' })).toBeVisible();
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await page.unroute(loginChunk);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '回到游戏桌' })).toBeVisible();
});

