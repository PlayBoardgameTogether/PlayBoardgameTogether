import { z } from 'zod';
import type { WebSocketRoute } from '@playwright/test';
import {
  matchActionSchema,
  matchSnapshotMessageSchema,
  matchViewSchema,
  roomSnapshotSchema,
  sessionPublicSchema,
} from '../../packages/protocol/src/index.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { gamePackageFiles, zipSync } from '../fixtures/game-package.js';
import { test, expect, type Page, type BrowserContext } from './fixtures.js';

const gameId = 'online.recovery-fixture';
const viewSchema = z.object({
  seats: z.array(z.string()),
  scores: z.array(z.number()),
  currentSeat: z.string(),
  winner: z.string().nullable(),
  canClaim: z.boolean(),
});

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

async function headers(page: Page) {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.ok()).toBe(true);
  const session = sessionPublicSchema.parse((await response.json()).data);
  return { origin: new URL(page.url()).origin, 'x-csrf-token': session.csrfToken };
}

// The platform's own example ZIP, explicitly adapted as a recovery test fixture.
// This exercises the real sandbox/transaction/iframe, not a released game's rules.
async function archive(terminal: boolean) {
  const files = await gamePackageFiles();
  files['game.json'] = Buffer.from(
    JSON.stringify({
      format: 'boardgame-package-v1',
      rules: `恢复验收样例：轮流抢分，先到 ${terminal ? 1 : 5} 分获胜。`,
      publicResult: 'winners-scores-v1',
    }),
  );
  files['server.js'] = Buffer.from(
    files['server.js'].toString().replace('>= 5', terminal ? '>= 1' : '>= 5') +
      `\ngame.manifest.id = '${gameId}';
     game.manifest.name = '恢复验收样例';
     game.manifest.version = '${terminal ? '1.0.0' : '1.0.1'}';
     game.manifest.defaultAssetPack.id = '${gameId}.default';
     game.getPublicResult = function(outcome) {
       return { winners: outcome.winners, scores: outcome.scores };
     };`,
  );
  return Buffer.from(zipSync(files, { mtime: new Date(2026, 0, 1) }));
}

async function start(page: Page, otherContext: BrowserContext, terminal = false) {
  await login(page, 'stage7_admin');
  const bytes = await archive(terminal);
  const auth = await headers(page);
  const review = await page.request.post('/api/v1/admin/game-packages/review', {
    headers: { ...auth, 'content-type': 'application/zip' },
    data: bytes,
  });
  expect(review.ok()).toBe(true);
  const catalogHash = z
    .object({ catalogHash: z.string() })
    .parse((await review.json()).data).catalogHash;
  const install = await page.request.post(
    `/api/v1/admin/game-packages?requestId=${crypto.randomUUID()}&expectedCatalogHash=${catalogHash}`,
    { headers: { ...auth, 'content-type': 'application/zip' }, data: bytes },
  );
  expect(install.ok()).toBe(true);
  const other = await otherContext.newPage();
  await login(other, 'stage2_b');
  await page.goto(`/games/${gameId}/${terminal ? '1.0.0' : '1.0.1'}/new`);
  await page.getByLabel('房间名', { exact: true }).fill('D22 恢复验收');
  await page.getByLabel('人数', { exact: true }).fill('2');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]+$/);
  const roomUrl = page.url();
  const inviteCode = (
    await page.getByRole('button', { name: '复制邀请码' }).innerText()
  ).replaceAll('-', '');
  const joined = await other.request.post('/api/v1/rooms/join', {
    headers: await headers(other),
    data: { requestId: crypto.randomUUID(), inviteCode },
  });
  expect(joined.ok()).toBe(true);
  await other.goto(roomUrl);
  await other.getByRole('button', { name: '坐这里', exact: true }).click();
  await other.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(other).toHaveURL(page.url());
  await expect(claim(page)).toBeEnabled();
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  return { other, matchId: new URL(page.url()).pathname.split('/').at(-1)!, roomUrl };
}

const claim = (page: Page) =>
  page
    .frameLocator('iframe[title="在线游戏桌面"]')
    .getByRole('button', { name: '抢分', exact: true });
const confirm = (page: Page) => page.getByRole('button', { name: '确认操作结果', exact: true });
const pending = (page: Page, id: string) =>
  page.evaluate((matchId) => sessionStorage.getItem(`boardgame:pending-match:${matchId}`), id);
async function snapshot(page: Page, id: string) {
  const response = await page.request.get(`/api/v1/matches/${id}/view`);
  expect(response.ok()).toBe(true);
  return matchViewSchema.parse((await response.json()).data);
}

