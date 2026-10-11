import { openRoomCreation, openInviteJoin } from './fixtures.js';
import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(user);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByLabel('密码', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('themed picker keeps keyboard selection and motion respects system preference', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/dev/ui');
  const scenes = page.getByRole('combobox', { name: '场景', exact: true });
  await scenes.selectOption('create');
  const game = page.getByRole('combobox', { name: '游戏与版本', exact: true });
  await game.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(game).toHaveValue('Grid Garden · 1.0.0');
  await expect(game).toBeFocused();
  await game.click();
  await expect(game).toHaveCSS('appearance', 'base-select');
  await expect(game.locator('option').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath(`picker-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(game).toBeFocused();
  await noOverflow(page);
  expect(await game.evaluate(element => getComputedStyle(element).color)).toBe('rgb(242, 242, 243)');
  await scenes.selectOption('color-long');
  const card = page.locator('.color-hand-cards button:not([disabled])').first();
  await card.click();
  await expect(card).toHaveClass(/color-card--selected/);
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, -6)');
  await page.screenshot({ path: info.outputPath(`selection-${info.project.name}.png`), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await card.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  expect(await card.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await scenes.selectOption('create');
  expect(await page.locator('.auth-card').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('dashboard distinguishes failed loading and clipboard failure offers selectable text', async ({ page }, info) => {
  await page.goto('/login');
  await page.screenshot({ path: info.outputPath(`login-${info.project.name}.png`), fullPage: true });
  await login(page, 'stage3_a');
  await page.route('**/api/v1/rooms', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'temporary', retryable: true }, traceId: 'stage9-load' }) }));
  await page.reload();
  await expect(page.getByRole('heading', { name: '房间加载失败' })).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('还没有房间。', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/rooms');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`lobby-${info.project.name}.png`), fullPage: true });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await openRoomCreation(page);
  await page.getByLabel('游戏与版本').selectOption('grid-garden@1.0.0');
  await page.getByLabel('房间名', { exact: true }).fill('匿名体验检查');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await page.getByRole('button', { name: '复制邀请码' }).click();
  const manual = page.getByLabel('手动复制邀请码');
  await expect(manual).toBeVisible();
  await manual.focus();
  expect(await manual.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe(12);
  await noOverflow(page);
});

test('theme text contrast, touch targets and disclosure keyboard focus meet project thresholds', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/dev/ui');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('garden-start');
  const measured = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const luminance = (color: string) => {
      const values = color.replace('#', '').match(/../g)!.map(value => parseInt(value, 16) / 255);
      const linear = values.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
    };
    const ratio = (left: string, right: string) => {
      const a = luminance(left.trim()), b = luminance(right.trim());
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    return {
      body: ratio(css.getPropertyValue('--text'), css.getPropertyValue('--panel')),
      muted: ratio(css.getPropertyValue('--muted'), css.getPropertyValue('--panel')),
      controlBorder: ratio(css.getPropertyValue('--control-line'), css.getPropertyValue('--bg')),
      surfaces: ['--bg', '--panel', '--panel-raised'].map(name => css.getPropertyValue(name).trim()),
      touch: [...document.querySelectorAll<HTMLButtonElement>('.garden-choice-actions button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
    };
  });
  expect(measured.body).toBeGreaterThanOrEqual(4.5);
  expect(measured.muted).toBeGreaterThanOrEqual(4.5);
  expect(measured.controlBorder).toBeGreaterThanOrEqual(3);
  expect(measured.surfaces).toEqual(['#1c1c1e', '#2c2c2e', '#3a3a3c']);
  for (const target of measured.touch) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  const more = page.locator('.nav-tools summary');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: '界面场景', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(more).toBeFocused();
});

test('development scenes fit viewport matrix and keyboard drafts never send actions', async ({ page }, info) => {
  test.setTimeout(120_000);
  const actionRequests: string[] = [];
  page.on('request', request => { if (/\/actions|model-profiles|\/rooms/.test(request.url()) && request.method() !== 'GET') actionRequests.push(request.url()); });
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: '界面固定场景' })).toBeVisible();
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(page.locator('.brand-name')).toBeVisible();
    for (const scene of ['room-four', 'color-long', 'color-target', 'garden-place', 'garden-saved', 'garden-tie', 'conflict', 'offline']) {
      await page.getByRole('combobox', { name: '场景', exact: true }).selectOption(scene);
      await noOverflow(page);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`fixture-${scene}-${width}-${info.project.name}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('garden-start');
  await page.getByRole('button', { name: '建造 -1' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '确认选择' })).toBeVisible();
  await page.getByRole('button', { name: '取消选择' }).click();
  await expect(page.getByRole('button', { name: '确认选择' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('garden-place');
  const cell = page.getByRole('grid', { name: '我的4乘4花园' }).getByRole('gridcell', { name: /^A1/ });
  await cell.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByText('A2 · 横向', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '纵向 V' }).click();
  await expect(page.getByRole('button', { name: '确认放置' })).toBeEnabled();
  await page.getByRole('button', { name: '确认放置' }).click();
  await expect(page.getByText(/开发演示：已记录点击/)).toBeVisible();
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('color-long');
  await page.locator('.color-hand-cards button:not([disabled])').first().click();
  await expect(page.getByRole('button', { name: '取消选择' })).toBeVisible();
  await page.getByRole('button', { name: '取消选择' }).click();
  await expect(page.getByRole('button', { name: '出牌', exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.body.style.fontSize = '200%'; });
  await noOverflow(page);
  await expect(page.getByRole('button', { name: '摸牌或跳过并结束回合' })).toBeVisible();
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('render-error');
  await expect(page.getByRole('heading', { name: '游戏界面暂时无法显示' })).toBeVisible();
  await expect(page.getByRole('link', { name: '游戏大厅', exact: true })).toBeVisible();
  expect(actionRequests).toEqual([]);
});

test('four real accounts finish three harvest rounds with private choices and a four-way tie', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext(info.project.use)));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  try {
    for (const [index, user] of ['stage3_a', 'stage3_b', 'stage2_a', 'stage2_b'].entries()) await login(pages[index]!, user);
    const host = pages[0]!;
    await openRoomCreation(host);
    await host.getByLabel('游戏与版本').selectOption('grid-garden@1.0.0');
    await host.getByLabel('人数', { exact: true }).fill('4');
    await host.getByLabel('房间名', { exact: true }).fill('四人花园');
    await host.getByRole('button', { name: '创建并生成邀请码' }).press('Enter');
    const invite = await host.locator('.invite-box strong').textContent();
    for (const guest of pages.slice(1)) {
      await openInviteJoin(guest); await guest.getByLabel('12 位邀请码').fill(invite!);
      await guest.getByRole('button', { name: '加入私人房间' }).press('Enter');
      await expect(guest.getByRole('button', { name: '坐这里' }).first()).toBeEnabled();
      await guest.getByRole('button', { name: '坐这里' }).first().press('Enter');
      await expect(guest.getByRole('button', { name: '准备', exact: true })).toBeVisible();
    }
    for (const guest of pages.slice(1)) {
      await guest.getByRole('button', { name: '准备', exact: true }).press('Enter');
      await expect(guest.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    }
    await expect(host.locator('.seat-card').filter({ hasText: '未准备' })).toHaveCount(1);
    await host.getByRole('button', { name: '准备', exact: true }).press('Enter');
    await expect(host.getByRole('button', { name: '开始游戏' })).toBeEnabled();
    await host.screenshot({ path: info.outputPath(`room-four-${info.project.name}.png`), fullPage: true, mask: [host.locator('.invite-box')] });
    await host.getByRole('button', { name: '开始游戏' }).press('Enter');
    for (const round of [1, 2, 3]) {
      for (const [index, page] of pages.entries()) {
        await expect(page.getByText(`第 ${round} / 3 轮`)).toBeVisible();
        await expect(page.getByText(`对局 · revision ${(round - 1) * 4 + index}`)).toBeVisible();
        await expect(page.getByRole('button', { name: '收获 +2' })).toBeEnabled();
        await page.getByRole('button', { name: '收获 +2' }).press('Enter');
        await page.getByRole('button', { name: '确认选择' }).press('Enter');
        if (index < 3) await expect(page.getByText(/你的选择已锁定：收获 \+2/)).toBeVisible();
        if (index === 0) {
          await expect(page.getByText(/等待 3 位玩家：/)).toBeVisible();
          const other = await pages[1]!.evaluate(async () => (await (await fetch(`/api/v1/matches/${location.pathname.split('/').at(-1)}/view`)).json()).data.view);
          expect(other.myChoice).toBeNull();
          expect(other.revealedChoices).toBeNull();
          await page.screenshot({ path: info.outputPath(`multiple-waiting-${round}-${info.project.name}.png`), fullPage: true });
        }
      }
    }
    for (const page of pages) {
      await expect(page).toHaveURL(/\/rooms\//);
      await page.getByRole('link', { name: '查看本局结果' }).click();
      await expect(page.getByRole('heading', { name: '最终得分' })).toBeVisible();
      await expect(page.locator('.garden-results:not(.garden-events) li')).toHaveCount(4);
      for (const seat of [1, 2, 3, 4]) await expect(page.getByText(`座位 ${seat}：4 分（占格 0 + 能量 4） · 获胜`)).toBeVisible();
      await noOverflow(page);
    }
    await host.screenshot({ path: info.outputPath(`tie-real-${info.project.name}.png`), fullPage: true });
  } finally { for (const context of contexts) await context.close(); }
});
