import { test, expect, type Page } from './fixtures.js';
import type { WebSocketRoute } from '@playwright/test';
import type { MatchView, RoomSnapshot } from '@boardgame/protocol';
import { sessionFixture } from '../fixtures/session.js';

declare global {
  interface Window {
    networkCompletedReads: number;
  }
}

const id = '00000000-0000-4000-8000-000000000001';
const roomId = '00000000-0000-4000-8000-000000000002';
const room: RoomSnapshot = {
  id: roomId,
  name: '网络恢复测试',
  status: 'in_game',
  hostAccountId: sessionFixture().account.id,
  gameId: 'demo.counter-room',
  gameVersion: '1.0.0',
  options: {},
  seatCount: 2,
  roomRevision: 2,
  activeMatchId: id,
  assetVersionId: null,
  matchStatus: 'active',
  visibility: 'private',
  hasPassword: false,
  members: [],
  seats: [],
  permissions: { isHost: true, canConfigure: false, canStart: false },
  startBlockers: [],
};
const snapshot: MatchView = {
  matchId: id,
  roomId,
  gameId: 'demo.counter-room',
  gameVersion: '1.0.0',
  revision: 1,
  status: 'active',
  seatIndex: 0,
  delivery: 'snapshot',
  controller: { type: 'human', controllerEpoch: 0, controllerVersion: 0, policyId: null },
  aiStatus: { status: 'idle', version: 0, safeErrorCode: null },
  view: {
    seats: ['a', 'b'],
    scores: { a: 0, b: 0 },
    activeSeatId: 'a',
    viewingSeatId: 'a',
    myHint: 7,
    targetScore: 3,
    outcome: { status: 'ongoing' },
  },
};
const envelope = (data: unknown) => ({ ok: true, data, traceId: 'network-fixture' });

async function mockSession(page: Page) {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: envelope(sessionFixture()) }),
  );
  await page.route('**/api/v1/social', (route) =>
    route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'fixture', retryable: true },
        traceId: 'fixture',
      },
    }),
  );
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    window.networkCompletedReads = 0;
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/matches/') && url.endsWith('/view')) {
        const json = response.json.bind(response);
        response.json = async () => {
          const data: unknown = await json();
          window.networkCompletedReads++;
          return data;
        };
      }
      return response;
    };
  });
}

async function completedReads(page: Page) {
  return page.evaluate(() => window.networkCompletedReads);
}

test('overlapping focus recovery shares one HTTP read and later focus reads fresh authority', async ({
  page,
}) => {
  await mockSession(page);
  let reads = 0;
  let hold: Promise<void> | undefined;
  let release!: () => void;
  let activeSocket: WebSocketRoute | undefined;
  await page.route(`**/api/v1/matches/${id}/view`, async (route) => {
    reads++;
    if (hold) await hold;
    await route.fulfill({ json: envelope(snapshot) });
  });
  await page.routeWebSocket('**/api/v1/ws/session', (socket) => {
    activeSocket = socket;
    socket.onMessage(() => {
      socket.send(JSON.stringify({ type: 'room.snapshot', roomId, snapshot: room }));
      socket.send(
        JSON.stringify({
          protocolVersion: 1,
          type: 'match.snapshot',
          matchId: id,
          revision: 1,
          snapshot,
        }),
      );
    });
  });
  await page.goto(`/matches/${id}`);
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await expect(page.getByText('你的私密提示：')).toContainText('7');
  const baseline = reads;
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  activeSocket!.send('{invalid-json');
  await expect(page.getByText('连接中断或正在同步，操作已暂停。')).toBeVisible();
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => reads).toBe(baseline + 1);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('focus'));
  });
  expect(reads).toBe(baseline + 1);
  release();
  hold = undefined;
  await expect.poll(() => completedReads(page)).toBeGreaterThanOrEqual(baseline + 1);
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBe(baseline + 2);
});

test('HTTP success does not reset WS backoff and a later subscription recovers without login', async ({
  page,
}) => {
  await mockSession(page);
  await page.clock.install();
  let reads = 0;
  let attempts = 0;
  let activeSocket: WebSocketRoute | undefined;
  await page.route(`**/api/v1/matches/${id}/view`, (route) => {
    reads++;
    return route.fulfill({ json: envelope(snapshot) });
  });
  await page.routeWebSocket('**/api/v1/ws/session', (socket) => {
    attempts++;
    activeSocket = socket;
    socket.onMessage(() => {
      socket.send(JSON.stringify({ type: 'room.snapshot', roomId, snapshot: room }));
      socket.send(
        JSON.stringify({
          protocolVersion: 1,
          type: 'match.snapshot',
          matchId: id,
          revision: 1,
          snapshot,
        }),
      );
    });
    if (attempts === 2) socket.close({ code: 1013, reason: 'temporary service failure' });
  });
  await page.goto(`/matches/${id}`);
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const beforeFailure = reads;
  activeSocket!.close({ code: 1013, reason: 'temporary service failure' });
  await expect(page.getByText('连接中断或正在同步，操作已暂停。')).toBeVisible();
  await expect.poll(() => reads).toBe(beforeFailure + 1);
  await expect.poll(() => completedReads(page)).toBe(reads);
  await page.clock.runFor(750);
  await expect.poll(() => attempts).toBe(2);
  await expect.poll(() => reads).toBe(beforeFailure + 2);
  await expect.poll(() => completedReads(page)).toBe(reads);
  await page.clock.runFor(1000);
  expect(attempts).toBe(2);
  await page.clock.runFor(500);
  await expect.poll(() => attempts).toBe(3);
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '会话已失效' })).toHaveCount(0);
  await expect(page.getByText('你的私密提示：')).toContainText('7');
  activeSocket!.close({ code: 4001, reason: 'session revoked' });
  await expect(page.getByRole('heading', { name: '会话已失效' })).toBeVisible();
  await expect(page.getByText('你的私密提示：')).toHaveCount(0);
  await page.clock.runFor(16000);
  expect(attempts).toBe(3);
});

test('a match finishing between HTTP initialization and room subscription is recovered immediately', async ({
  page,
}) => {
  await mockSession(page);
  let reads = 0;
  const waitingRoom: RoomSnapshot = {
    ...room,
    status: 'waiting',
    activeMatchId: null,
    matchStatus: null,
  };
  await page.route(`**/api/v1/rooms/${roomId}`, (route) =>
    route.fulfill({ json: envelope(waitingRoom) }),
  );
  await page.route(`**/api/v1/matches/${id}/view`, (route) => {
    reads++;
    return route.fulfill({
      json: envelope({ ...snapshot, status: reads === 1 ? 'active' : 'finished' }),
    });
  });
  await page.routeWebSocket('**/api/v1/ws/session', (socket) => {
    socket.onMessage(() =>
      socket.send(JSON.stringify({ type: 'room.snapshot', roomId, snapshot: waitingRoom })),
    );
  });
  await page.goto(`/matches/${id}`);
  // A waiting room does not send the old match; do not wait for the 15-second poll.
  await expect(page).toHaveURL(`/rooms/${roomId}`, { timeout: 5000 });
  expect(reads).toBeGreaterThanOrEqual(2);
});
