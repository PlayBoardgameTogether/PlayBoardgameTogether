import { sessionFixture } from '../fixtures/session.js';
import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import type { SocialOverview } from '@boardgame/protocol';

const me = '10000000-0000-4000-8000-000000000001';
const friend = '10000000-0000-4000-8000-000000000002';
const messageId = '10000000-0000-4000-8000-000000000003';
const timestamp = '2026-10-04T00:00:00.000Z';
async function fixture(page: Page) {
  let guest = false;
  let reads = 0;
  let arrivals = 0;
  let publicReads = 0;
  const updates: Array<{ version: string | null; changed: boolean }> = [];
  let overview: SocialOverview = {
    identity: { friendId: 'alice', revision: 1, changeIntervalDays: 30, nextChangeAt: null, canChange: true },
    friends: [{ person: { id: friend, friendId: 'bob', displayName: '桌友小明', avatar: 'cat' }, status: 'accepted', direction: 'incoming', revision: 1, unread: 0 }],
    requests: [], invitations: [],
  };
  let profile = { id: me, username: 'alice', displayName: '桌友小红', avatar: 'dice', bio: '周末一起玩', createdAt: timestamp };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, traceId: 'social-ui', data } });
    if (path === '/auth/logout') { guest = true; return ok({ loggedOut: true }); }
    if (guest) return route.fulfill({ status: 401, json: { ok: false, traceId: 'social-ui', error: { code: 'UNAUTHENTICATED', message: '请登录', retryable: false } } });
    if (path === '/auth/me') return ok(sessionFixture({ id: me, displayName: profile.displayName }));
    if (path === '/social') return ok(overview);
    if (path === '/social/updates') {
      const version = createHash('sha256').update(JSON.stringify(overview)).digest('hex');
      const previous = new URL(route.request().url()).searchParams.get('version');
      const changed = previous !== version;
      updates.push({ version: previous, changed });
      return ok(changed ? { changed, version, overview } : { changed, version });
    }
    if (path === '/social/public/messages') {
      publicReads++;
      return ok({ items: [{ id: messageId, sequence: '1', senderId: friend, sender: overview.friends[0]!.person, text: '公共频道你好', createdAt: timestamp }], nextCursor: null });
    }
    if (path === '/profile') {
      if (route.request().method() === 'PUT') profile = { ...profile, ...route.request().postDataJSON() };
      return ok(profile);
    }
    if (path === '/profile/matches') return ok({ items: [], nextCursor: null });
    if (path === `/social/friends/${friend}/messages`) return ok({ items: [
      { id: messageId, sequence: '1', senderId: friend, text: '晚上一起开桌吗？', createdAt: timestamp },
      ...(arrivals > 1 ? [{ id: '10000000-0000-4000-8000-000000000004', sequence: '2', senderId: friend, text: '最小化后收到的新消息', createdAt: timestamp }] : []),
    ], nextCursor: null });
    if (path === `/social/friends/${friend}/read`) { reads++; overview.friends[0]!.unread = 0; return ok({ done: true }); }
    return ok([]);
  });
  return {
    arrive() {
      arrivals++;
      overview = { ...overview, friends: overview.friends.map(item => ({ ...item, unread: 1 })), invitations: [{
        id: messageId, sender: overview.friends[0]!.person,
        recipient: { id: me, friendId: 'alice', displayName: '桌友小红', avatar: 'dice' },
        roomId: friend, roomName: '周末桌', hasPassword: true, status: 'pending', expiresAt: '2099-10-04T00:00:00.000Z', available: true,
      }] };
    },
    avatar(avatar: SocialOverview["friends"][number]["person"]["avatar"]) { overview.friends[0]!.person.avatar = avatar; },
    readCount: () => reads,
    publicReadCount: () => publicReads,
    invitations(items: SocialOverview["invitations"]) { overview = { ...overview, invitations: items }; },
    updates,
  };
}

