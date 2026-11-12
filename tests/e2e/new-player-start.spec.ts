import { test, expect, type Page } from './fixtures.js';
import { reachable } from './ui-reachability.js';
import { readRegistrationCode } from './registration-mailbox.js';

const creation = '/games/color-match/1.0.0/new';

async function login(page: Page, username: string, password = 'stage two password') {
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

async function centerHitsSelf(page: Page) {
  return page
    .locator('.room-row button')
    .first()
    .evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === button || button.contains(hit);
    });
}

test('new registration continues exact creation and two players can join and start', async ({
  browser,
  request,
  viewport,
  isMobile,
  hasTouch,
}, info) => {
  const admin = await request.post('/api/v1/auth/login', {
    headers: { origin: 'http://127.0.0.1:5273' },
    data: { username: 'stage7_admin', password: 'stage two password' },
  });
  expect(admin.ok()).toBe(true);
  const mail = await request.put('/api/v1/admin/mail-settings', {
    headers: {
      origin: 'http://127.0.0.1:5273',
      'x-csrf-token': (await admin.json()).data.csrfToken,
    },
    data: {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      username: 'test@example.com',
      from: 'test@example.com',
      password: 'e2e-only-credential',
    },
  });
  expect(mail.ok()).toBe(true);
  const hostContext = await browser.newContext({ viewport, isMobile, hasTouch });
  const guestContext = await browser.newContext({ viewport, isMobile, hasTouch });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  host.on('pageerror', (error) => errors.push(error.message));
  guest.on('pageerror', (error) => errors.push(error.message));
  let creates = 0;
  host.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/v1/rooms') creates++;
  });
  try {
    await host.goto('/games/color-match/1.0.0');
    await host.getByRole('link', { name: '创建房间', exact: true }).click();
    await expect(host).toHaveURL('/login');
    await expect(host.getByText('登录后继续创建所选游戏的房间。')).toBeVisible();
    await host.getByRole('link', { name: '还没有账号？立即注册' }).click();
    await host.reload();
    await expect(host.getByText('注册并登录后，继续创建所选游戏的房间。')).toBeVisible();
    const email = `d9_${info.project.name}@example.test`;
    await host.getByLabel('邮箱', { exact: true }).fill(email);
    await host.getByRole('button', { name: '发送验证码', exact: true }).click();
    await expect(host.getByRole('status')).toContainText('验证码已发送');
    await host.getByLabel('邮箱验证码', { exact: true }).fill(await readRegistrationCode(email));
    await host.getByLabel('玩家昵称', { exact: true }).fill('新玩家甲');
    const userId = `d9_${info.project.name.replaceAll('-', '_')}`;
    await host.getByLabel('用户 ID', { exact: true }).fill(userId);
    await host.getByLabel('密码', { exact: true }).fill('D9Player2026');
    await host.getByLabel('确认密码', { exact: true }).fill('D9Player2026');
    await host.getByRole('button', { name: '注册账号', exact: true }).click();
    await expect(host.getByRole('status')).toHaveText('注册成功，请输入密码登录。');
    await expect(host.getByLabel('密码', { exact: true })).toHaveValue('');
    await host.reload();
    await login(host, userId, 'D9Player2026');
    await expect(host).toHaveURL(creation);
    await expect(host.getByLabel('游戏与版本')).toHaveValue('color-match@1.0.0');
    expect(creates).toBe(0);
    await host.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['light', 'dark']) {
      await host.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.style.fontSize = '200%';
      }, theme);
      for (const control of [
        host.getByLabel('房间名'),
        host.getByLabel('人数', { exact: true }),
        host.getByRole('button', { name: '创建并生成邀请码', exact: true }),
      ]) {
        await control.focus();
        await expect(control).toBeFocused();
        await reachable(control);
      }
      expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await host.screenshot({
        path: info.outputPath(`creation-enlarged-${theme}.png`),
        fullPage: true,
      });
    }
    await host.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.removeProperty('font-size');
    });
    await host.screenshot({ path: info.outputPath('continued-creation.png'), fullPage: true });
    await host.getByLabel('房间名').fill('D9 新玩家桌');
    await host.getByLabel('人数', { exact: true }).fill('2');
    await host.getByRole('button', { name: '创建并生成邀请码', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'D9 新玩家桌', exact: true })).toBeVisible();
    expect(creates).toBe(1);
    const roomPath = new URL(host.url()).pathname;
    await guest.goto('/login');
    await login(guest, 'stage2_b');
    await expect(guest).toHaveURL('/');
    await guest.locator('a.game-card[href="/games/color-match/1.0.0"]').click();
    const join = guest.locator('.room-row').getByRole('button', { name: '加入', exact: true });
    await expect(join).toBeVisible();
    if (!isMobile) {
      // The initial desktop position reproduced D8's obstruction. Also check the
      // narrower rail, themes and keyboard focus at adjacent desktop breakpoints.
      for (const width of [1440, 1280, 761]) {
        await guest.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await guest.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await join.scrollIntoViewIfNeeded();
          await expect.poll(() => centerHitsSelf(guest)).toBe(true);
          await join.focus();
          await expect(join).toBeFocused();
          expect(await centerHitsSelf(guest)).toBe(true);
          expect(
            await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      }
      await guest.setViewportSize({ width: 1440, height: 900 });
      await guest.evaluate(() => {
        document.documentElement.dataset.theme = 'light';
      });
    }
    await join.scrollIntoViewIfNeeded();
    await expect.poll(() => centerHitsSelf(guest)).toBe(true);
    await guest.screenshot({ path: info.outputPath('unobstructed-join.png'), fullPage: true });
    await join.click();
    await expect(guest).toHaveURL(roomPath);
    const seat = guest.getByRole('button', { name: '坐这里', exact: true });
    await seat.focus();
    await expect(seat).toBeFocused();
    await reachable(seat);
    await seat.click();
    await guest.getByRole('button', { name: '准备', exact: true }).click();
    await host.getByRole('button', { name: '准备', exact: true }).click();
    await expect(host.getByRole('button', { name: '开始游戏', exact: true })).toBeEnabled();
    await reachable(host.getByRole('button', { name: '开始游戏', exact: true }));
    await host.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(host.locator('.match-page[data-match-revision="0"]')).toBeVisible();
    await expect(guest.locator('.match-page[data-match-revision="0"]')).toBeVisible();
    // The match shell can render before its lazy-loaded game board. Wait for
    // both identity-specific boards before deciding which player should act.
    await expect(host.locator('.color-board')).toBeVisible();
    await expect(guest.locator('.color-board')).toBeVisible();
    const actor = (await host.getByText('轮到你行动', { exact: true }).count()) ? host : guest;
    const card = actor.locator('.color-hand-cards button:not([disabled])').first();
    if (await card.count()) {
      await card.click();
      await actor.getByRole('button', { name: '出牌', exact: true }).click();
    } else {
      await actor.getByRole('button', { name: '摸牌或跳过并结束回合', exact: true }).click();
    }
    await expect(host.locator('.match-page[data-match-revision="1"]')).toBeVisible();
    await expect(guest.locator('.match-page[data-match-revision="1"]')).toBeVisible();
    await actor.reload();
    await expect(actor.locator('.match-page[data-match-revision="1"]')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('existing login keeps creation through errors, registration back-link and refresh', async ({
  page,
}) => {
  await page.goto(creation);
  await expect(page).toHaveURL('/login');
  await login(page, 'stage2_a', 'wrong-password');
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  await page.getByRole('link', { name: '还没有账号？立即注册' }).click();
  await page.getByRole('link', { name: '已有账号？去登录' }).click();
  await page.reload();
  await login(page, 'stage2_a');
  await expect(page).toHaveURL(creation);
  await expect(page.getByLabel('游戏与版本')).toHaveValue('color-match@1.0.0');
});

test('cancel drops the intent and an unavailable exact version never changes silently', async ({
  page,
}) => {
  await page.goto(creation);
  await expect(page).toHaveURL('/login');
  await page.getByRole('link', { name: '暂不登录，回大厅逛逛' }).click();
  await page.goto('/login');
  await expect(page.getByText('登录后继续创建所选游戏的房间。')).toHaveCount(0);
  await login(page, 'stage2_a');
  await expect(page).toHaveURL('/');
  await page.context().clearCookies();
  await page.goto('/games/color-match/99.0.0/new');
  await expect(page).toHaveURL('/login');
  await login(page, 'stage2_a');
  await expect(page).toHaveURL('/games/color-match/99.0.0/new');
  await expect(page.getByRole('alert')).toHaveText('所选游戏或版本已不可用，请返回大厅重新选择。');
  await expect(page.getByRole('button', { name: '创建并生成邀请码', exact: true })).toBeDisabled();
});
