import { test, expect } from './fixtures.js';

test('profile sections fit the viewport and keep avatar choices usable', async ({ page }, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goto('/profile/edit');
  await page
    .getByLabel('昵称', { exact: true })
    .fill('这是一个用于检查个人资料长昵称换行的桌游玩家名字测试账号甲乙丙丁');
  await page.getByLabel('个人简介').fill('Boardgames'.repeat(30));
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('资料已保存');
  await page.goto('/profile/identity');
  await page
    .getByLabel('新好友 ID')
    .fill(`profile_${info.project.name}_${'x'.repeat(info.project.name === 'desktop' ? 20 : 21)}`);
  await page.getByRole('button', { name: '保存好友 ID', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('好友 ID 已保存');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Clipboard denied for regression')) },
    });
  });
  // Rendering fixture covers long history rows without manufacturing completed matches.
  await page.route('**/api/v1/profile/matches', (route) =>
    route.fulfill({
      json: {
        ok: true,
        traceId: 'profile-history-layout',
        data: {
          items: ['active', 'finished', 'aborted'].map((status, index) => ({
            id: `00000000-0000-4000-8000-00000000000${index}`,
            gameId: 'color-match',
            gameVersion: '1.0.0',
            roomName: '这是需要在窄屏完整显示的桌游房间名称测试'.repeat(2),
            status,
            createdAt: '2026-10-11T00:00:00.000Z',
          })),
          nextCursor: null,
        },
      },
    }),
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('boardgame.theme', value), theme);
    for (const section of ['', '/edit', '/identity', '/history', '/badges']) {
      await page.goto(`/profile${section}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main h1')).toBeVisible();
      if (section === '/edit') await expect(page.getByLabel('昵称', { exact: true })).toBeVisible();
      if (section === '/identity') await expect(page.getByLabel('新好友 ID')).toBeVisible();
      if (section === '/history') await expect(page.locator('.match-history-row')).toHaveCount(3);
      if (section === '/badges')
        await expect(page.getByRole('article', { name: '初来乍到', exact: true })).toBeVisible();
      if (section === '' || section === '/identity') {
        await page.getByRole('button', { name: '复制好友 ID', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('复制失败');
        await expect(page.getByText('操作成功', { exact: true })).toHaveCount(0);
      }
      for (const width of info.project.name === 'desktop' ? [1440, 1280] : [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (section === '' || section === '/identity') {
          const message = await page.locator('.toast-body').boundingBox();
          expect(message!.width).toBeGreaterThanOrEqual(120);
        }
        if (section === '/edit') {
          const choice = page.getByRole('radio', { name: '猫咪', exact: true });
          await page.keyboard.press('Tab');
          await choice.focus();
          await expect(page.locator('.avatar-item').filter({ has: choice })).toHaveCSS(
            'outline-style',
            'solid',
          );
          await page.keyboard.press('Space');
          await expect(choice).toBeChecked();
        }
        if (section === '') {
          await page.getByText('账户操作', { exact: true }).click();
          const popup = await page.locator('.profile-options-popover').boundingBox();
          expect(popup!.x).toBeGreaterThanOrEqual(0);
          expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
          await page.getByText('账户操作', { exact: true }).click();
        }
      }
      await page.screenshot({
        path: info.outputPath(`${theme}-${section.slice(1) || 'summary'}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.route('**/api/v1/profile', (route) => route.abort());
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: '资料加载失败', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/profile');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的资料', exact: true })).toBeVisible();
});