async function persisted(id: string) {
  const url = process.env.TEST_DATABASE_URL;
  const development = process.env.DATABASE_URL;
  if (
    !url ||
    !development ||
    url === development ||
    new URL(url).pathname === new URL(development).pathname
  ) {
    throw new Error('Recovery audit requires an isolated test database');
  }
  const db = createDatabase(url);
  try {
    // One SQL snapshot; hashes avoid putting even test State/RNG in assertion logs.
    return (
      await db.query(
        `SELECT m.status,m.revision,m.result_summary,
      md5(m.state::text) AS state_hash,md5(m.rng_state::text) AS rng_hash,
      (SELECT count(*)::int FROM match_actions WHERE match_id=m.id) AS actions,
      (SELECT count(*)::int FROM match_replay_frames WHERE match_id=m.id) AS frames,
      (SELECT count(*)::int FROM command_receipts WHERE operation='match.action:' || m.id::text) AS receipts,
      (SELECT jsonb_build_object('status',r.status,'activeMatchId',r.active_match_id,
        'hostAccountId',r.host_account_id,'revision',r.room_revision) FROM rooms r WHERE r.id=m.room_id) AS room,
      (SELECT jsonb_agg(jsonb_build_object('accountId',s.owner_account_id,'kind',s.occupant_kind)
        ORDER BY s.seat_index) FROM seats s WHERE s.room_id=m.room_id) AS seats,
      (SELECT jsonb_agg(jsonb_build_object('type',p.controller_type,'epoch',p.controller_epoch)
        ORDER BY p.seat_index) FROM match_participants p WHERE p.match_id=m.id) AS controllers
      FROM matches m WHERE m.id=$1`,
        [id],
      )
    ).rows[0];
  } finally {
    await db.end();
  }
}

test('a lost terminal reply survives refresh and its original request settles only once', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const otherContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: page.viewportSize()!,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  let withholdUpdates = false;
  await page.routeWebSocket('**/api/v1/ws/session', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const value = z.object({ type: z.string() }).parse(JSON.parse(String(message)));
      if (withholdUpdates && ['room.snapshot', 'match.snapshot'].includes(value.type)) return;
      socket.send(message);
    });
  });
  try {
    const { matchId } = await start(page, otherContext, true);
    const actionPath = `**/api/v1/matches/${matchId}/actions`;
    const receiptPath = `**/api/v1/matches/${matchId}/commands/*`;
    const viewPath = `**/api/v1/matches/${matchId}/view`;
    const commands: string[] = [];
    withholdUpdates = true;
    await page.route(receiptPath, (route) => route.abort('failed'));
    await page.route(viewPath, (route) => route.abort('failed'));
    await page.route(actionPath, async (route) => {
      commands.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    });
    await claim(page).click();
    await expect(confirm(page)).toBeEnabled();
    expect(await pending(page, matchId)).toBeTruthy();
    expect(commands).toHaveLength(1);
    const committed = await persisted(matchId);
    expect(committed).toMatchObject({
      status: 'finished',
      revision: 1,
      actions: 1,
      frames: 2,
      receipts: 1,
      room: { status: 'waiting', activeMatchId: null },
    });
    await page.unroute(viewPath);
    withholdUpdates = false;
    await page.reload();
    await expect(page.getByRole('region', { name: '本局结果', exact: true })).toBeVisible();
    await expect(confirm(page)).toBeEnabled();
    expect(await pending(page, matchId)).toBeTruthy();
    await page.unroute(receiptPath);
    await confirm(page).click();
    await expect(page.locator('.match-action-feedback')).toHaveText('操作已保存，已同步最新局面。');
    await expect(confirm(page)).toHaveCount(0);
    expect(await pending(page, matchId)).toBeNull();
    const command = matchActionSchema.parse(JSON.parse(commands[0]!));
    const duplicate = await page.request.post(`/api/v1/matches/${matchId}/actions`, {
      headers: await headers(page),
      data: command,
    });
    expect(duplicate.status()).toBe(200);
    const final = matchViewSchema.parse((await duplicate.json()).data);
    expect(final.result?.players).toHaveLength(2);
    expect(final.result).toEqual(committed.result_summary);
    expect(final.revision).toBe(1);
    expect(final.events ?? []).toEqual([]);
    expect(await persisted(matchId)).toEqual(committed);
    expect(commands).toHaveLength(1);
    await page.goto('/profile/history');
    await expect(page.locator('.match-history-row')).toHaveCount(1);
    await page.goto(`/matches/${matchId}`);
    await expect(page.getByRole('region', { name: '本局结果', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('recovered-terminal-result.png'),
      fullPage: true,
    });
  } finally {
    await otherContext.close();
  }
});

