import { sessionFixture } from '../fixtures/session.js';
import { test, expect, type Page } from '@playwright/test';
import type { PublicMessage, SocialOverview } from '@boardgame/protocol';

const me = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-04T00:00:00.000Z';
async function fixture(page: Page, loseConfirmation = false) {
  const person = { id: other, friendId: 'bob', displayName: '桌友小明', avatar: 'cat' as const };
  const self = { id: me, friendId: 'alice', displayName: '桌友小红', avatar: 'dice' as const };
  const overview: SocialOverview = {
    identity: { friendId: 'alice', revision: 1, changeIntervalDays: 30, nextChangeAt: null, canChange: true },
    friends: [], requests: [], invitations: [],
  };
  const messages: PublicMessage[] = [{ id: crypto.randomUUID(), sequence: '1', senderId: other,
    sender: person, text: '晚上一起开桌吗？[微笑] 🎲 <script>bad()</script> [未知表情]', createdAt: timestamp }];
  const sends: { requestId: string; text: string }[] = [];
  let application: unknown;
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, traceId: 'public-chat-ui', data } });
    if (path === '/auth/me') return ok(sessionFixture({ id: me, displayName: self.displayName }));
    if (path === '/social') return ok(overview);
    if (path === '/social/requests') {
      application = route.request().postDataJSON();
      const pending = { person, status: 'pending' as const, direction: 'outgoing' as const, revision: 1, unread: 0 };
      overview.requests = [pending];
      return ok(pending);
    }
    if (path === '/social/public/messages') {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as { requestId: string; text: string };
        sends.push(input);
        if (sends.length === 1) messages.push({ ...messages[0]!, id: crypto.randomUUID(), sequence: '2', senderId: me, sender: self, text: input.text });
        if (loseConfirmation && sends.length === 1) return route.fulfill({ status: 503,
          json: { ok: false, traceId: 'lost', error: { code: 'SERVICE_UNAVAILABLE', message: '发送结果未知', retryable: true } } });
        return ok(messages.at(-1));
      }
      const after = url.searchParams.get('after');
      const start = after ? messages.findIndex(item => item.id === after) + 1 : 0;
      return ok({ items: messages.slice(start), nextCursor: null });
    }
    if (path === `/social/friends/${other}/messages`) {
      if (route.request().method() === 'POST') return ok({ ...messages[0], text: route.request().postDataJSON().text, senderId: me });
      return ok({ items: [{ ...messages[0], text: '私聊也支持 [微笑]' }], nextCursor: null });
    }
    if (path === `/social/friends/${other}/read`) return ok({ done: true });
    return ok([]);
  });
  return { sends, application: () => application, becomeFriends: () => {
    overview.friends = [{ person, status: 'accepted', direction: 'incoming', revision: 2, unread: 0 }];
    overview.requests = [];
  } };
}

test('public chat renders safe expressions, sends and opens a friend request from an avatar', async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: '公共聊天', exact: true })).toBeVisible();
  const history = page.getByRole('list', { name: '聊天记录' });
  await expect(page.getByLabel('查看 桌友小明 的名片', { exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(history.getByRole('img', { name: '微笑', exact: true })).toBeVisible();
  await expect(history).toContainText('<script>bad()</script>');
  await expect(history).toContainText('[未知表情]');
  expect(await history.locator('script').count()).toBe(0);
  const input = page.getByLabel('公共消息', { exact: true });
  await input.fill('来一局');
  await page.getByLabel('选择表情', { exact: true }).click();
  await page.getByRole('button', { name: '插入大笑', exact: true }).click();
  await expect(input).toHaveValue('来一局[大笑]');
  await page.getByLabel('选择表情', { exact: true }).click();
  await page.getByRole('button', { name: 'Emoji', exact: true }).click();
  await page.getByRole('button', { name: '插入🎲', exact: true }).click();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(history.getByRole('img', { name: '大笑', exact: true })).toBeVisible();
  expect(state.sends[0]!.text).toBe('来一局[大笑]🎲');
  await page.getByLabel('查看 桌友小明 的名片', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('@bob');
  await page.getByRole('button', { name: '发送好友申请', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('好友申请已提交');
  expect(state.application()).toMatchObject({ friendId: 'bob', expectedAccountId: other });
  await page.getByLabel('关闭名片').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel('选择表情', { exact: true }).click();
  await page.getByRole('button', { name: '经典表情', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect(history.locator('li').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByLabel('查看 桌友小明 的名片', { exact: true })).toHaveCSS('border-top-width', '0px');
    const bounds = await page.getByRole('group', { name: '表情选择' }).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`public-chat-${theme}.png`), fullPage: false });
  }
});

test('unknown send results preserve the original request and IME Enter does not submit', async ({ page }) => {
  const state = await fixture(page, true);
  await page.goto('/chat');
  const input = page.getByLabel('公共消息', { exact: true });
  await input.fill('你好 [捂脸]');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(state.sends).toHaveLength(0);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试发送', exact: true })).toBeVisible();
  await expect(input).toHaveValue('你好 [捂脸]');
  await expect(input).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('选择表情', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试发送', exact: true }).click();
  await expect(input).toHaveValue('');
  expect(state.sends).toHaveLength(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  await expect(page.getByRole('list', { name: '聊天记录' }).getByRole('img', { name: '捂脸', exact: true })).toHaveCount(1);
});

test('classic expressions work in the existing private chat and picker dismisses with Escape', async ({ page }) => {
  const state = await fixture(page);
  state.becomeFriends();
  await page.goto(`/friends/chat/${other}`);
  const input = page.getByLabel('私聊消息', { exact: true });
  await expect(page.getByRole('list', { name: '聊天记录' }).getByRole('img', { name: '微笑', exact: true })).toBeVisible();
  await page.getByLabel('选择表情', { exact: true }).click();
  await page.getByRole('button', { name: '插入爱心', exact: true }).click();
  await expect(input).toHaveValue('[爱心]');
  await page.getByLabel('选择表情', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: '表情选择' })).toHaveCount(0);
  await expect(page.getByLabel('选择表情', { exact: true })).toBeFocused();
});

test('guests are invited to log in without loading public messages', async ({ page }) => {
  let messageReads = 0;
  await page.route('**/api/v1/**', async route => {
    if (route.request().url().includes('/public/messages')) messageReads++;
    return route.fulfill({ status: 401, json: { ok: false, traceId: 'guest', error: { code: 'UNAUTHENTICATED', message: '请登录', retryable: false } } });
  });
  await page.goto('/chat');
  await expect(page.getByRole('link', { name: '登录参与聊天' })).toBeVisible();
  expect(messageReads).toBe(0);
});
