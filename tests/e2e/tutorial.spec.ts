import { test, expect } from './fixtures.js';

test('guest completes the real board tutorial, retries and returns to game details', async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\//.test(request.url())) writes.push(request.url());
  });
  await page.goto('/');
  await page.evaluate(() => {
    document.body.dataset.tutorialMarker = 'same-document';
  });
  await page.getByRole('link', { name: '先试一手', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Color Match 上手教程' })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.tutorialMarker)).toBe('same-document');
  expect(
    await page
      .locator('.tutorial-intro h1')
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(280);
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '摸牌或跳过并结束回合' }).click();
  await expect(page.getByRole('status').filter({ hasText: '暂时不用摸牌' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  const hand = page.getByRole('region', { name: '我的手牌', exact: true });
  await hand.getByRole('button', { name: '红 3 可出' }).click();
  await page.getByRole('button', { name: '重试本步', exact: true }).click();
  await expect(page.getByRole('button', { name: '出牌', exact: true })).toHaveCount(0);
  await hand.getByRole('button', { name: '红 3 可出' }).click();
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await hand.getByRole('button', { name: '蓝 3 可出' }).click();
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '摸牌或跳过并结束回合' }).click();
  await expect(hand.getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await hand.getByRole('button', { name: '蓝 5 可出' }).click();
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '指定摸牌', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '指定摸牌', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '指定摸牌', exact: true }).click();
  await page.getByRole('button', { name: '确认目标', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '目标已确认' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('tutorial-target.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await hand.getByRole('button', { name: '绿 2 可出' }).click();
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await expect(page.getByText('你赢了！', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成教程', exact: true }).click();
  await expect(page.getByRole('heading', { name: '教程完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '再练一次', exact: true }).click();
  await expect(page.getByRole('heading', { name: '匹配颜色', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '匹配颜色', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← 返回游戏详情', exact: true }).click();
  await expect(page.getByRole('link', { name: '进入教程', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Color Match 上手教程' })).toBeVisible();
  expect(writes).toEqual([]);
});

test('tutorial entry is optional and exact-version; failed loading can retry', async ({ page }) => {
  await page.goto('/games/grid-garden/1.0.0');
  await expect(page.getByRole('heading', { name: 'Grid Garden', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入教程', exact: true })).toHaveCount(0);
  await page.goto('/games/grid-garden/1.0.0/tutorial');
  await expect(page.getByRole('heading', { name: '该游戏暂未提供交互教程' })).toBeVisible();
  await page.goto('/games/color-match/9.9.9/tutorial');
  await expect(page.getByRole('heading', { name: '游戏暂不可用' })).toBeVisible();
  await page.route('**/games/color-match/src/client/index.tsx*', (route) => route.abort());
  await page.goto('/games/color-match/1.0.0/tutorial');
  await expect(page.getByRole('heading', { name: '教程加载失败', exact: true })).toBeVisible();
  await page.unroute('**/games/color-match/src/client/index.tsx*');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: '匹配颜色', exact: true })).toBeVisible();
});
