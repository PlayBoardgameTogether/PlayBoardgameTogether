import { openRoomCreation } from './fixtures.js';
import { expect, test } from './fixtures.js';
import { decideBasicSplendor } from '../../games/splendor/src/server/index.js';
import { names, viewSchema } from '../../games/splendor/src/shared/index.js';

test('璀璨宝石：真人与脚本AI完成整局、私密预留刷新保留、手机无溢出', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  await openRoomCreation(page);
  await page.getByLabel('游戏与版本').selectOption('splendor.base@1.0.0');
  await page.getByLabel('房间名').fill('宝石商会 ' + testInfo.project.name);
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page.locator('.room-heading').getByText(/璀璨宝石/)).toBeVisible();
  await page.getByRole('button', { name: '添加脚本 AI' }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect(page.getByRole('heading', { name: '璀璨宝石', exact: true, level: 2 })).toBeVisible();
  const table = page.getByRole('region', { name: '璀璨宝石游戏桌' });
  await expect(table.locator('.sp-player').first()).toContainText('玩家 D（你）的商会');
  await expect(table.locator('.sp-player').nth(1)).toContainText('电脑 2的商会');
  expect(await table.locator('header').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByRole('group', { name: '拿取方式' })).toHaveCount(0);
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1366, height: 768 });
    const layout = await table.evaluate(element => {
      const rect = (selector: string) => {
        const item = element.querySelector(selector)!;
        const bounds = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, margin: style.margin, padding: style.padding, gap: style.gap };
      };
      return { viewport: window.innerHeight, table: element.getBoundingClientRect().top, header: rect('.sp-heading'), status: rect('.sp-status'), bank: rect('.sp-bank'), nobles: rect('.sp-nobles'), market: rect('.sp-market'), card: rect('.sp-card'), art: rect('.sp-card-face, .sp-art') };
    });
    await page.screenshot({ path: '.data/e2e-splendor-ui/compact-' + testInfo.project.name + '-svg.png' });
    expect(layout.market.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const gem = (color: keyof typeof names) => page.getByRole('button', { name: new RegExp('^' + names[color] + '库存 ') });
  await gem('gold').click();
  await expect(table.getByRole('alert')).toContainText('黄金不能直接拿取');
  await gem('white').click();
  await gem('white').click();
  await expect(gem('white')).toContainText('已选 2');
  await expect(page.getByRole('button', { name: '确认拿取', exact: true })).toBeEnabled();
  await gem('blue').click();
  await expect(table.getByRole('alert')).toContainText('两枚同色不能混拿');
  await expect(gem('blue')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '清空宝石', exact: true }).click();
  for (const color of ['white', 'blue', 'green'] as const) await gem(color).click();
  await expect(page.getByRole('button', { name: '确认拿取', exact: true })).toBeEnabled();
  await gem('red').click();
  await expect(table.getByRole('alert')).toContainText('最多拿三种');
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  const firstCard = page.getByRole('region', { name: '发展卡市场' }).getByRole('button', { name: /card\./ }).first();
  await firstCard.focus();
  await firstCard.press('Enter');
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
  const confirmation = page.getByRole('region', { name: '确认本回合操作' });
  await expect(confirmation).toBeVisible();
  await firstCard.press('Escape');
  await expect(firstCard).toHaveAttribute('aria-pressed', 'false');
  await firstCard.press('Enter');
  await expect(confirmation).toBeVisible();
  expect(await confirmation.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.width <= window.innerWidth;
  })).toBe(true);
  await page.screenshot({ path: '.data/e2e-splendor-ui/decision-' + testInfo.project.name + '.png' });
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(firstCard).toHaveAttribute('aria-pressed', 'false');
  const matchId = new URL(page.url()).pathname.split('/').at(-1)!;
  const snapshot = async () => page.evaluate(async id => {
    const response = await fetch('/api/v1/matches/' + id + '/view');
    return (await response.json()).data;
  }, matchId);
  await expect(page.getByRole('button', { name: /^盲抽3级牌堆/ })).toBeEnabled();
  await page.getByRole('button', { name: /^盲抽3级牌堆/ }).click();
  await page.getByRole('button', { name: '确认盲抽预留' }).click();
  await expect.poll(async () => (await snapshot()).view.myReserved.length).toBe(1);
  await expect(page.getByRole('region', { name: '公开行动记录' })).toContainText('玩家 D（你）盲抽预留了一张卡');
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1366, height: 768 });
    expect(await page.getByRole('region', { name: '发展卡市场' }).evaluate(element => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  // Wait for the opponent's live action before testing that reload does not replay it.
  await expect.poll(async () => {
    const data = await snapshot();
    return data.view.currentSeatId === data.view.viewingSeatId;
  }).toBe(true);
  const reservedId = (await snapshot()).view.myReserved[0].id;
  await page.reload();
  await expect(page.getByRole('region', { name: '我的预留卡' }).getByRole('button', { name: new RegExp(reservedId.replaceAll('.', '\\.')) })).toBeVisible();
  expect((await snapshot()).view.myReserved[0].id).toBe(reservedId);
  await expect(table.locator('.sp-action-reveal')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: '.data/e2e-splendor-ui/table-' + testInfo.project.name + '.png', fullPage: true });

  let opponentBuys = 0;
  let sawOpponentBuy = false;
  for (let step = 0; step < 250; step++) {
    await expect.poll(async () => {
      const data = await snapshot();
      return data.view.phase === 'finished' || data.view.currentSeatId === data.view.viewingSeatId;
    }, { timeout: 20_000 }).toBe(true);
    const data = await snapshot(), view = viewSchema.parse(data.view);
    if (view.phase === 'finished') break;
    const bought = view.players[view.seats[1]!]!.purchased.length;
    if (bought > opponentBuys) {
      await expect(page.getByRole('region', { name: '公开行动记录' })).toContainText('电脑 2购买了发展卡');
      if (!sawOpponentBuy) {
        const reveal = table.locator('.sp-action-reveal');
        await expect(reveal).toContainText('电脑 2购买了发展卡');
        await expect.poll(() => reveal.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
        expect(await reveal.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const header = document.querySelector('.site-header')!.getBoundingClientRect();
          return bounds.top >= header.bottom && bounds.bottom <= innerHeight && bounds.right <= innerWidth;
        })).toBe(true);
        await page.screenshot({ path: '.data/e2e-splendor-ui/opponent-' + testInfo.project.name + '-svg.png' });
      }
      sawOpponentBuy = true;
    }
    opponentBuys = bought;
    // Reload every new human decision to exercise authoritative recovery, rather than replaying a stale command.
    await page.reload();
    const action = decideBasicSplendor({ view, legalActions: view.legalActions });
    if (!action) throw new Error('Human turn has no legal decision');
    const response = page.waitForResponse(result => result.url().endsWith('/matches/' + matchId + '/actions') && result.request().method() === 'POST');
    if (action.type === 'take') {
      for (const color of action.colors)
        await page.getByRole('button', { name: new RegExp('^' + names[color] + '库存 ') }).click();
      await page.getByRole('button', { name: '确认拿取' }).click();
    } else if (action.type === 'buy' || action.type === 'reserve') {
      const cardId = action.cardId;
      const card = page.getByRole('button', { name: new RegExp(cardId.replaceAll('.', '\\.') + '$') });
      await card.click();
      await page.getByRole('button', { name: action.type === 'buy' ? '确认购买' : '确认预留', exact: true }).click();
    } else if (action.type === 'reserve_deck') {
      await page.getByRole('button', { name: new RegExp('^盲抽' + action.tier + '级牌堆') }).click();
      await page.getByRole('button', { name: '确认盲抽预留' }).click();
    } else if (action.type === 'return') {
      await page.getByRole('button', { name: new RegExp('^退回' + names[action.color] + ' ') }).click();
    } else if (action.type === 'noble') {
      const nobleId = action.nobleId;
      const noble = view.nobles.find(item => item.id === nobleId)!;
      await page.getByRole('button', { name: '选择贵族 ' + noble.name, exact: true }).click();
    } else {
      await page.getByRole('button', { name: '无可用行动，跳过回合' }).click();
    }
    expect((await response).status()).toBe(200);
  }
  expect(sawOpponentBuy).toBe(true);
  await expect(page).toHaveURL(/\/rooms\//, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '查看本局结果' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '最终结算' })).toBeVisible();
  expect((await snapshot()).view.outcome.status).toBe('finished');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: '.data/e2e-splendor-ui/finished-' + testInfo.project.name + '.png', fullPage: true });
});
