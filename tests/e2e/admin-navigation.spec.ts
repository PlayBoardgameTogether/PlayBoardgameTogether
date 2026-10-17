import { test, expect } from './fixtures.js';

test('presentation and assets retain the administrator header and navigation', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage7_admin');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goto('/admin');

  for (const [label, path, heading] of [
    ['游戏展示', '/admin/games', '游戏展示'],
    ['资源管理', '/admin/assets', '图片与短音效'],
  ]) {
    await page
      .getByRole('navigation', { name: '后台导航' })
      .getByRole('link', { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '后台导航' });
    await expect(navigation).toBeVisible();
    if (info.project.name === 'mobile') {
      expect((await navigation.boundingBox())!.height).toBeLessThan(80);
      const item = await navigation.getByRole('link', { name: label, exact: true }).boundingBox();
      expect(item!.x).toBeGreaterThanOrEqual(0);
      expect(item!.x + item!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: '返回大厅', exact: true })).toBeVisible();
    await page.reload();
    await expect(navigation).toBeVisible();
    if (path === '/admin/games') {
      await expect(page.getByLabel('配置游戏')).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: '已发布资源', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }

  await page
    .getByRole('navigation', { name: '后台导航' })
    .getByRole('link', { name: '管理总览', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '管理员后台', exact: true })).toBeVisible();
});
