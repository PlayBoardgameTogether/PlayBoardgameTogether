import { test, expect, openRoomCreation, openInviteJoin } from './fixtures.js';

test('顶部退出入口释放席位，最后一位成员退出后关闭房间', async ({ browser }, info) => {
  const host = await browser.newContext(info.project.use);
  const guest = await browser.newContext(info.project.use);
  const a = await host.newPage();
  const b = await guest.newPage();
  try {
    for (const [page, user] of [[a, 'stage2_a'], [b, 'stage2_b']] as const) {
      await page.goto('/login');
      await page.getByLabel('用户名').fill(user);
      await page.getByLabel('密码', { exact: true }).fill('stage two password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
    }
    await openRoomCreation(a);
    await a.getByRole('button', { name: '创建并生成邀请码' }).click();
    await expect(a).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
    const roomUrl = a.url();
    const code = await a.locator('.invite-box strong').innerText();
    await openInviteJoin(b);
    await b.getByLabel('12 位邀请码').fill(code);
    await b.getByRole('button', { name: '加入私人房间' }).click();
    await b.getByRole('button', { name: '坐这里', exact: true }).click();
    await a.getByRole('button', { name: '准备', exact: true }).click();
    const leave = b.locator('.room-heading').getByRole('button', { name: '退出房间', exact: true });
    await expect(leave).toBeEnabled();
    await expect(b.getByRole('button', { name: '离座', exact: true })).toBeHidden();
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await b.screenshot({ path: info.outputPath('room-leave.png'), fullPage: true });
    await leave.click();
    await expect(b).toHaveURL('/');
    await expect(a.locator('.room-heading')).toContainText('1 位成员');
    await expect(a.getByRole('button', { name: '坐这里', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: '准备', exact: true })).toBeVisible();
    await a.locator('.room-heading').getByRole('button', { name: '退出房间', exact: true }).click();
    await expect(a).toHaveURL('/');
    const denied = a.waitForResponse(response => response.url().includes('/api/v1/rooms/') && response.request().method() === 'GET');
    await a.goto(roomUrl);
    expect((await denied).status()).toBe(404);
    await expect(a.getByRole('heading', { name: '无法进入房间', exact: true })).toBeVisible();
    await a.getByRole('button', { name: '返回', exact: true }).click();
    await expect(a).toHaveURL('/');
    await openRoomCreation(a);
    await a.getByRole('button', { name: '创建并生成邀请码' }).click();
    await expect(a.locator('.room-heading').getByRole('button', { name: '退出房间', exact: true })).toBeEnabled();
  } finally {
    await host.close();
    await guest.close();
  }
});
