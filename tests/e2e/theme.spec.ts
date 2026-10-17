import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
});

test('theme follows the system, preserves form state and persists across routes and reloads', async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('用户名').fill('theme_player');
  await page.getByLabel('密码', { exact: true }).fill('password123');
  await page.locator('.nav-tools summary').click();
  const appearance = page.getByLabel('外观', { exact: true });
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('用户名')).toHaveValue('theme_player');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('password123');
  await appearance.selectOption('light');
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(appearance).toBeVisible();
    expect(
      await page.locator('label[for="theme-preference"]').evaluate((label) => {
        const box = label.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === label;
      }),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`light-login-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).color)).toBe(
    'rgb(35, 31, 28)',
  );
  expect(
    await page.getByLabel('用户名').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.nav-tools summary').click();
  await expect(appearance).toHaveValue('light');
  await page.screenshot({
    path: info.outputPath('light-developers.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf7f2');
});

test('saved appearance is applied before the application bundle loads', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('boardgame.theme', 'light'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
    'light',
  );
});

test('light theme keeps the real tutorial tables readable without restarting the exercise', async ({
  page,
}, info) => {
  const games = [
    { id: 'azul.base', version: '1.0.0', name: '花砖物语' },
    { id: 'splendor.base', version: '1.0.0', name: '璀璨宝石' },
  ].map((game) => ({
    ...game,
    description: '',
    players: { min: 2, max: 4 },
    developmentOnly: false,
  }));
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({ json: { ok: true, data: games, traceId: 'theme-catalog' } }),
  );
  await page.route('**/api/v1/games/presentations', (route) =>
    route.fulfill({ json: { ok: true, data: [], traceId: 'theme-catalog' } }),
  );
  await page.addInitScript(() => localStorage.setItem('boardgame.theme', 'light'));
  for (const [id, selector] of [
    ['azul.base', '.az-table'],
    ['splendor.base', '.sp-table'],
  ] as const) {
    await page.goto(`/games/${id}/1.0.0/tutorial`);
    await expect(page.locator(selector)).toBeVisible();
    expect(
      await page
        .locator(`${selector} h2`)
        .first()
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe('rgb(250, 245, 235)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`light-${id}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    const instruction = await page.getByRole('region', { name: '教程指引' }).textContent();
    await page.locator('.nav-tools summary').click();
    await page.getByLabel('外观', { exact: true }).selectOption('dark');
    await expect(page.getByRole('region', { name: '教程指引' })).toHaveText(instruction!);
    await page.getByLabel('外观', { exact: true }).selectOption('light');
  }
});

test('theme synchronizes tabs and falls back safely when storage is unavailable', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.locator('.nav-tools summary').click();
  const second = await context.newPage();
  await second.route('**/api/**', (route) => route.abort());
  await second.goto('/login');
  await second.locator('.nav-tools summary').click();
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await expect(second.getByLabel('外观', { exact: true })).toHaveValue('dark');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await second.getByLabel('外观', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await second.close();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('disabled storage');
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.nav-tools summary').click();
  await page.getByLabel('外观', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
