import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('friends can join from the lobby and pending requests keep the original form locked', async ({ browser }, info) => {
  const host = await browser.newContext(info.project.use);
  const guest = await browser.newContext(info.project.use);
  const a = await host.newPage(), b = await guest.newPage();
  let release = () => {};
  try {
    await login(a, 'stage2_a');
    await a.goto('/games/color-match/1.0.0/new');
    await a.getByLabel('房间名', { exact: true }).fill('邀请码直达体验桌');
    await a.getByRole('button', { name: '创建并生成邀请码' }).click();
    await expect(a.locator('.room-heading')).toBeVisible();
    const code = await a.locator('.invite-box strong').innerText();
    const roomPath = new URL(a.url()).pathname;
    await login(b, 'stage2_b');
    await b.getByText('邀请码加入', { exact: true }).click();
    await expect(b).toHaveURL('/');
    await b.getByLabel('12 位邀请码').fill(code);
    let requests = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await b.route('**/api/v1/rooms/join', async route => {
      requests++;
      await pending;
      await route.continue();
    });
    const request = b.waitForRequest('**/api/v1/rooms/join');
    await b.getByRole('button', { name: '加入私人房间', exact: true }).click();
    await request;
    await expect(b.getByLabel('12 位邀请码')).toBeDisabled();
    await expect(b.getByLabel('邀请码房间密码（如有）')).toBeDisabled();
    await b.locator('.lobby-invite form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(requests).toBe(1);
    release();
    await expect(b).toHaveURL(roomPath);
    await expect(b.getByRole('button', { name: '坐这里', exact: true })).toBeVisible();
    await b.screenshot({ path: info.outputPath('joined-from-home.png'), fullPage: true });
  } finally {
    release();
    await host.close();
    await guest.close();
  }
});

test('a hidden invalid options draft is revealed and repaired without losing the room settings', async ({ page }, info) => {
  await login(page, 'stage2_a');
  await page.goto('/games/color-match/1.0.0/new');
  await page.getByLabel('房间名', { exact: true }).fill('保留草稿体验桌');
  await page.getByText('高级设置', { exact: true }).click();
  const options = page.getByLabel('游戏选项（JSON）');
  await options.fill('{ broken');
  await page.getByText('高级设置', { exact: true }).click();
  let creates = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/rooms') creates++;
  });
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(options).toBeVisible();
  await expect(options).toBeFocused();
  await expect(options).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('房间名', { exact: true })).toHaveValue('保留草稿体验桌');
  expect(creates).toBe(0);
  await page.screenshot({ path: info.outputPath('options-error-revealed.png'), fullPage: true });
  await options.fill('{}');
  await expect(options).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page.locator('.room-heading')).toContainText('保留草稿体验桌');
  expect(creates).toBe(1);
});
