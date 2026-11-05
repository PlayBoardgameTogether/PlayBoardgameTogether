import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from './fixtures.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { readRegistrationCode } from './registration-mailbox.js';

const origin = 'http://127.0.0.1:5273';
const password = 'OldPassword307!';
const nextPassword = 'NewPassword308!';
async function login(page: Page, username: string, value = password) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(value);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/');
}
async function account(role: 'user' | 'administrator' = 'user', email?: string) {
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  const username = `security_${randomUUID().slice(0, 8)}`;
  try {
    const id = await createAccount(db, { username, displayName: '账户安全测试', password, role });
    if (email)
      await db.query('UPDATE accounts SET email_canonical=$2,email_verified_at=now() WHERE id=$1', [
        id,
        email,
      ]);
  } finally {
    await db.end();
  }
  return username;
}

test.beforeEach(async ({ request }) => {
  const login = await request.post('/api/v1/auth/login', {
    headers: { origin },
    data: { username: 'stage7_admin', password: 'stage two password' },
  });
  const csrf = (await login.json()).data.csrfToken;
  const current = await request.get('/api/v1/admin/mail-settings');
  const response = await request.put('/api/v1/admin/mail-settings', {
    headers: { origin, 'x-csrf-token': csrf },
    data: {
      requestId: randomUUID(),
      expectedRevision: (await current.json()).data.revision,
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      username: 'test@example.com',
      from: 'test@example.com',
      password: 'e2e-only-credential',
    },
  });
  expect(response.ok()).toBe(true);
});

test('binds, replaces email and signs out other devices through the real account page', async ({
  page,
  browser,
}, info) => {
  const username = await account();
  const email = `${username}@example.test`;
  await login(page, username);
  await page.goto('/profile');
  await expect(page.locator('.profile-feature-card[href="/profile/security"]')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('profile-security-entry.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('.profile-feature-card[href="/profile/security"]').click();
  await expect(page.getByRole('heading', { name: '账户安全', exact: true })).toBeVisible();
  await expect(page.getByText('尚未绑定邮箱')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('security-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
  if (info.project.name === 'desktop') {
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`security-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const binding = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '绑定邮箱', exact: true }) });
  await binding.getByLabel('当前密码', { exact: true }).fill(password);
  await binding.getByLabel('邮箱', { exact: true }).fill(email);
  await binding.getByRole('button', { name: '发送邮箱验证码' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await expect(binding.getByLabel('邮箱验证码')).toBeFocused();
  await binding.getByLabel('邮箱验证码').fill(await readRegistrationCode(email));
  await binding.getByRole('button', { name: '确认绑定邮箱' }).click();
  await expect(page.getByRole('status')).toContainText('邮箱已更新');
  await login(page, username);
  await page.goto('/profile/security');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const replacement = `replacement_${email}`;
  await binding.getByLabel('当前密码', { exact: true }).fill(password);
  await binding.getByLabel('新邮箱', { exact: true }).fill(replacement);
  await binding.getByRole('button', { name: '发送邮箱验证码' }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await binding.getByLabel('邮箱验证码').fill(await readRegistrationCode(replacement));
  await binding.getByRole('button', { name: '确认换绑邮箱' }).click();
  await expect(page.getByRole('status')).toContainText('全部登录已退出');
  await login(page, username);
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await login(other, username);
    await page.goto('/profile/security');
    const sessions = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '登录会话' }) });
    await sessions.getByLabel('当前密码').fill(password);
    await sessions.getByRole('button', { name: '退出其他设备' }).click();
    await expect(page.getByRole('status')).toContainText('已退出其他 1 个');
    expect((await context.request.get(`${origin}/api/v1/auth/me`)).status()).toBe(401);
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
  } finally {
    await context.close();
  }
});

test('administrator changes own password in the console and old credentials stop working', async ({
  page,
}, info) => {
  const username = await account('administrator');
  await login(page, username);
  await page.goto('/admin');
  await page.getByRole('link', { name: '我的账户安全', exact: true }).click();
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '修改密码', exact: true }) });
  await section.getByLabel('当前密码').fill('wrong-password');
  await section.getByLabel('新密码', { exact: true }).fill(nextPassword);
  await section.getByLabel('确认新密码').fill('Mismatch309!');
  await section.getByRole('button', { name: '修改密码并退出登录' }).click();
  await expect(page.getByRole('alert')).toContainText('不一致');
  await section.getByLabel('确认新密码').fill(nextPassword);
  await section.getByRole('button', { name: '修改密码并退出登录' }).click();
  await expect(page.getByRole('alert')).toContainText('当前密码不正确');
  await section.getByLabel('当前密码').fill(password);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('admin-security-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await section.getByRole('button', { name: '修改密码并退出登录' }).click();
  await expect(page.getByRole('status')).toContainText('密码已修改');
  const rejected = await page.request.post('/api/v1/auth/login', {
    headers: { origin },
    data: { username, password },
  });
  expect(rejected.status()).toBe(401);
  await login(page, username, nextPassword);
  await page.goto('/admin/security');
  await expect(page.getByRole('heading', { name: '我的账户安全', exact: true })).toBeVisible();
});

test('recovers a password with a mailbox code and prevents ordinary users accessing admin security', async ({
  page,
}, info) => {
  const email = `recover_${randomUUID().slice(0, 8)}@example.test`;
  const username = await account('user', email);
  await page.goto('/login');
  await page.getByRole('link', { name: '忘记密码？' }).click();
  await page.getByLabel('用户 ID', { exact: true }).fill(username);
  await page.getByLabel('绑定邮箱', { exact: true }).fill(email);
  await page.getByRole('button', { name: '发送重置验证码' }).click();
  await expect(page.getByRole('status')).toContainText('如果用户 ID');
  await expect(page.getByLabel('邮箱验证码')).toBeFocused();
  await page.getByLabel('邮箱验证码').fill(await readRegistrationCode(email));
  await page.getByLabel('新密码', { exact: true }).fill(nextPassword);
  await page.getByLabel('确认新密码').fill(nextPassword);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('password-recovery.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '重置密码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('密码已重置');
  await login(page, username, nextPassword);
  await page.goto('/admin/security');
  await expect(page.getByRole('heading', { name: '需要管理员权限' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '修改密码', exact: true })).toHaveCount(0);
});
