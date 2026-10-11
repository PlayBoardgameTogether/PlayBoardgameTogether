import { openRoomCreation, openInviteJoin } from './fixtures.js';
import { expect, test } from './fixtures.js';

test('Grid Garden completes three simultaneous rounds with script placement', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await openRoomCreation(page);
  await page.getByLabel('游戏与版本').selectOption('grid-garden@1.0.0');
  await page.getByLabel('房间名').fill(`Grid Garden ${test.info().project.name}`);
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page.getByRole('link', { name: '返回游戏详情', exact: false })).toHaveAttribute('href', '/games/grid-garden/1.0.0');
  await page.getByRole('button', { name: '添加脚本 AI' }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始游戏' })).toBeEnabled();
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect(page.getByRole('heading', { name: 'Grid Garden', exact: true })).toBeVisible();
  await expect(page.getByRole('grid', { name: '我的4乘4花园' })).toBeVisible();
  const table = page.getByRole('region', { name: '游戏桌', exact: true });
  const support = page.getByRole('complementary', { name: '对局辅助', exact: true });
  const tableBox = (await table.boundingBox())!, supportBox = (await support.boundingBox())!;
  if (testInfo.project.name === 'desktop') {
    expect(tableBox.width).toBeGreaterThan(supportBox.width * 2);
    expect(supportBox.x).toBeGreaterThan(tableBox.x);
  } else {
    expect(supportBox.y).toBeGreaterThan(tableBox.y + tableBox.height - 1);
  }
  await page.screenshot({ path: testInfo.outputPath('game-first-layout.png'), fullPage: true });
  async function submitAndWait(round: number, choice: 'harvest' | 'build') {
    const next = round < 3 ? page.getByText(`第 ${round + 1} / 3 轮`) : page.getByRole('region', { name: '本局已结束', exact: true });
    const choiceButton = page.getByRole('button', { name: choice === 'build' ? '建造 -1' : '收获 +2' });
    for (let attempt = 0; attempt < 8; attempt++) {
      if (await next.isVisible().catch(() => false)) return;
      const confirm = page.getByRole('button', { name: '确认操作结果' });
      if (await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
        await confirm.click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        continue;
      }
      if (await choiceButton.isVisible().catch(() => false) && await choiceButton.isEnabled().catch(() => false)) await choiceButton.click();
      const confirmChoice = page.getByRole('button', { name: '确认选择' });
      if (await confirmChoice.isVisible().catch(() => false) && await confirmChoice.isEnabled().catch(() => false)) await confirmChoice.click();
      if (choice === 'build' && await page.getByRole('heading', { name: '花园建造' }).isVisible().catch(() => false)) {
        await page.getByRole('grid', { name: '我的4乘4花园' }).getByRole('gridcell', { name: /^A1/ }).click();
        await expect(page.getByText(/A1 · 横向/)).toBeVisible();
        await page.getByRole('button', { name: '确认放置' }).click();
      }
      await Promise.race([next.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined), page.waitForTimeout(500)]);
    }
    await expect(next).toBeVisible({ timeout: 20_000 });
  }
  for (let round = 1; round <= 3; round++) {
    await expect(page.getByRole('heading', { name: '秘密选择' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`第 ${round} / 3 轮`)).toBeVisible();
    await submitAndWait(round, round === 1 ? 'build' : 'harvest');
  }
  await expect(page).toHaveURL(/\/rooms\//, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '查看本局结果' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '最终得分' })).toBeVisible();
  await expect(page.getByRole('list').getByText(/获胜/)).toBeVisible();
  await expect(page.locator('.garden-results').getByText(/^第 1 轮/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('grid-garden-finished.png'), fullPage: true });
});