test('unchanged social polls retain the overview and changed polls update it', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/friends');
  await expect(page.getByText('桌友小明', { exact: true }).first()).toBeVisible();
  await expect.poll(() => state.updates.length).toBeGreaterThan(0);
  const count = state.updates.length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => state.updates.length).toBeGreaterThan(count);
  expect(state.updates.at(-1)).toMatchObject({ changed: false, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await expect(page.getByText('桌友小明', { exact: true }).first()).toBeVisible();
  state.arrive();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: '通知，2 条未处理' })).toBeVisible();
  expect(state.updates.at(-1)?.changed).toBe(true);
});

test('desktop chat stays at bottom right with two channels and retained drafts', async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto('/profile');
  const dock = page.getByRole('region', { name: '聊天浮窗' });
  if (info.project.name !== 'desktop') {
    await expect(dock).toHaveCount(0);
    await expect(page.getByRole('link', { name: '公共聊天', exact: true })).toBeVisible();
    return;
  }
  await expect(dock).toBeVisible();
  await expect(page.getByRole('button', { name: '通知', exact: true })).toBeVisible();
  expect(state.publicReadCount()).toBe(0);
  const collapsed = await dock.boundingBox();
  expect(collapsed!.x + collapsed!.width).toBe(page.viewportSize()!.width - 16);
  expect(collapsed!.y + collapsed!.height).toBe(page.viewportSize()!.height - 16);
  await dock.getByRole('button', { name: '展开聊天', exact: true }).first().click();
  await expect(dock.getByText('公共频道你好', { exact: true })).toBeVisible();
  await dock.getByLabel('公共消息', { exact: true }).fill('公共草稿');
  await dock.getByRole('button', { name: '好友聊天', exact: true }).click();
  await dock.getByRole('button', { name: '私聊 桌友小明', exact: true }).click();
  await expect(dock.getByText('晚上一起开桌吗？', { exact: true })).toBeVisible();
  await dock.getByLabel('私聊消息', { exact: true }).fill('好友草稿');
  const publicReads = state.publicReadCount();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(state.publicReadCount()).toBe(publicReads);
  await dock.getByRole('button', { name: '公共聊天', exact: true }).click();
  await expect(dock.getByLabel('公共消息', { exact: true })).toHaveValue('公共草稿');
  await dock.getByRole('button', { name: '最小化聊天', exact: true }).first().click();
  const reads = state.publicReadCount();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(state.publicReadCount()).toBe(reads);
  await dock.getByRole('button', { name: '展开聊天', exact: true }).click();
  await dock.getByRole('button', { name: '好友聊天', exact: true }).click();
  await expect(dock.getByLabel('私聊消息', { exact: true })).toHaveValue('好友草稿');
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  await expect(dock.getByLabel('私聊消息', { exact: true })).toHaveValue('好友草稿');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: info.outputPath('right-chat-' + theme + '.png'), fullPage: true });
  }
  await page.goto(`/matches/${friend}`);
  const header = page.locator('.site-header');
  await expect(header).toBeVisible();
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const alignment = await header.evaluate(element => {
      const centers = [...element.querySelectorAll('.brand, nav > a:not(.mobile-chat-link), summary')].map(item => {
        const rect = item.getBoundingClientRect();
        return rect.y + rect.height / 2;
      });
      return { spread: Math.max(...centers) - Math.min(...centers), height: element.getBoundingClientRect().height };
    });
    expect(alignment.spread).toBeLessThan(2);
    expect(alignment.height).toBeLessThan(90);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const expanded = await dock.boundingBox();
    expect(expanded!.x + expanded!.width).toBe(width - 16);
    expect(expanded!.y + expanded!.height).toBe(884);
    await page.locator('.nav-tools summary').click();
    const menu = await page.locator('.nav-tools > div').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`game-header-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
  }
});

test('messages and invitations notify outside the friends page', async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: /通知/ })).toBeVisible();
  state.arrive();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: '通知，2 条未处理' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '收到新消息或房间邀请' })).toBeVisible();
  expect(state.readCount()).toBe(0);
  await page.getByRole('button', { name: '通知，2 条未处理' }).click();
  await expect(page.getByRole('link', { name: /周末桌/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('notification-menu.png'), fullPage: true });
  await page.getByRole('link', { name: /桌友小明.*1 条未读/ }).click();
  await expect(page.getByText('晚上一起开桌吗？', { exact: true })).toBeVisible();
  if (info.project.name === 'desktop') {
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('region', { name: '聊天浮窗' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('chat-dock.png'), fullPage: true });
    await expect.poll(state.readCount).toBeGreaterThanOrEqual(1);
    await page.getByLabel('私聊消息', { exact: true }).fill('保留草稿');
    await page.getByRole('button', { name: '最小化聊天' }).click();
    await expect(page.getByLabel('私聊消息')).toBeHidden();
    const reads = state.readCount();
    state.arrive();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('button', { name: '通知，2 条未处理' })).toBeVisible();
    expect(state.readCount()).toBe(reads);
    await page.getByRole('button', { name: /展开与 桌友小明 的聊天/ }).click();
    await expect(page.getByLabel('私聊消息')).toHaveValue('保留草稿');
    await expect(page.getByText('最小化后收到的新消息', { exact: true })).toBeVisible();
    await expect.poll(state.readCount).toBeGreaterThan(reads);
    await page.getByRole('link', { name: '开发者文档', exact: true }).click();
    await expect(page.getByLabel('私聊消息')).toHaveValue('保留草稿');
    await page.getByRole('button', { name: '关闭聊天' }).click();
    await expect(page.getByLabel('私聊消息')).toHaveCount(0);
  } else {
    await expect(page).toHaveURL(new RegExp(`/friends/chat/${friend}$`));
    await expect(page.getByRole('region', { name: '聊天浮窗' })).toHaveCount(0);
  }
  await page.getByRole('button', { name: /^通知(?:，.*)?$/ }).click();
  await page.getByRole('link', { name: /周末桌/ }).click();
  await expect(page).toHaveURL(/\/friends\/invitations$/);
  await expect(page.getByLabel('邀请房间密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '接受并加入' })).toBeDisabled();
  await page.getByLabel('邀请房间密码').fill('test-password');
  await expect(page.getByRole('button', { name: '接受并加入' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('social-notifications.png'), fullPage: true });
});

test('profile keeps editing, ID settings and history behind task entrances', async ({ page }, info) => {
  await fixture(page);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: '桌友小红' })).toBeVisible();
  await expect(page.getByLabel('昵称', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('新好友 ID')).toHaveCount(0);
  await expect(page.getByText('@alice', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('profile-simple.png'), fullPage: true });
  await page.getByRole('link', { name: '编辑资料', exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/edit$/);
  await page.getByLabel('昵称', { exact: true }).fill('新的昵称');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新的昵称' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '新的昵称' })).toBeVisible();
  await page.getByRole('link', { name: '对局记录', exact: true }).click();
  await expect(page.getByText('暂无对局记录。')).toBeVisible();
  await page.getByRole('link', { name: '返回我的资料' }).click();
  await page.getByRole('link', { name: '管理好友 ID' }).click();
  await expect(page.getByLabel('新好友 ID')).toBeVisible();
  await page.getByRole('link', { name: '返回我的资料' }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByText('账户操作', { exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: /通知/ })).toHaveCount(0);
});


test('friend directory heading fits its panel without a global header background', async ({ page }, info) => {
  await fixture(page);
  await page.goto('/friends');
  const heading = page.locator('.social-section-heading');
  await expect(heading).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await heading.evaluate(element => {
        const box = element.getBoundingClientRect();
        const panel = element.closest('.social-directory')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
          contained: box.left >= panel.left && box.right <= panel.right,
          childrenContained: [...element.children].every(child => {
            const childBox = child.getBoundingClientRect();
            return childBox.left >= box.left && childBox.right <= box.right
              && childBox.top >= box.top && childBox.bottom <= box.bottom;
          }),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.background).toBe('rgba(0, 0, 0, 0)');
      expect(layout.padding).toBe(0);
      expect(layout.contained).toBe(true);
      expect(layout.childrenContained).toBe(true);
      expect(layout.overflow).toBe(false);
      await page.screenshot({ path: info.outputPath(`friends-heading-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('friend avatars reflect the selected profile avatar', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/friends');
  await expect(page.locator('.social-avatar').first()).toHaveText('🐱');
  for (const [avatar, symbol] of [['dice', '🎲'], ['leaf', '🌿'], ['rocket', '🚀'], ['star', '⭐'], ['coffee', '☕'], ['cat', '🐱']] as const) {
    state.avatar(avatar);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.social-avatar').first()).toHaveText(symbol);
  }
});