test('real offline recovery keeps seats and ignores a delayed older server snapshot', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const otherContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: page.viewportSize()!,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  let socket: WebSocketRoute | undefined;
  let initial: string | undefined;
  let connections = 0;
  await page.routeWebSocket('**/api/v1/ws/session', (connection) => {
    connections++;
    socket = connection;
    const server = connection.connectToServer();
    server.onMessage((message) => {
      const parsed = matchSnapshotMessageSchema.safeParse(JSON.parse(String(message)));
      if (parsed.success && parsed.data.revision === 0) initial = String(message);
      connection.send(message);
    });
  });
  try {
    const { other, matchId, roomUrl } = await start(page, otherContext);
    await expect.poll(() => initial).toBeTruthy();
    await claim(page).click();
    await expect(claim(other)).toBeEnabled();
    await expect(page.locator('.match-page')).toHaveAttribute('data-match-revision', '1');
    const beforeOffline = await persisted(matchId);
    const beforeConnections = connections;
    await page.context().setOffline(true);
    socket!.close({ code: 1001, reason: 'offline transport test' });
    await expect(page.getByText('网络重连中，操作已暂停。')).toBeVisible();
    await expect(claim(page)).toBeDisabled();
    await claim(other).click();
    await expect.poll(async () => (await snapshot(other, matchId)).revision).toBe(2);
    await expect(page.locator('.match-page')).toHaveAttribute('data-match-revision', '1');
    await page.context().setOffline(false);
    await expect.poll(() => connections).toBeGreaterThan(beforeConnections);
    await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
    await expect(page.locator('.match-page')).toHaveAttribute('data-match-revision', '2');
    await expect(claim(page)).toBeEnabled();
    const authority = await snapshot(page, matchId);
    socket!.send(initial!);
    // Let delivery and React rendering finish before any fresh read could mask a regression.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.locator('.match-page')).toHaveAttribute('data-match-revision', '2');
    const fresh = page.waitForResponse(`**/api/v1/matches/${matchId}/view`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await fresh;
    await expect(page.locator('.match-page')).toHaveAttribute('data-match-revision', '2');
    const view = viewSchema.parse(authority.view);
    await expect(
      page.frameLocator('iframe[title="在线游戏桌面"]').locator('#scores strong'),
    ).toHaveText(view.scores.map((score) => `${score} 分`));
    const after = await persisted(matchId);
    expect(after.seats).toEqual(beforeOffline.seats);
    expect(after.controllers).toEqual(beforeOffline.controllers);
    expect(after.room).toEqual(beforeOffline.room);
    const room = roomSnapshotSchema.parse(
      (
        await (
          await other.request.get(new URL(roomUrl).pathname.replace('/rooms/', '/api/v1/rooms/'))
        ).json()
      ).data,
    );
    expect(room.members).toHaveLength(2);
    expect(room.seats.every((seat) => seat.occupantKind === 'human')).toBe(true);
    await page.screenshot({
      path: info.outputPath('reconnected-authoritative-table.png'),
      fullPage: true,
    });
  } finally {
    await page.context().setOffline(false);
    await otherContext.close();
  }
});

test('revoking a real session clears an uncertain command and stops match retries', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const otherContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: page.viewportSize()!,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  let withholdUpdates = false;
  let attempts = 0;
  let reads = 0;
  let posts = 0;
  await page.routeWebSocket('**/api/v1/ws/session', (socket) => {
    attempts++;
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const value = z.object({ type: z.string() }).parse(JSON.parse(String(message)));
      if (withholdUpdates && ['room.snapshot', 'match.snapshot'].includes(value.type)) return;
      socket.send(message);
    });
  });
  page.on('request', (request) => {
    if (/\/matches\/[^/]+\/(view|commands\/)/.test(request.url())) reads++;
  });
  try {
    const { other, matchId } = await start(page, otherContext);
    withholdUpdates = true;
    await page.route(`**/api/v1/matches/${matchId}/commands/*`, (route) => route.abort('failed'));
    await page.route(`**/api/v1/matches/${matchId}/actions`, async (route) => {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    });
    await claim(page).click();
    await expect(confirm(page)).toBeEnabled();
    expect(await pending(page, matchId)).toBeTruthy();
    const committed = await persisted(matchId);
    const revoke = await page.request.post('/api/v1/auth/logout', { headers: await headers(page) });
    expect(revoke.ok()).toBe(true);
    await expect(page.getByRole('heading', { name: '会话已失效', exact: true })).toBeVisible();
    await expect(page.locator('iframe[title="在线游戏桌面"]')).toHaveCount(0);
    await expect(confirm(page)).toHaveCount(0);
    expect(await pending(page, matchId)).toBeNull();
    const stopped = { attempts, reads, posts };
    await page.clock.install();
    await page.clock.fastForward(60000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect({ attempts, reads, posts }).toEqual(stopped);
    expect((await page.request.get(`/api/v1/matches/${matchId}/view`)).status()).toBe(401);
    expect((await snapshot(other, matchId)).revision).toBe(1);
    expect(await persisted(matchId)).toEqual(committed);
    await page.screenshot({ path: info.outputPath('revoked-session-cleared.png'), fullPage: true });
  } finally {
    await otherContext.close();
  }
});
