import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('admin configures ID cooldown while compact more navigation preserves the shell', async ({ page, browser }, info) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const user = await context.newPage();
  try {
    await login(page, 'stage7_admin');
    await page.evaluate(() => { document.body.dataset.navigationMarker = 'same-document'; });
    const documents: string[] = [];
    page.on('request', request => { if (request.isNavigationRequest()) documents.push(request.url()); });
    const more = page.locator('.nav-tools');
    await more.locator('summary').click();
    await expect(more.getByRole('link', { name: '资源管理' })).toHaveCount(0);
    await expect(more.getByRole('link', { name: '游戏展示' })).toHaveCount(0);
    await expect(more.getByRole('link', { name: '系统状态' })).toHaveCount(0);
    await more.getByRole('link', { name: '管理员后台' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '管理员后台', exact: true })).toBeVisible();
    await expect(more).not.toHaveAttribute('open');
    await expect(page.getByLabel('好友 ID 修改间隔（天）')).toHaveValue('30');
    await page.getByLabel('好友 ID 修改间隔（天）').fill('7');
    await page.getByRole('button', { name: '保存修改间隔' }).click();
    await expect(page.getByText('好友 ID 修改间隔已保存，立即生效。')).toBeVisible();
    await page.getByRole('link', { name: '账户管理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '账户管理', exact: true })).toBeVisible();
    await expect(more).not.toHaveAttribute('open');
    await page.goBack();
    await expect(page.getByLabel('好友 ID 修改间隔（天）')).toHaveValue('7');
    expect(documents).toEqual([]);
    expect(await page.evaluate(() => document.body.dataset.navigationMarker)).toBe('same-document');
    await login(user, 'stage3_a');
    await user.getByRole('link', { name: '好友', exact: true }).click();
    await user.getByRole('link', { name: '添加好友', exact: true }).click();
    await expect(user.getByText('当前每 7 天可修改一次', { exact: false })).toBeVisible();
    await user.getByLabel('新好友 ID', { exact: true }).fill('@policy_first');
    await user.getByRole('button', { name: '保存好友 ID', exact: true }).click();
    await expect(user.getByText('下次可修改：', { exact: false })).toBeVisible();
    await user.getByLabel('新好友 ID', { exact: true }).fill('@policy_second');
    await expect(user.getByRole('button', { name: '保存好友 ID', exact: true })).toBeDisabled();
    await page.getByLabel('好友 ID 修改间隔（天）').fill('0');
    await page.getByRole('button', { name: '保存修改间隔' }).click();
    await expect(page.getByText('好友 ID 修改间隔已保存，立即生效。')).toBeVisible();
    await user.reload();
    await expect(user.getByText('当前可随时修改好友 ID。')).toBeVisible();
    await user.getByLabel('新好友 ID', { exact: true }).fill('@policy_second');
    await user.getByRole('button', { name: '保存好友 ID', exact: true }).click();
    await expect(user.locator('.friend-id-card code')).toHaveText('@policy_second');
    await page.reload();
    await expect(page.getByLabel('好友 ID 修改间隔（天）')).toHaveValue('0');
    await page.screenshot({ path: info.outputPath('admin-id-policy.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
