import { openRoomCreation, openInviteJoin } from './fixtures.js';
import { expect, test, type BrowserContext, type Page } from './fixtures.js';

test('two browsers play Color Match from login to a saved winner', async ({ browser, viewport, isMobile, hasTouch, deviceScaleFactor }, testInfo) => {
  test.setTimeout(120_000);
  const device = { viewport, isMobile, hasTouch, deviceScaleFactor };
  const first = await browser.newContext(device);
  const second = await browser.newContext(device);
  let dropA = false;
  let dropB = false;
  let dropPongA = false;
  let droppedPongs = 0;
  let dropped = 0;
  let third: { context: BrowserContext; page: Page } | undefined;
  let releaseOldSnapshot: (() => void) | undefined;
  let releaseOldView: (() => void) | undefined;
  let secondAliceTab: Page | undefined;
  let racedTabs = false;
  await first.routeWebSocket('**/api/v1/ws/session', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const value = JSON.parse(String(message));
      if (dropPongA && value.type === 'pong') { droppedPongs++; return; }
      if (dropA && value.type === 'match.snapshot' && value.revision === 2) {
        dropA = false; dropped++; return;
      }
      socket.send(message);
    });
  });
  await second.routeWebSocket('**/api/v1/ws/session', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const value = JSON.parse(String(message));
      if (dropB && value.type === 'match.snapshot' && value.revision === 2) {
        dropB = false; dropped++; return;
      }
      socket.send(message);
    });
  });
  const a = await first.newPage();
  const b = await second.newPage();
  const sockets = { active: 0, max: 0 };
  let documentGeneration = 0;
  a.on('domcontentloaded', () => {
    // Chromium need not emit websocket.close for a destroyed document.
    // SPA navigation does not fire this event; duplicate live sockets still fail.
    documentGeneration++;
    sockets.active = 0;
  });
  a.on('websocket', socket => {
    if (!socket.url().includes('/api/v1/ws/session')) return;
    const generation = documentGeneration;
    sockets.active++;
    sockets.max = Math.max(sockets.max, sockets.active);
    socket.on('close', () => {
      if (generation === documentGeneration) sockets.active--;
    });
  });
  async function login(page: typeof a, username: string) {
    await page.goto('/login');
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码').fill('stage two password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  }
  try {
    await login(a, 'stage3_a');
    await login(b, 'stage3_b');
    await openRoomCreation(a);
    await a.getByLabel('游戏与版本').selectOption('color-match@1.0.0');
    await expect(a.getByLabel('游戏与版本')).toHaveValue('color-match@1.0.0');
    await expect(a.getByLabel('游戏选项（JSON）')).toHaveValue('{}');
    await a.getByLabel('房间名').fill('Color Match 验收');
    await a.getByRole('button', { name: '创建并生成邀请码' }).click();
    await expect(a.getByRole('heading', { name: 'Color Match 验收', exact: true })).toBeVisible();
    await expect(a.locator('.room-heading')).toContainText('Color Match');
    await a.getByText('房间设置', { exact: true }).click();
    await expect(a.getByText('游戏版本：1.0.0', { exact: true })).toBeVisible();
    await a.getByText('房间设置', { exact: true }).click();
    if (!await a.locator('.invite-box strong').isVisible()) await a.getByText('邀请朋友', { exact: true }).click();
    await expect(a.locator('.invite-box strong')).toBeVisible();
    const invite = await a.locator('.invite-box strong').textContent();
    expect(invite).toBeTruthy();
    await openInviteJoin(b); await b.getByLabel('12 位邀请码').fill(invite!);
    await b.getByRole('button', { name: '加入私人房间' }).click();
    await b.getByRole('button', { name: '坐这里' }).click();
    await b.getByRole('button', { name: '准备', exact: true }).click();
    await expect(a.getByText(/已准备 ·/)).toBeVisible();
    await a.getByRole('button', { name: '准备', exact: true }).click();
    await expect(a.getByRole('button', { name: '开始游戏' })).toBeEnabled();
    await a.getByRole('button', { name: '开始游戏' }).click();
    await expect(a.getByRole('heading', { name: 'Color Match', exact: true })).toBeVisible();
    await expect(b.getByRole('heading', { name: 'Color Match', exact: true })).toBeVisible();
    await expect(a.locator('.color-hand-cards button')).toHaveCount(5, { timeout: 15_000 });
    await expect(b.locator('.color-hand-cards button')).toHaveCount(5, { timeout: 15_000 });
    await a.screenshot({ path: testInfo.outputPath('color-initial.png'), fullPage: true });
    for (let revision = 0; revision < 300; revision++) {
      if (await a.getByRole('region', { name: '本局已结束', exact: true }).count()) break;
      const active = await a.getByText('轮到你行动', { exact: true }).count() ||
        await a.getByText('请选择一名目标玩家', { exact: true }).count() ? a : b;
      const target = active.getByRole('button', { name: '指定摸牌' }).first();
      const card = active.locator('.color-hand-cards button:not([disabled])').first();
      if (revision === 2) {
        secondAliceTab = await first.newPage();
        await secondAliceTab.goto(a.url());
        await expect(secondAliceTab.getByText('对局 · revision 2')).toBeVisible();
        await expect(secondAliceTab.getByText('连接中断或正在同步，操作已暂停。')).toHaveCount(0);
      }
      let resolveFault: (() => void) | undefined;
      let rejectFault: ((cause: unknown) => void) | undefined;
      const faultHandled = revision === 0 ? new Promise<void>((resolve, reject) => { resolveFault = resolve; rejectFault = reject; }) : undefined;
      if (revision === 1) {
        if (active === a) dropB = true;
        else dropA = true;
        const context = await browser.newContext(device);
        await context.routeWebSocket('**/api/v1/ws/session', socket => {
          const server = socket.connectToServer();
          server.onMessage(message => {
            const value = JSON.parse(String(message));
            if (!releaseOldSnapshot && value.type === 'match.snapshot' && value.revision === 1) {
              releaseOldSnapshot = () => socket.send(message);
              return;
            }
            socket.send(message);
          });
        });
        const page = await context.newPage();
        third = { context, page };
        await login(page, 'stage3_a');
        await page.goto(a.url());
        await expect(page.getByText('对局 · revision 1')).toBeVisible();
        await expect.poll(() => Boolean(releaseOldSnapshot)).toBe(true);
        await expect(page.getByText('连接中断或正在同步，操作已暂停。')).toBeVisible();
      }
      if (revision === 0) await active.route('**/api/v1/matches/*/actions', async route => {
        try {
          const request = route.request();
          const headers = request.headers();
          const committed = await fetch(request.url(), {
            method: 'POST',
            headers: { origin: headers.origin!, cookie: headers.cookie!, 'x-csrf-token': headers['x-csrf-token']!, 'content-type': 'application/json' },
            body: request.postData(),
          });
          expect(committed.status).toBe(200);
          await route.abort('failed');
          resolveFault?.();
        } catch (cause) { rejectFault?.(cause); }
      });
      if (secondAliceTab && !racedTabs && active === a && revision >= 2) {
        const response = await a.evaluate(async matchId => (await (await fetch(`/api/v1/matches/${matchId}/view`)).json()).data.view, new URL(a.url()).pathname.split('/').at(-1)!);
        const action = response.phase === 'choose_target'
          ? { type: 'choose_target', targetSeatId: response.targetSeatIds[0] }
          : { type: 'draw_card' };
        const matchId = new URL(a.url()).pathname.split('/').at(-1)!;
        const submit = (page: Page) => page.evaluate(async input => {
          const me = await (await fetch('/api/v1/auth/me')).json();
          const result = await fetch(`/api/v1/matches/${input.matchId}/actions`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': me.data.csrfToken },
            body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: input.revision, action: input.action }),
          });
          return result.status;
        }, { matchId, revision, action });
        const results = await Promise.all([submit(a), submit(secondAliceTab)]);
        expect(results.sort()).toEqual([200, 409]);
        racedTabs = true;
        await secondAliceTab.close();
        secondAliceTab = undefined;
      } else if (await target.count()) { await target.click(); await active.getByRole('button', { name: '确认目标' }).click(); }
      else if (await card.count()) { await card.click(); await active.getByRole('button', { name: '出牌', exact: true }).click(); }
      else await active.getByRole('button', { name: '摸牌或跳过并结束回合' }).click();
      if (revision === 0) {
        await faultHandled;
        await active.unroute('**/api/v1/matches/*/actions');
        await active.reload();
      }
      await expect.poll(async () => await a.getByText(`对局 · revision ${revision + 1}`).count() > 0 || await a.getByRole('region', { name: '本局已结束', exact: true }).count() > 0, { timeout: revision === 1 ? 20_000 : 5_000 }).toBe(true);
      await expect.poll(async () => await b.getByText(`对局 · revision ${revision + 1}`).count() > 0 || await b.getByRole('region', { name: '本局已结束', exact: true }).count() > 0, { timeout: revision === 1 ? 20_000 : 5_000 }).toBe(true);
      if (revision === 0) {
        const passive = active === a ? b : a;
        await expect(passive.getByRole('region', { name: '行动记录' }).getByRole('listitem').first()).toBeVisible();
        await expect(active.getByRole('region', { name: '行动记录' }).getByRole('listitem')).toHaveCount(0);
        await active.context().setOffline(true);
        await active.evaluate(() => window.dispatchEvent(new Event('offline')));
        await expect(active.getByText('连接中断或正在同步，操作已暂停。')).toBeVisible();
        await active.screenshot({ path: testInfo.outputPath('offline-real.png'), fullPage: true });
        await active.context().setOffline(false);
        await active.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(active.getByText('连接中断或正在同步，操作已暂停。')).toHaveCount(0, { timeout: 20_000 });
      }
      if (revision === 1) {
        expect(dropped).toBe(1);
        await expect(third!.page.getByText('对局 · revision 2')).toBeVisible();
        releaseOldSnapshot?.();
        await expect(third!.page.getByText('对局 · revision 1')).toHaveCount(0);
        await third!.context.close();
        third = undefined;
      }
    }
    for (const page of [a, b]) {
      await expect(page).toHaveURL(/\/rooms\//);
      await expect(page.getByRole('region', { name: '本局已结束', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
      await page.getByRole('link', { name: '查看本局结果' }).click();
    }
    await expect(a.locator('.page-heading').getByText(/已结束/)).toBeVisible();
    await expect(b.locator('.page-heading').getByText(/已结束/)).toBeVisible();
    await expect(a.getByRole('region', { name: '结束页面' })).toBeVisible();
    await expect(b.getByRole('region', { name: '结束页面' })).toBeVisible();
    await a.screenshot({ path: testInfo.outputPath('color-finished.png'), fullPage: true });
    expect(racedTabs).toBe(true);
    await a.reload();
    await expect(a.locator('.page-heading').getByText(/已结束/)).toBeVisible();
    const savedMatchUrl = a.url();
    await a.evaluate(async () => {
      const me = await (await fetch('/api/v1/auth/me')).json();
      await fetch('/api/v1/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': me.data.csrfToken },
      });
    });
    await expect(a.getByRole('heading', { name: '会话已失效' })).toBeVisible();
    await login(a, 'stage3_a');
    const heartbeatStart = new Date('2026-10-01T00:00:00Z');
    await a.clock.install({ time: heartbeatStart });
    // Let the lazy route render before freezing time for the heartbeat test.
    await a.goto(savedMatchUrl);
    await expect(a.locator('.page-heading').getByText(/已结束/)).toBeVisible();
    await expect(a.getByText('连接中断或正在同步，操作已暂停。')).toHaveCount(0);
    await a.clock.pauseAt(await a.evaluate(() => new Date(Date.now() + 1000).toISOString()));
    dropPongA = true;
    // Freeze after the 80s heartbeat deadline, before the 1s reconnect timer.
    await a.clock.runFor(80_000);
    expect(droppedPongs).toBeGreaterThan(0);
    await expect.poll(() => a.getByText('连接中断或正在同步，操作已暂停。').count()).toBeGreaterThan(0);
    dropPongA = false;
    await a.clock.fastForward(1_000);
    await expect(a.getByText('连接中断或正在同步，操作已暂停。')).toHaveCount(0, { timeout: 20_000 });
    // Subsequent reload/navigation assertions exercise normal rendering timers.
    await a.clock.resume();
    for (let index = 0; index < 3; index++) {
      await a.reload();
      await expect(a.locator('.page-heading').getByText(/已结束/)).toBeVisible();
      await expect.poll(() => sockets.active).toBe(1);
      expect(sockets.max).toBe(1);
    }
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const oldMatchId = new URL(a.url()).pathname.split('/').at(-1)!;
    let resolveOldView!: () => void;
    let markOldViewCaptured!: () => void;
    const oldViewGate = new Promise<void>(resolve => { resolveOldView = resolve; });
    const oldViewCaptured = new Promise<void>(resolve => { markOldViewCaptured = resolve; });
    releaseOldView = resolveOldView;
    await a.route(`**/api/v1/matches/${oldMatchId}/view`, async route => {
      const response = await route.fetch();
      markOldViewCaptured();
      await oldViewGate;
      await route.fulfill({ response });
    });
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await oldViewCaptured;
    await a.getByRole('button', { name: '返回房间' }).click();
    await b.getByRole('button', { name: '返回房间' }).click();
    for (const page of [a, b]) {
      await expect(page).toHaveURL(/\/rooms\//);
      await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await a.screenshot({path:testInfo.outputPath('waiting-after-win.png'),fullPage:true});
    await b.getByRole('button', { name: '准备', exact: true }).click();
    await expect(a.getByText(/已准备 ·/)).toBeVisible();
    await a.getByRole('button', { name: '准备', exact: true }).click();
    await a.getByRole('button', { name: '开始游戏' }).click();
    await expect(a).toHaveURL(/\/matches\//);
    await expect(b).toHaveURL(a.url());
    expect(a.url()).not.toBe(savedMatchUrl);
    releaseOldView();
    releaseOldView = undefined;
    await expect(a.getByText('对局 · revision 0')).toBeVisible();
    await expect(a.locator('.color-hand-cards button')).toHaveCount(5);
  } finally {
    releaseOldView?.();
    await secondAliceTab?.close();
    await third?.context.close();
    await first.close();
    await second.close();
  }
});
