import { test, expect, type Page } from './fixtures.js';
import { badgeModelFixture } from './badge-model.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('badge collection, lost confirmation, administrator honors and public pins persist', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const adminContext = await browser.newContext({ viewport: page.viewportSize() });
  const friendContext = await browser.newContext({ viewport: page.viewportSize() });
  let modelRequests = 0;
  await page.route('**/badges/manifest.json', (route) =>
    route.fulfill({
      json: { welcome: { model: '/badges/test.glb' } },
    }),
  );
  await page.route('**/badges/test.glb*', async (route) => {
    modelRequests += 1;
    if (modelRequests === 1) return route.abort('failed');
    await route.fulfill({ contentType: 'model/gltf-binary', body: badgeModelFixture() });
  });
  try {
    const admin = await adminContext.newPage();
    const friend = await friendContext.newPage();
    await login(page, 'stage3_a');
    await page.getByRole('link', { name: '我的资料', exact: true }).click();
    await page.getByRole('link', { name: '我的徽章 →', exact: true }).click();
    const welcome = page.getByRole('article', { name: '初来乍到', exact: true });
    await expect(welcome).toContainText('已获得');
    const preview = welcome.getByRole('button', { name: '查看初来乍到的 3D 模型' });
    await expect(preview).toBeVisible();
    await expect(page.getByRole('button', { name: '查看初试身手的 3D 模型' })).toHaveCount(0);
    expect(modelRequests).toBe(0);
    await preview.click();
    const modelDialog = page.getByRole('dialog', { name: '初来乍到', exact: true });
    await expect(modelDialog.getByRole('alert')).toContainText('普通徽章仍可使用');
    await modelDialog.getByRole('button', { name: '重试加载' }).click();
    await expect(modelDialog).toContainText('拖动或使用方向键旋转', { timeout: 30_000 });
    expect(modelRequests).toBe(2);
    const viewer = modelDialog.locator('model-viewer');
    await expect(viewer).toHaveAttribute('camera-controls', '');
    await expect(viewer).not.toHaveAttribute('auto-rotate');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of info.project.name === 'desktop' ? [1440, 1280] : [390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.screenshot({
        path: info.outputPath(`badge-model-${width}.png`),
        animations: 'disabled',
      });
      expect(
        await modelDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(modelDialog).toHaveCount(0);
    await expect(preview).toBeFocused();
    await expect(page.locator('model-viewer')).toHaveCount(0);
    await expect(
      page.getByRole('article', { name: '初试身手', exact: true }).getByRole('checkbox'),
    ).toBeDisabled();
    await welcome.getByRole('checkbox').focus();
    await page.keyboard.press('Space');
    await expect(welcome.getByRole('checkbox')).toBeChecked();
    let lost = false;
    const requestIds: string[] = [];
    await page.route('**/api/v1/profile/badges', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      requestIds.push(route.request().postDataJSON().requestId);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '保存展示（1/3）', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试原操作', exact: true })).toBeVisible();
    await expect(welcome.getByRole('checkbox')).toBeDisabled();
    await page.getByRole('button', { name: '重试原操作', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('展示徽章已保存');
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    await page.unroute('**/api/v1/profile/badges');
    await page.reload();
    await expect(welcome.getByRole('checkbox')).toBeChecked();
    await page.getByRole('button', { name: '已获得', exact: true }).click();
    await expect(page.locator('.badge-card')).toHaveCount(1);
    await page.getByRole('button', { name: '全部', exact: true }).click();

    await login(admin, 'stage7_admin');
    await admin.goto('/admin/accounts');
    await admin.getByLabel('搜索账户').fill('stage3_a');
    await admin.getByRole('button', { name: '搜索', exact: true }).click();
    await admin
      .getByRole('article', { name: 'stage3_a', exact: true })
      .getByRole('link', { name: '管理徽章' })
      .click();
    await expect(admin.getByRole('heading', { name: '玩家 D的徽章', exact: true })).toBeVisible();
    for (const name of ['内测玩家', '社区贡献者', '活动荣誉']) {
      await admin
        .getByRole('article', { name, exact: true })
        .getByRole('button', { name: '授予徽章' })
        .click();
      await expect(
        admin.getByRole('article', { name, exact: true }).getByRole('button', { name: '收回徽章' }),
      ).toBeEnabled();
    }
    await page.reload();
    await page
      .getByRole('article', { name: '内测玩家', exact: true })
      .getByRole('checkbox')
      .check();
    await page
      .getByRole('article', { name: '社区贡献者', exact: true })
      .getByRole('checkbox')
      .check();
    await expect(
      page.getByRole('article', { name: '活动荣誉', exact: true }).getByRole('checkbox'),
    ).toBeDisabled();
    await page.getByRole('button', { name: '保存展示（3/3）', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('展示徽章已保存');
    for (const width of info.project.name === 'desktop' ? [1440, 1280] : [390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`badges-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.locator('.nav-tools summary').click();
    await page.getByLabel('外观', { exact: true }).selectOption('dark');
    await page.locator('.nav-tools summary').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({
      path: info.outputPath('badges-dark.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await admin.screenshot({
      path: info.outputPath('admin-badges.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.goto('/chat');
    const composer = page.locator('.public-chat-page').first();
    await composer.getByLabel('公共消息', { exact: true }).fill('一起收藏桌游时光');
    await composer.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(composer.getByLabel('公共消息', { exact: true })).toHaveValue('');
    await login(friend, 'stage3_b');
    await friend.goto('/chat');
    await friend
      .locator('.public-chat-page')
      .first()
      .getByLabel('查看 玩家 D 的名片', { exact: true })
      .click();
    await expect(friend.getByRole('dialog').getByLabel('精选徽章')).toContainText('内测玩家');
    await expect(friend.getByRole('dialog').getByLabel('精选徽章').locator('li')).toHaveCount(3);
    await friend.keyboard.press('Escape');
    await expect(friend.getByRole('dialog')).toBeHidden();

    await admin
      .getByRole('article', { name: '内测玩家', exact: true })
      .getByRole('button', { name: '收回徽章' })
      .click();
    await expect(admin.getByRole('alert')).toContainText('徽章已变化');
    await admin.getByRole('button', { name: '刷新徽章', exact: true }).click();
    await admin
      .getByRole('article', { name: '内测玩家', exact: true })
      .getByRole('button', { name: '收回徽章' })
      .click();
    await expect(
      admin
        .getByRole('article', { name: '内测玩家', exact: true })
        .getByRole('button', { name: '授予徽章' }),
    ).toBeEnabled();
    await page.goto('/profile');
    const shelf = page.getByLabel('精选徽章');
    await expect(shelf.locator('li')).toHaveCount(2);
    await expect(shelf).not.toContainText('内测玩家');
    await page.reload();
    await expect(shelf).toContainText('社区贡献者');
    const pinPreview = shelf.getByRole('button', { name: '查看初来乍到的 3D 模型' });
    await pinPreview.click();
    await expect(page.getByRole('dialog')).toContainText('拖动或使用方向键旋转', {
      timeout: 30_000,
    });
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(pinPreview).toBeFocused();
  } finally {
    await adminContext.close();
    await friendContext.close();
  }
});

test('administrator designs, revises and disables a custom badge on desktop and mobile', async ({
  page,
}, info) => {
  await login(page, 'stage7_admin');
  await page.goto('/admin');
  await page.getByRole('link', { name: '徽章设计', exact: true }).click();
  await expect(page.getByRole('heading', { name: '徽章设计', exact: true })).toBeVisible();
  const name = `相聚纪念-${info.project.name}`;
  await page.getByLabel('徽章名称', { exact: true }).fill(name);
  await page.getByLabel('徽章说明', { exact: true }).fill('感谢一起探索更多桌游');
  await page.getByLabel('徽章符号', { exact: true }).fill('🎲');
  await page.getByLabel('授予方式', { exact: true }).selectOption('automatic');
  await page.getByLabel('目标 1', { exact: true }).fill('2');
  await page.getByRole('button', { name: '添加条件', exact: true }).click();
  await page.getByLabel('条件 2', { exact: true }).selectOption('gameFinished');
  await page.getByLabel('指定游戏 2', { exact: true }).selectOption('color-match');
  await page.getByLabel('条件组合', { exact: true }).selectOption('any');
  await expect(page.getByLabel('规则预览')).toContainText('满足任一条件');
  let lost = false;
  const ids: string[] = [];
  await page.route('**/api/v1/admin/badges', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    ids.push(route.request().postDataJSON().requestId);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存徽章设计', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试原操作', exact: true })).toBeVisible();
  await expect(page.getByLabel('徽章名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试原操作', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('徽章设计已保存');
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await page.unroute('**/api/v1/admin/badges');
  await page.reload();
  await page.getByRole('button', { name: `编辑${name}`, exact: true }).click();
  await expect(page.getByLabel('授予方式', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('目标 1', { exact: true })).toHaveValue('2');
  for (const width of info.project.name === 'desktop' ? [1440, 1280] : [390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`badge-designer-${width}.png`), fullPage: true });
  }
  await page.getByLabel('启用徽章', { exact: true }).uncheck();
  await page.getByRole('button', { name: '保存徽章设计', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('徽章设计已保存');
  await expect(page.getByRole('article', { name, exact: true })).toContainText('已停用');
  await page.goto('/profile/badges');
  await expect(page.getByRole('heading', { name: '我的徽章', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name, exact: true })).toHaveCount(0);
});
