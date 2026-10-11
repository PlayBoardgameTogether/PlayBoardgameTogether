import { openRoomCreation } from './fixtures.js';
import { test, expect } from './fixtures.js';

test('lobby owns creation and profile changes persist across reloads', async ({ page }, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await expect(page.locator('nav').getByRole('link', { name: '创建房间' })).toHaveCount(0);
  await expect(page.getByLabel('游戏与版本')).toHaveCount(0);
  await openRoomCreation(page);
  await expect(page).toHaveURL('/games/color-match/1.0.0/new');
  await expect(page.getByLabel('游戏与版本')).toBeVisible();
  await page.getByRole('link', { name: '返回游戏详情' }).click();
  await page.getByRole('link', { name: '返回游戏大厅' }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('lobby.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: '我的资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的资料', exact: true })).toBeVisible();
  await expect(page.getByLabel('昵称', { exact: true })).toHaveCount(0);
  const originalViewport = page.viewportSize()!;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(theme => localStorage.setItem('boardgame.theme', theme), colorScheme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await expect(page.getByRole('heading', { name: '我的资料', exact: true })).toBeVisible();
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const heading = page.locator('.profile-heading');
      await expect(heading).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const layout = await heading.evaluate(element => {
        const header = element.getBoundingClientRect();
        const title = element.querySelector('h1')!.getBoundingClientRect();
        const card = document.querySelector('.profile-card')!.getBoundingClientRect();
        return {
          singleLine: title.height < 70,
          contained: title.top >= header.top && title.bottom <= header.bottom,
          separated: header.bottom <= card.top,
          fits: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(layout).toEqual({ singleLine: true, contained: true, separated: true, fits: true });
      await page.screenshot({ path: info.outputPath(`profile-heading-${colorScheme}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize(originalViewport);
  await page.getByText('账户操作', { exact: true }).click();
  await expect(page.locator('.account-id')).toHaveText(/^[0-9a-f-]{36}$/);
  await page.getByText('账户操作', { exact: true }).click();
  await page.getByRole('link', { name: '编辑资料', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).fill('周末桌友');
  await page.locator('label.avatar-item').filter({ hasText: '猫咪' }).click();
  await expect(page.getByRole('radio', { name: '猫咪', exact: true })).toBeChecked();
  await page.getByLabel('个人简介').fill('喜欢合作游戏，周末约一局。');
  await page.getByRole('button', { name: '保存资料' }).click();
  await expect(page.getByRole('status')).toHaveText('资料已保存');
  await page.reload();
  await page.getByRole('link', { name: '编辑资料', exact: true }).click();
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('周末桌友');
  await expect(page.getByRole('radio', { name: '猫咪', exact: true })).toBeChecked();
  await expect(page.getByLabel('个人简介')).toHaveValue('喜欢合作游戏，周末约一局。');
  const alignment = await page.getByRole('button', { name: '保存资料' }).evaluate(element => {
    const button = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return {
      x: Math.abs((button.left + button.right - text.left - text.right) / 2),
      y: Math.abs((button.top + button.bottom - text.top - text.bottom) / 2),
    };
  });
  expect(alignment.x).toBeLessThanOrEqual(2);
  expect(alignment.y).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('profile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: '返回我的资料' }).click();
  await page.getByRole('link', { name: '对局记录', exact: true }).click();
  await expect(page.getByText('还没有对局记录。')).toBeVisible();
  await page.getByRole('link', { name: '游戏大厅', exact: true }).click();
  await expect(page.getByText('你好，周末桌友')).toBeVisible();
});
