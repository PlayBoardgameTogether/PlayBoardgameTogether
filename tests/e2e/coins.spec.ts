import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('coin wallet persists grants, recovers lost confirmation and displays deductions', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: page.viewportSize(),
  });
  try {
    await login(page, 'stage3_a');
    await page.getByRole('link', { name: '我的资料', exact: true }).click();
    await page.getByRole('link', { name: '我的桌游币' }).click();
    await expect(page.getByRole('heading', { name: '我的桌游币' })).toBeVisible();
    await expect(page.locator('.coin-amount')).toHaveText('0');
    await expect(page.getByText('暂无流水。', { exact: false })).toBeVisible();
    await expect(page.getByText('AI 点数仅用于 AI', { exact: false })).toBeVisible();

    const admin = await context.newPage();
    await login(admin, 'stage7_admin');
    await admin.goto('/admin/accounts');
    await admin.getByLabel('搜索账户').fill('stage3_a');
    await admin.getByRole('button', { name: '搜索', exact: true }).click();
    await admin
      .getByRole('article', { name: 'stage3_a', exact: true })
      .getByRole('link', { name: '管理桌游币' })
      .click();
    await expect(admin.locator('.coin-amount')).toHaveText('0');
    await admin.getByLabel('数量', { exact: true }).fill('120');
    await admin.getByLabel('调整原因').fill('首场活动奖励');
    let lost = false;
    const ids: string[] = [];
    await admin.route('**/api/v1/admin/accounts/*/coins', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      ids.push(route.request().postDataJSON().requestId);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await admin.getByRole('button', { name: '确认调整', exact: true }).click();
    await expect(admin.getByRole('button', { name: '重试原操作' })).toBeVisible();
    await expect(admin.getByLabel('数量', { exact: true })).toBeDisabled();
    await admin.getByRole('button', { name: '重试原操作' }).click();
    await expect(admin.locator('.coin-amount')).toHaveText('120');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    await admin.unroute('**/api/v1/admin/accounts/*/coins');
    await admin.getByLabel('操作', { exact: true }).selectOption('revoke');
    await admin.getByLabel('数量', { exact: true }).fill('20');
    await admin.getByLabel('调整原因').fill('重复奖励扣回');
    await admin.getByRole('button', { name: '确认调整', exact: true }).click();
    await expect(admin.locator('.coin-amount')).toHaveText('100');
    await page.reload();
    await expect(page.locator('.coin-amount')).toHaveText('100');
    await expect(page.locator('.coin-entry')).toHaveCount(2);
    await expect(page.locator('.coin-entry').first()).toContainText('-20');
    await expect(page.locator('.coin-entry').last()).toContainText('+120');
    for (const [theme, widths] of [
      ['light', info.project.name === 'desktop' ? [1440, 1280] : [390, 320]],
      ['dark', [info.project.name === 'desktop' ? 1280 : 390]],
    ] as const) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: info.outputPath(`wallet-${theme}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await admin.emulateMedia({ reducedMotion: 'reduce' });
    await admin.evaluate(() => window.scrollTo(0, 0));
    await admin.screenshot({
      path: info.outputPath('admin-wallet.png'),
      fullPage: true,
      animations: 'disabled',
    });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '刷新钱包' }).focus();
    await expect(page.getByRole('button', { name: '刷新钱包' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.coin-amount')).toHaveText('100');
    // Real server rejection leaves both balance and history unchanged.
    await admin.getByLabel('数量', { exact: true }).fill('101');
    await admin.getByLabel('调整原因').fill('测试超额扣回');
    await admin.getByRole('button', { name: '确认调整', exact: true }).click();
    await expect(admin.getByRole('alert')).toContainText('余额不足');
    await expect(admin.locator('.coin-amount')).toHaveText('100');
    await expect(admin.locator('.coin-entry')).toHaveCount(2);
  } finally {
    await context.close();
  }
});
