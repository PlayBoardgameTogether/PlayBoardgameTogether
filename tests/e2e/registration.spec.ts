import { test, expect, type Page } from './fixtures.js';

async function fillRegistration(page: Page, userId = '@rst307') {
  await page.getByLabel('用户名', { exact: true }).fill('新桌游玩家');
  await page.getByLabel('用户 ID', { exact: true }).fill(userId);
  await page.getByLabel('密码', { exact: true }).fill('Abc307');
  await page.getByLabel('确认密码', { exact: true }).fill('Abc307');
}

test('registers a real account, logs in and restores the exact friend ID', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByRole('link', { name: '没有账号？注册账号' }).click();
  await expect(page).toHaveTitle('账号注册 · 桌游平台');
  await expect(page.getByRole('heading', { name: '加入游戏桌' })).toBeVisible();
  await fillRegistration(page);
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏密码' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('registration.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('注册成功，请输入密码登录。');
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('@rst307');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await page.getByLabel('密码', { exact: true }).fill('Abc307');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '好友', exact: true }).click();
  await page.getByRole('link', { name: '添加好友', exact: true }).click();
  await expect(page.getByLabel('新好友 ID', { exact: true })).toHaveValue('@rst307');
  await page.reload();
  await expect(page.getByLabel('新好友 ID', { exact: true })).toHaveValue('@rst307');
  await page.goto('/register');
  await fillRegistration(page, '@RST307');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('这个用户 ID 已被使用，请换一个。');
  await expect(page.getByLabel('用户 ID', { exact: true })).toBeFocused();
});

test('validates password rules and confirmation before making a request', async ({ page }) => {
  let calls = 0;
  await page.route('**/auth/register', async (route) => {
    calls++;
    await route.abort();
  });
  await page.goto('/register');
  await fillRegistration(page);
  await page.getByLabel('密码', { exact: true }).fill('OnlyLettersHere');
  await page.getByLabel('确认密码', { exact: true }).fill('OnlyLettersHere');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    '密码须为 6–128 位，至少包含一个字母和一个数字。',
  );
  await expect(page.getByLabel('密码', { exact: true })).toBeFocused();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('密码', { exact: true }).fill('Abc307');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('两次输入的密码不一致。');
  await expect(page.getByLabel('确认密码', { exact: true })).toBeFocused();
  await expect(page.getByLabel('密码', { exact: true })).not.toHaveAttribute('aria-invalid');
  expect(calls).toBe(0);
  await page.getByLabel('确认密码', { exact: true }).fill('Abc307');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('暂时无法注册，请检查连接后重试。');
  expect(calls).toBe(1);
});

test('locks duplicate submits and ignores late replies after navigation', async ({ page }) => {
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route('**/auth/register', async (route) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 201,
      json: {
        ok: true,
        traceId: 'registration-pending-test',
        data: { username: 'rst307', displayName: '新桌游玩家', friendId: 'rst307' },
      },
    });
  });
  await page.goto('/register');
  await fillRegistration(page);
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByLabel('用户 ID', { exact: true })).toBeDisabled();
  await page
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(calls).toBe(1);
  await page.getByRole('link', { name: '已有账号？去登录' }).click();
  await expect(page).toHaveTitle('账户登录 · 桌游平台');
  const completed = page.waitForResponse('**/auth/register');
  release!();
  await completed;
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('');
  await expect(page.getByRole('status')).toHaveCount(0);
});