test('two human gardens preserve conflict drafts, private choices and keyboard placement', async ({ browser, viewport, isMobile, hasTouch, deviceScaleFactor }, testInfo) => {
  test.setTimeout(120_000);
  const device = { viewport, isMobile, hasTouch, deviceScaleFactor };
  const first = await browser.newContext(device);
  const second = await browser.newContext(device);
  const a = await first.newPage();
  const b = await second.newPage();
  let releaseHeldRequest: (() => void) | undefined;
  try {
    for (const [page, username] of [[a, 'stage3_a'], [b, 'stage3_b']] as const) {
      await page.goto('/login');
      await page.getByLabel('用户名').fill(username);
      await page.getByLabel('密码').fill('stage two password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
    }
    await openRoomCreation(a);
    await a.getByLabel('游戏与版本').selectOption('grid-garden@1.0.0');
    await a.getByLabel('房间名').fill('双人花园交互验收');
    await a.getByRole('button', { name: '创建并生成邀请码' }).click();
    const invite = await a.locator('.invite-box strong').textContent();
    await openInviteJoin(b); await b.getByLabel('12 位邀请码').fill(invite!);
    await b.getByRole('button', { name: '加入私人房间' }).click();
    await b.getByRole('button', { name: '坐这里' }).click();
    await b.getByRole('button', { name: '准备', exact: true }).click();
    await expect(a.getByText(/已准备 ·/)).toBeVisible();
    await a.getByRole('button', { name: '准备', exact: true }).click();
    await a.getByRole('button', { name: '开始游戏' }).click();
    for (const page of [a, b]) {
      await expect(page.getByRole('button', { name: '建造 -1' })).toBeEnabled();
    }
    // Hold A's real revision-0 request until B has committed revision 1.
    let releaseRequest!: () => void;
    let capturedRequest!: () => void;
    const gate = new Promise<void>(resolve => { releaseRequest = resolve; });
    releaseHeldRequest = releaseRequest;
    const captured = new Promise<void>(resolve => { capturedRequest = resolve; });
    await a.route('**/api/v1/matches/*/actions', async route => {
      capturedRequest();
      await gate;
      await route.continue();
    }, { times: 1 });
    await a.getByRole('button', { name: '建造 -1' }).click();
    await a.getByRole('button', { name: '确认选择' }).click();
    await captured;
    await b.getByRole('button', { name: '建造 -1' }).click();
    await b.getByRole('button', { name: '确认选择' }).click();
    await expect(b.getByText(/你的选择已锁定：建造 -1/)).toBeVisible();
    await b.reload();
    await expect(b.getByText(/你的选择已锁定：建造 -1/)).toBeVisible();
    await expect(a.getByText(/你的选择已锁定/)).toHaveCount(0);
    const aView = await a.evaluate(async () => {
      const matchId = location.pathname.split('/').at(-1);
      return (await (await fetch(`/api/v1/matches/${matchId}/view`)).json()).data.view;
    });
    expect(aView.myChoice).toBeNull();
    expect(aView.revealedChoices).toBeNull();
    expect(aView).not.toHaveProperty('choices');
    releaseRequest();
    releaseHeldRequest = undefined;
    await expect(a.getByRole('alert')).toContainText('局面已变化');
    await expect(a.getByText(/待确认草稿：建造/)).toBeVisible();
    await a.screenshot({ path: testInfo.outputPath('conflict-real.png'), fullPage: true });
    await expect(a.getByRole('button', { name: '建造 -1' })).toHaveAttribute('aria-pressed', 'true');
    await a.getByRole('button', { name: '建造 -1' }).click();
    await a.getByRole('button', { name: '确认选择' }).click();
    for (const page of [a, b]) await expect(page.getByRole('heading', { name: '花园建造' })).toBeVisible();
    const grid = a.getByRole('grid', { name: '我的4乘4花园' });
    await grid.getByRole('gridcell', { name: /^D4/ }).click();
    await expect(a.getByText('骨牌超出棋盘边界，请更换起点或方向。')).toBeVisible();
    await expect(a.getByRole('button', { name: '确认放置' })).toBeDisabled();
    await a.getByRole('button', { name: '纵向 V' }).click();
    const origin = grid.getByRole('gridcell', { name: /^A1/ });
    await origin.focus();
    await origin.press('ArrowRight');
    await expect(grid.getByRole('gridcell', { name: /^B1/ })).toBeFocused();
    await grid.getByRole('gridcell', { name: /^B1/ }).press('Enter');
    await expect(a.getByText('B1 · 纵向')).toBeVisible();
    await b.getByRole('grid', { name: '我的4乘4花园' }).getByRole('gridcell', { name: /^A1/ }).click();
    await b.getByRole('button', { name: '确认放置' }).click();
    await expect(a.getByText('对局 · revision 3')).toBeVisible();
    await expect(a.getByText('B1 · 纵向')).toBeVisible();
    await a.screenshot({ path: testInfo.outputPath('garden-keyboard-preview.png'), fullPage: true });
    await a.screenshot({ path: testInfo.outputPath('garden-preview-real.png'), fullPage: true });
    await a.getByRole('button', { name: '确认放置' }).click();
    for (const round of [2, 3]) {
      for (const page of [a, b]) await expect(page.getByText(`第 ${round} / 3 轮`)).toBeVisible();
      await a.getByRole('button', { name: '建造 -1' }).click();
    await a.getByRole('button', { name: '确认选择' }).click();
      await expect(b.getByText(`对局 · revision ${round === 2 ? 5 : 8}`)).toBeVisible();
      await b.getByRole('button', { name: '收获 +2' }).click();
    await b.getByRole('button', { name: '确认选择' }).click();
      await expect(a.getByRole('heading', { name: '花园建造' })).toBeVisible();
      await grid.getByRole('gridcell', { name: /^B1/ }).click();
      await expect(a.getByText('骨牌与已有棋子重叠，请选择两个相邻空格。')).toBeVisible();
      await expect(a.getByRole('button', { name: '确认放置' })).toBeDisabled();
      await grid.getByRole('gridcell', { name: round === 2 ? /^C1/ : /^D1/ }).click();
      await a.getByRole('button', { name: '确认放置' }).click();
    }
    for (const page of [a, b]) {
      await expect(page).toHaveURL(/\/rooms\//);
      await page.getByRole('link', { name: '查看本局结果' }).click();
      await expect(page.getByRole('heading', { name: '最终得分' })).toBeVisible();
      await expect(page.getByText('座位 1：6 分（占格 6 + 能量 0） · 获胜')).toBeVisible();
      await expect(page.getByText('座位 2：5 分（占格 2 + 能量 3）')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await a.screenshot({ path: testInfo.outputPath('garden-human-finished.png'), fullPage: true });
    await a.screenshot({ path: testInfo.outputPath('garden-finished-real.png'), fullPage: true });
  } finally {
    releaseHeldRequest?.();
    await first.close();
    await second.close();
  }
});
