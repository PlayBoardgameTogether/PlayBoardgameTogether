import type { TestInfo } from '@playwright/test';
import { matchHistorySchema, type MatchView } from '../../packages/protocol/src/index.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { expect, type Page } from './fixtures.js';

// Pagination fixtures copy a genuinely completed match inside this run's test DB.
// They test cursor ties and rendering; they are not additional played games.
async function seedPages(matchId: string) {
  const url = process.env.TEST_DATABASE_URL;
  const development = process.env.DATABASE_URL;
  if (!url || !development || new URL(url).pathname === new URL(development).pathname) {
    throw new Error('An isolated test database is required');
  }
  const db = createDatabase(url);
  try {
    await db.query(
      `WITH copies AS (
        INSERT INTO matches
        SELECT (jsonb_populate_record(NULL::matches,
          to_jsonb(m) || jsonb_build_object('id', gen_random_uuid()))).*
        FROM matches m CROSS JOIN generate_series(1,22) WHERE m.id=$1
        RETURNING id
      )
      INSERT INTO match_participants
      SELECT (jsonb_populate_record(NULL::match_participants,
        to_jsonb(p) || jsonb_build_object('match_id', copies.id))).*
      FROM copies CROSS JOIN match_participants p WHERE p.match_id=$1`,
      [matchId],
    );
  } finally {
    await db.end();
  }
}

async function holdNextPage(page: Page) {
  let release!: () => void;
  let arrived!: () => void;
  let completed!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const captured = new Promise<void>((resolve) => (arrived = resolve));
  const done = new Promise<void>((resolve) => (completed = resolve));
  const pattern = /\/api\/v1\/profile\/matches\?.*before=/;
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    arrived();
    await gate;
    await route.fulfill({ response });
    completed();
  });
  return {
    captured,
    async finish() {
      const delivered = page.waitForResponse((response) => pattern.test(response.url()));
      release();
      await (await delivered).finished();
      await done;
      await page.unroute(pattern);
    },
  };
}

export async function verifyResultHistory(page: Page, info: TestInfo, final: MatchView) {
  await page.goto(`/matches/${final.matchId}`);
  const panel = page.getByRole('region', { name: '本局结果', exact: true });
  await expect(panel).toBeVisible();
  let actionRequests = 0;
  const countActions = (request: { url(): string; method(): string }) => {
    if (request.url().endsWith(`/matches/${final.matchId}/actions`) && request.method() === 'POST')
      actionRequests++;
  };
  page.on('request', countActions);
  await panel.getByRole('link', { name: '查看回放', exact: true }).click();
  await expect(page).toHaveURL(`/matches/${final.matchId}/replay`);
  const replay = page.frameLocator('iframe[title="在线游戏桌面"]');
  await expect(replay.locator('#hand button').first()).toBeVisible();
  await expect(replay.locator('#hand button').first()).toBeDisabled();
  expect(actionRequests).toBe(0);
  page.off('request', countActions);

  await seedPages(final.matchId);
  await page.goto('/profile/history');
  const rows = page.locator('.match-history-row');
  const filter = page.getByLabel('按游戏筛选');
  const more = page.getByRole('button', { name: '加载更多', exact: true });
  await expect(rows).toHaveCount(20);
  await filter.selectOption('online.uno');
  await expect(rows).toHaveCount(20);
  const firstResponse = await page.request.get('/api/v1/profile/matches?gameId=online.uno');
  expect(firstResponse.ok()).toBe(true);
  const first = matchHistorySchema.parse((await firstResponse.json()).data);
  expect(first.items).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const ownSeat = final.players!.find((player) => player.seatIndex === final.seatIndex)!.seatId;
  const own = final.result?.players.find((player) => player.seatId === ownSeat);
  const label = own ? (own.winner ? '胜出' : '未胜出') : '未记录结果';
  for (const item of first.items) {
    expect(item.gameVersion).toBe(final.gameVersion);
    expect(item.result).toEqual(own ? { winner: own.winner, sharedWin: false } : null);
  }
  await expect(rows.locator('.match-history-result strong')).toHaveText(Array(20).fill(label));
  await expect(rows.locator('.match-history-result > span')).toHaveCount(0);

  const staleFilter = await holdNextPage(page);
  await more.click();
  await staleFilter.captured;
  await filter.selectOption('color-match');
  await expect(page.getByText('这款游戏还没有对局记录。')).toBeVisible();
  await staleFilter.finish();
  await expect(rows).toHaveCount(0);
  await filter.selectOption('online.uno');
  await expect(rows).toHaveCount(20);
  await more.click();
  await expect(rows).toHaveCount(23);
  await expect(more).toHaveCount(0);
  const ids = await rows
    .getByRole('link', { name: '查看结果', exact: true })
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!.split('/').at(-1)));
  expect(new Set(ids).size).toBe(23);
  expect(ids.slice(0, 20)).toEqual(first.items.map((item) => item.id));
  await expect(rows.locator('.match-history-result strong')).toHaveText(Array(23).fill(label));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('uno-filtered-history.png'), fullPage: true });

  const original = rows.filter({ has: page.locator(`a[href="/matches/${final.matchId}"]`) });
  await original.getByRole('link', { name: '查看结果', exact: true }).click();
  await expect(panel).toBeVisible();
  if (!own) await expect(panel).toContainText('本局未记录结果摘要');
  await panel.getByRole('link', { name: '返回房间再来一局', exact: true }).click();
  await expect(page).toHaveURL(`/rooms/${final.roomId}`);
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeVisible();

  // Hold an old account's real page response across logout/login in this same tab.
  await page.goto('/profile/history');
  await expect(rows).toHaveCount(20);
  const staleAccount = await holdNextPage(page);
  await more.click();
  await staleAccount.captured;
  await page.getByRole('link', { name: '← 返回我的资料', exact: true }).click();
  await page.getByText('账户操作', { exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('用户名').fill('stage2_b');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '我的资料', exact: true }).click();
  await page.getByRole('link', { name: '对局记录', exact: true }).click();
  await expect(page.getByText('暂无对局记录。')).toBeVisible();
  await staleAccount.finish();
  await expect(rows).toHaveCount(0);
  const foreignCursor = await page.request.get(
    `/api/v1/profile/matches?gameId=online.uno&before=${first.nextCursor}`,
  );
  expect(foreignCursor.status()).toBe(200);
  expect(matchHistorySchema.parse((await foreignCursor.json()).data).items).toEqual([]);
  for (const path of ['view', 'replay']) {
    expect((await page.request.get(`/api/v1/matches/${final.matchId}/${path}`)).status()).toBe(404);
  }
}
