import { matchViewSchema } from '../../packages/protocol/src/index.js';
import { viewSchema } from '@boardgame/color-match/shared';
import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username = 'stage3_a') {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('defaults to official AI, recovers a lost enrollment and continues with free script at zero points', async ({
  page,
}, info) => {
  await login(page, 'stage7_admin');
  const admin = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const headers = { origin: 'http://127.0.0.1:5273', 'x-csrf-token': admin.csrfToken };
  // Zero player points prevent dispatch of this test-only source credential.
  const source = await page.request.post('/api/v1/me/model-profiles', {
    headers,
    data: {
      name: '电脑入口测试来源',
      endpointId: 'openai',
      modelId: 'fixture-not-dispatched',
      apiKey: 'fixture-official-api-key',
    },
  });
  expect(source.ok()).toBe(true);
  const offer = await page.request.post('/api/v1/admin/official-ai/offers', {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      name: '默认官方陪玩',
      profileId: (await source.json()).data.id,
      pointsPerAction: 2,
    },
  });
  expect(offer.ok()).toBe(true);
  await page.request.post('/api/v1/auth/logout', { headers });
  await login(page);
  await page.goto('/games/color-match/1.0.0/computer');
  await expect(page.getByLabel('陪玩 AI')).toHaveValue((await offer.json()).data.id);
  await expect(page.getByLabel('每席位单局 AI 点数上限')).toHaveValue('100');
  await expect(page.getByText(/可用 0 点/)).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`official-computer-${width}.png`),
      fullPage: true,
    });
  }
  const enrollments: string[] = [];
  let lost = false;
  await page.route('**/api/v1/me/official-ai/enroll', async (route) => {
    enrollments.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (!lost) {
      lost = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '开始电脑对局', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续本次开局' }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  expect(enrollments).toHaveLength(2);
  expect(new Set(enrollments).size).toBe(1);
  const matchId = page.url().split('/').at(-1)!;
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const draw = await page.request.post(`/api/v1/matches/${matchId}/actions`, {
    headers: { origin: 'http://127.0.0.1:5273', 'x-csrf-token': me.csrfToken },
    data: {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      expectedControllerEpoch: 0,
      action: { type: 'draw_card' },
    },
  });
  expect(draw.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/matches/${matchId}/view`)).json()).data.revision,
    )
    .toBeGreaterThan(1);
  expect((await (await page.request.get('/api/v1/me/ai-points')).json()).data).toEqual({
    balance: 0,
    reserved: 0,
    available: 0,
  });
});

test('recovers lost create and start replies across refresh without duplicate rooms or matches', async ({
  page,
}, info) => {
  await page.goto('/games/color-match/1.0.0');
  await page.getByRole('link', { name: '和电脑开一局', exact: true }).click();
  await expect(page.getByText('登录后即可和电脑开一局。')).toBeVisible();
  await login(page);
  await page.goto('/games/color-match/1.0.0/computer');
  const creates: string[] = [];
  const starts: string[] = [];
  let dropCreate = true;
  let dropStart = true;
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    creates.push(route.request().postData()!);
    const response = await route.fetch();
    if (dropCreate) {
      dropCreate = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.route('**/api/v1/rooms/*/start', async (route) => {
    starts.push(route.request().postData()!);
    const response = await route.fetch();
    if (dropStart) {
      dropStart = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByLabel('总人数（含你）').selectOption('3');
  await page.getByRole('button', { name: '开始电脑对局', exact: true }).dblclick();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('总人数（含你）')).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('总人数（含你）')).toHaveValue('3');
  await page.getByRole('button', { name: '继续本次开局' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续本次开局' }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  const matchId = page.url().split('/').at(-1)!;
  const snapshot = matchViewSchema.parse(
    (await (await page.request.get(`/api/v1/matches/${matchId}/view`)).json()).data,
  );
  expect(snapshot.players?.map((player) => player.occupantKind)).toEqual(['human', 'bot', 'bot']);
  expect(new Set(creates).size).toBe(1);
  expect(new Set(starts).size).toBe(1);
  expect(creates).toHaveLength(3);
  expect(starts).toHaveLength(2);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith('boardgame:computer-game:')),
    ),
  ).toEqual([]);
  const history = (await (await page.request.get('/api/v1/profile/matches')).json()).data;
  expect(history.items.map((item: { id: string }) => item.id)).toEqual([matchId]);
  await page.screenshot({ path: info.outputPath('computer-match.png'), fullPage: true });
});

test('plays a complete computer game, shows persisted results and filters history before another round', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto('/games/color-match/1.0.0');
  await page.getByRole('link', { name: '和电脑开一局', exact: true }).click();
  await expect(page.getByLabel('总人数（含你）')).toHaveValue('2');
  await page.getByLabel('总人数（含你）').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '开始电脑对局', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('computer-setup.png'), fullPage: true });
  await page.getByRole('button', { name: '开始电脑对局', exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  const matchId = page.url().split('/').at(-1)!;
  const snapshot = async () =>
    matchViewSchema.parse(
      (await (await page.request.get(`/api/v1/matches/${matchId}/view`)).json()).data,
    );
  for (let action = 0; action < 300; action++) {
    await expect
      .poll(
        async () => {
          const data = await snapshot();
          const view = viewSchema.parse(data.view);
          return (
            data.status === 'finished' ||
            view.canDraw ||
            !!view.legalCardIds.length ||
            !!view.targetSeatIds.length
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const data = await snapshot();
    if (data.status === 'finished') break;
    const view = viewSchema.parse(data.view);
    if (view.targetSeatIds.length) {
      await page.getByRole('button', { name: '指定摸牌' }).first().click();
      await page.getByRole('button', { name: '确认目标', exact: true }).click();
    } else if (view.legalCardIds.length) {
      await page.locator('.color-hand-cards button:not([disabled])').first().click();
      await page.getByRole('button', { name: '出牌', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '摸牌或跳过并结束回合' }).click();
    }
    await expect.poll(async () => (await snapshot()).revision).toBeGreaterThan(data.revision);
  }
  const finished = await snapshot();
  expect(finished.status).toBe('finished');
  expect(finished.result?.players).toHaveLength(2);
  await expect(page).toHaveURL(`/rooms/${finished.roomId}`);
  const result = page.getByRole('region', { name: '本局结果', exact: true });
  await expect(result).toBeVisible();
  const originalViewport = page.viewportSize()!;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('boardgame.theme', value), theme);
    await page.reload();
    await expect(result).toBeVisible();
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`result-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize(originalViewport);
  await page.goto('/profile/history');
  const record = page.locator('.match-history-row').filter({ hasText: 'Color Match · 电脑对局' });
  await expect(record).toContainText(
    finished.result?.players.find((player) => player.winner)?.seatId ===
      finished.players?.find((player) => player.seatIndex === 0)?.seatId
      ? '胜出'
      : '未胜出',
  );
  await page.screenshot({ path: info.outputPath('match-history.png'), fullPage: true });
  let failFilter = true;
  await page.route('**/api/v1/profile/matches?gameId=azul.base', async (route) => {
    if (failFilter) {
      failFilter = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('按游戏筛选').selectOption('azul.base');
  await expect(page.getByRole('heading', { name: '对局记录加载失败' })).toBeVisible();
  await expect(record).toHaveCount(0);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('这款游戏还没有对局记录。')).toBeVisible();
  await page.getByRole('button', { name: '查看全部游戏' }).click();
  await expect(record).toBeVisible();
  await record.getByRole('link', { name: '查看结果', exact: true }).click();
  await expect(page.getByRole('region', { name: '本局结果', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回房间再来一局', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  expect(page.url()).not.toContain(matchId);
});
