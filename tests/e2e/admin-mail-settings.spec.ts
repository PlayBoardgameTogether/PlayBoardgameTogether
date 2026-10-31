import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from './fixtures.js';
import { readTestMail, readRegistrationCode } from './registration-mailbox.js';

const password = 'e2e-private-smtp-authorization';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('stage7_admin');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/');
}
async function configure(page: Page) {
  await page.getByLabel('启用注册邮件', { exact: true }).check();
  await page.getByLabel('SMTP 服务器', { exact: true }).fill('smtp.example.com');
  await page.getByLabel('SMTP 账号', { exact: true }).fill('sender@example.com');
  await page.getByLabel('发件邮箱', { exact: true }).fill('sender@example.com');
  await page.getByLabel('SMTP 授权码', { exact: true }).fill(password);
}

test('admin configures mail, tests delivery and the saved sender immediately supports registration', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '管理员后台', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.body.dataset.mailNavigation = 'same-document';
  });
  await page.getByRole('link', { name: '邮件设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '邮件设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.mailNavigation)).toBe('same-document');
  await expect(page.getByLabel('启用注册邮件', { exact: true })).not.toBeChecked();
  await configure(page);
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveAttribute('type', 'password');
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/mail-settings') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  expect(await (await savedResponse).text()).not.toContain(password);
  await expect(page.getByRole('status')).toContainText('邮件设置已保存');
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('启用注册邮件', { exact: true })).toBeChecked();
  await expect(page.getByLabel('启用注册邮件', { exact: true })).toHaveCSS('appearance', 'auto');
  await expect(page.getByLabel('SMTP 服务器', { exact: true })).toHaveValue('smtp.example.com');
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveAttribute(
    'placeholder',
    '已保存，留空保留',
  );
  await page.getByLabel('测试收件邮箱', { exact: true }).fill('admin-test@example.test');
  await page.getByRole('button', { name: '发送测试邮件', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮件服务已受理测试邮件');
  expect(await readTestMail('admin-test@example.test')).toContain('PlayBoard 邮件设置测试');
  await page.getByLabel('发件邮箱', { exact: true }).fill('new-sender@example.com');
  await expect(page.getByRole('button', { name: '发送测试邮件', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮件设置已保存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('mail-settings.png'),
    fullPage: true,
    animations: 'disabled',
  });
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('mail-settings-320.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill('admin-config-player@example.test');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('验证码已发送');
  await page
    .getByLabel('邮箱验证码', { exact: true })
    .fill(await readRegistrationCode('admin-config-player@example.test'));
  await page.getByLabel('玩家昵称', { exact: true }).fill('后台邮件验证玩家');
  await page.getByLabel('用户 ID', { exact: true }).fill('mail_config_player');
  await page.getByLabel('密码', { exact: true }).fill('Abc307');
  await page.getByLabel('确认密码', { exact: true }).fill('Abc307');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('注册成功');
});

test('lost save and test replies reuse their original requests, and conflicts require reloading', async ({
  page,
}) => {
  await login(page);
  await page.goto('/admin/mail');
  await configure(page);
  let saveCalls = 0;
  const saves: string[] = [];
  await page.route('**/api/v1/admin/mail-settings', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    saves.push(route.request().postDataJSON().requestId);
    saveCalls++;
    if (saveCalls === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认原保存请求', exact: true })).toBeVisible();
  await expect(page.getByLabel('SMTP 服务器', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '确认原保存请求', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮件设置已保存');
  expect(saves).toHaveLength(2);
  expect(saves[0]).toBe(saves[1]);
  let testCalls = 0;
  const tests: string[] = [];
  await page.route('**/api/v1/admin/mail-settings/test', async (route) => {
    tests.push(route.request().postDataJSON().requestId);
    testCalls++;
    if (testCalls === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByLabel('测试收件邮箱', { exact: true }).fill('recovery@example.test');
  await page.getByRole('button', { name: '发送测试邮件', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认原测试请求', exact: true })).toBeVisible();
  const delivered = await readTestMail('recovery@example.test');
  await page.getByRole('button', { name: '确认原测试请求', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('邮件服务已受理测试邮件');
  expect(tests).toHaveLength(2);
  expect(tests[0]).toBe(tests[1]);
  expect(await readTestMail('recovery@example.test')).toBe(delivered);
  const me = await page.request.get('/api/v1/auth/me');
  const updated = await page.request.put('/api/v1/admin/mail-settings', {
    headers: {
      origin: 'http://127.0.0.1:5273',
      'x-csrf-token': (await me.json()).data.csrfToken,
    },
    data: {
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      username: 'sender@example.com',
      from: 'concurrent@example.com',
      expectedRevision: 1,
      requestId: randomUUID(),
    },
  });
  expect(updated.ok()).toBe(true);
  await page.getByLabel('发件邮箱', { exact: true }).fill('stale@example.com');
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数据已被其他操作更新');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.getByLabel('发件邮箱', { exact: true })).toHaveValue('concurrent@example.com');
});