test('friend options float without stretching the chat action and dismiss accessibly', async ({ page }, info) => {
  await fixture(page);
  await page.goto('/friends');
  const chat = page
    .getByRole('region', { name: '好友列表' })
    .locator('.social-row')
    .filter({ hasText: '桌友小明' })
    .getByRole('link', { name: '发消息', exact: true });
  const trigger = page.getByLabel('桌友小明 的好友操作');
  const before = await chat.boundingBox();
  await trigger.click();
  await expect(page.getByRole('button', { name: '删除好友' })).toBeVisible();
  const after = await chat.boundingBox();
  expect(after?.height).toBe(before?.height);
  await page.screenshot({ path: info.outputPath('friend-options.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '删除好友' })).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '删除好友' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '删除好友' })).toBeHidden();
  await trigger.click();
  await page.getByRole('heading', { name: '我的好友', level: 1, exact: true }).click();
  await expect(page.getByRole('button', { name: '删除好友' })).toBeHidden();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const bounds = await page.getByRole('button', { name: '删除好友' }).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
});

test('room invitations distinguish response states in light and dark themes', async ({ page }, info) => {
  const state = await fixture(page);
  const sender = { id: friend, friendId: 'bob', displayName: '桌友小明', avatar: 'cat' as const };
  const recipient = { id: me, friendId: 'alice', displayName: '桌友小红', avatar: 'dice' as const };
  const base = { sender, recipient, roomId: friend, hasPassword: false, expiresAt: '2099-10-04T00:00:00.000Z' };
  state.invitations([
    { ...base, id: messageId, roomName: '周末桌', status: 'pending', available: true },
    { ...base, id: '10000000-0000-4000-8000-000000000005', roomName: '已接受的桌', status: 'accepted', available: false },
    { ...base, id: '10000000-0000-4000-8000-000000000006', roomName: '已拒绝的桌', status: 'rejected', available: false },
    { ...base, id: '10000000-0000-4000-8000-000000000007', roomName: '已失效的桌', status: 'pending', available: false },
    { ...base, sender: recipient, recipient: sender, id: '10000000-0000-4000-8000-000000000008', roomName: '我发出的桌', status: 'accepted', available: false },
  ]);
  await page.goto('/friends/invitations');
  await expect(page.locator('.invitation-status')).toHaveText(['等待回应', '已接受', '已拒绝', '已失效', '已接受']);
  await expect(page.locator('.invitation-row').last()).toContainText('已邀请 桌友小明');
  await expect(page.locator('.invitation-row').last().getByRole('link')).toHaveCount(0);
  await expect(page.locator('.invitation-row').nth(3).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '进入已接受的房间' })).toHaveCount(1);
  const viewport = page.viewportSize()!;
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize(viewport);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const colors = await page.locator('.invitation-status').evaluateAll(items => items.map(item => getComputedStyle(item).color));
    expect(new Set(colors.slice(0, 4)).size).toBe(4);
    await page.screenshot({ path: info.outputPath('invitations-' + theme + '.png'), fullPage: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
