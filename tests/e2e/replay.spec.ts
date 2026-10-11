import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.js';

test('original participants can seek and play a saved match without sending actions', async ({ page, browser }, info) => {
  const origin = 'http://127.0.0.1:5273';
  const second = await browser.newContext();
  try {
    const a = await page.request.post('/api/v1/auth/login', { headers: { origin }, data: { username: 'stage3_a', password: 'stage two password' } });
    const b = await second.request.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { username: 'stage3_b', password: 'stage two password' } });
    expect(a.ok()).toBe(true); expect(b.ok()).toBe(true);
    const csrfA = (await a.json()).data.csrfToken;
    const csrfB = (await b.json()).data.csrfToken;
    const write = async (path: string, body: unknown, player = 'a', method = 'POST') => {
      const response = await (player === 'a' ? page.request : second.request).fetch(`${origin}/api/v1${path}`, {
        method, headers: { origin, 'x-csrf-token': player === 'a' ? csrfA : csrfB }, data: body,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).data;
    };
    const created = await write('/rooms', { requestId: randomUUID(), name: '回放验收', gameId: 'color-match', version: '1.0.0', options: {}, seatCount: 2 });
    const roomId = created.roomId;
    let room = await write('/rooms/join', { requestId: randomUUID(), inviteCode: created.inviteCode }, 'b');
    room = await write(`/rooms/${roomId}/my-seat`, { requestId: randomUUID(), expectedRoomRevision: room.roomRevision, seatIndex: 1 }, 'b', 'PUT');
    room = await write(`/rooms/${roomId}/my-ready`, { requestId: randomUUID(), expectedRoomRevision: room.roomRevision, ready: true }, 'a', 'PUT');
    room = await write(`/rooms/${roomId}/my-ready`, { requestId: randomUUID(), expectedRoomRevision: room.roomRevision, ready: true }, 'b', 'PUT');
    const started = await write(`/rooms/${roomId}/start`, { requestId: randomUUID(), expectedRoomRevision: room.roomRevision });
    const id = started.matchId;
    await write(`/matches/${id}/actions`, { requestId: randomUUID(), expectedRevision: 0, action: { type: 'draw_card' } });
    await write(`/matches/${id}/actions`, { requestId: randomUUID(), expectedRevision: 1, action: { type: 'draw_card' } }, 'b');
    room = (await (await page.request.get(`/api/v1/rooms/${roomId}`)).json()).data;
    await write(`/rooms/${roomId}/close`, { requestId: randomUUID(), expectedRoomRevision: room.roomRevision });
    let actions = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`/matches/${id}/actions`)) actions++; });
    await page.goto('/profile/history');
    await page.getByRole('link', { name: '查看回放', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Color Match', exact: true })).toBeVisible();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await expect(page.locator('.color-hand-cards button')).toHaveCount(5);
    await page.locator('.color-hand-cards').evaluate(el => { el.setAttribute('data-replay-instance', 'retained'); });
    for (const button of await page.getByRole('region', { name: '回放棋桌' }).getByRole('button').all()) await expect(button).toBeDisabled();
    let releaseManualFrame!: () => void;
    let manualFrameRequested!: () => void;
    const heldManualFrame = new Promise<void>(resolve => { releaseManualFrame = resolve; });
    const requestedManualFrame = new Promise<void>(resolve => { manualFrameRequested = resolve; });
    await page.route(`**/matches/${id}/replay?revision=1`, async route => {
      manualFrameRequested();
      await heldManualFrame;
      await route.continue();
    }, { times: 1 });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await requestedManualFrame;
    try {
      await expect(page.getByRole('region', { name: '回放棋桌' })).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByLabel('回放进度')).toHaveValue('0');
      await expect(page.locator('.color-hand-cards button')).toHaveCount(5);
      await expect(page.locator('.replay-progress [aria-live]')).toHaveText('初始局面');
      await expect(page.getByText('正在读取回放…', { exact: true })).toHaveCount(0);
    } finally { releaseManualFrame(); }
    await expect(page.getByLabel('回放进度')).toHaveValue('1');
    await expect(page.locator('.color-hand-cards button')).toHaveCount(6);
    await expect(page.locator('.color-hand-cards')).toHaveAttribute('data-replay-instance', 'retained');
    await expect(page.getByRole('region', { name: '行动记录' })).toContainText('摸了 1 张牌');
    await page.getByRole('button', { name: '末尾', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('2');
    await page.getByRole('button', { name: '开头', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await page.getByLabel('回放进度').fill('1');
    await expect(page.getByLabel('回放进度')).toHaveValue('1');
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await page.getByLabel('播放速度').selectOption('4');
    // Hold an automatic frame request open to expose transient control flicker.
    let releaseFrame!: () => void;
    let frameRequested!: () => void;
    const heldFrame = new Promise<void>(resolve => { releaseFrame = resolve; });
    const requestedFrame = new Promise<void>(resolve => { frameRequested = resolve; });
    await page.route(`**/matches/${id}/replay?revision=1`, async route => {
      frameRequested();
      await heldFrame;
      await route.continue();
    }, { times: 1 });
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await requestedFrame;
    try {
      await expect(page.getByRole('region', { name: '回放棋桌' })).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
      await expect(page.getByLabel('回放进度')).toBeEnabled();
    } finally { releaseFrame(); }
    await expect(page.getByLabel('回放进度')).toHaveValue('2');
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await page.getByLabel('播放速度').selectOption('0.5');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const progress = await page.getByLabel('回放进度').boundingBox();
    const play = await page.getByRole('button', { name: '播放', exact: true }).boundingBox();
    expect(progress).toBeTruthy(); expect(play).toBeTruthy();
    expect(play!.y).toBeGreaterThanOrEqual(progress!.y + progress!.height);
    if (info.project.name === 'desktop') {
      const label = await page.locator('label[for="replay-position"]').boundingBox();
      const dock = await page.locator('.chat-dock').boundingBox();
      // The dock may sit on either side; require that it does not cover the label.
      expect(label!.x + label!.width <= dock!.x || dock!.x + dock!.width <= label!.x ||
        label!.y + label!.height <= dock!.y || dock!.y + dock!.height <= label!.y).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('replay.png'), fullPage: true });
    if (info.project.name === 'desktop') {
      await page.setViewportSize({ width: 1024, height: 768 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('replay-laptop.png'), fullPage: true });
    }
    await page.getByRole('link', { name: '返回对局记录' }).click();
    await expect(page).toHaveURL(/profile\/history$/);
    expect(actions).toBe(0);
  } finally { await second.close(); }
});
