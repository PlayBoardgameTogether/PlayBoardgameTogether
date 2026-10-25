import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { DeterministicRng, type Json } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import { platformStyles } from '../fixtures/platform-styles.js';
import setup from './setup.js';

const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { buildSync } = createRequire(webRequire.resolve('vite'))('esbuild');
const gameVersion = process.env.PUERTO_RICO_TEST_VERSION ?? '1.0.0';
if (!/^\d+\.\d+\.\d+$/.test(gameVersion)) throw new Error('Invalid Puerto Rico test version');
const gameZip = `dist/game-packages/puerto-rico-${gameVersion}.zip`;
type Snapshot = {
  current: number;
  move: number;
  phase: string;
  seats: string[];
  players: { vp: number | null; result: unknown }[];
  actions: Json[];
};

test('sandbox board supports previews, keyboard, worker allocation, privacy, themes and restoration', async ({
  page,
}, info) => {
  const parsed = readGamePackage(await readFile(gameZip));
  expect(Object.keys(parsed.presentation).sort()).toEqual(['background', 'cover', 'icon']);
  const game = (await PackageRuntime.create()).extension(parsed.server),
    rng = new DeterministicRng(131);
  let state = game.setup({ seats: ['a', 'b', 'c'], options: {}, rng }).state;
  let seatId = (state as unknown as Snapshot).seats[(state as unknown as Snapshot).current]!;
  const received: Json[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const view = () => game.getView(state, { kind: 'seat', seatId });
  async function publish(busy = false, replay = false) {
    await page.evaluate(
      ({ next, busy, replay }) =>
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy, replay } }),
        ),
      { next: view(), busy, replay },
    );
  }
  await page.exposeFunction('acceptAction', async (raw: unknown) => {
    const action = game.parseAction(raw);
    const actingSeat = seatId;
    await publish(true);
    state = game.applyAction(
      state,
      { kind: 'seat', seatId: actingSeat, controllerEpoch: 0 },
      action,
      rng,
    ).state;
    await publish();
    received.push(action);
  });
  const stylesheet = await platformStyles();
  const fixture = buildSync({
    stdin: {
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {PackageBoard} from './src/games/PackageBoard.tsx';
    const root=createRoot(document.getElementById('root'));
    function render(view,busy=false,replay=false){root.render(<PackageBoard id="online.puerto-rico" version="${gameVersion}" view={view} busy={busy} events={[]} onAction={action=>window.acceptAction(action)} replay={replay?{id:'readonly',animate:false,hold(){}}:undefined}/>);}
    addEventListener('message',event=>{if(event.data?.type==='fixture:view')render(event.data.view,event.data.busy,event.data.replay);});
    render(JSON.parse(document.getElementById('initial-view').textContent));
  `,
      loader: 'tsx',
      resolveDir: webRoot,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0]!.text;
  await page.route('http://puerto.test/**', async (route) => {
    if (route.request().url().includes('/desktop'))
      await route.fulfill({
        contentType: 'text/html',
        body: parsed.client,
        headers: {
          'content-security-policy':
            "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'",
        },
      });
    else
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesheet}</style><body><div class="match-page"><div style="padding:16px">波多黎各 · 联机棋桌</div><div id="root"></div></div><script id="initial-view" type="application/json">${JSON.stringify(view())}</script><script>${fixture}</script></body></html>`,
      });
  });
  await page.goto('http://puerto.test/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toContainText('你 · 选择本轮角色');
  await expect(frame.getByRole('button', { name: '确认行动', exact: true })).toBeDisabled();
  await frame.getByRole('button', { name: /^市长 ·/ }).focus();
  await page.keyboard.press('Enter');
  expect(received).toEqual([]);
  await expect(frame.getByRole('button', { name: /^市长 ·/ })).toBeFocused();
  await publish(true);
  await expect(frame.locator('#confirm')).toBeDisabled();
  await publish();
  await frame.getByRole('button', { name: '确认行动', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('安排全部工人');
  expect(received).toHaveLength(1);
  await frame.getByRole('button', { name: '清空岗位', exact: true }).click();
  await expect(frame.getByRole('button', { name: '确认行动', exact: true })).toBeDisabled();
  const worker = frame.getByRole('spinbutton', { name: /地块 1工人数/ });
  await worker.fill('1');
  await expect(frame.getByRole('button', { name: '确认行动', exact: true })).toBeEnabled();
  await frame.getByRole('button', { name: '确认行动', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('玩家');
  expect(received).toHaveLength(2);
  // Switch viewer to another real rule identity; its private chips remain hidden from the original viewer.
  seatId = (state as unknown as Snapshot).seats[(state as unknown as Snapshot).current]!;
  await publish();
  await frame.getByRole('button', { name: '推荐分配', exact: true }).click();
  await frame.getByRole('button', { name: '确认行动', exact: true }).click();
  await expect.poll(() => received.length).toBe(3);
  const saved = game.serialize(state);
  await page.reload();
  state = game.deserialize(saved);
  await publish();
  await expect(frame.getByRole('status')).toContainText('安排全部工人');
  await frame.getByRole('button', { name: '玩法', exact: true }).click();
  await expect(frame.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.getByRole('dialog')).not.toBeVisible();
  await frame.getByRole('button', { name: '建筑图鉴', exact: true }).click();
  await expect(frame.getByRole('dialog')).toContainText('工厂 · 7 金币');
  await expect(frame.getByRole('dialog')).toContainText('大学 · 8 金币');
  await page.keyboard.press('Escape');
  for (const theme of ['dark', 'light']) {
    const child = page.frames().find((f) => f.url().includes('/desktop'))!;
    await child.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`table-${theme}.png`), fullPage: true });
  }
  const child = page.frames().find((f) => f.url().includes('/desktop'))!;
  expect(
    await child.evaluate(() => {
      try {
        return parent.document.cookie;
      } catch {
        return 'blocked';
      }
    }),
  ).toBe('blocked');
  // Reject messages from the wrong source, and suppress all actions during replay.
  // Inspect real rule-generated warehouse and end-game views, including a full city.
  type Arranged = {
    current: number;
    seats: string[];
    players: { money: number; goods: number[]; city: { id: number; workers: number }[] }[];
    bank: number[];
    buildings: number[];
    workers: number;
    ships: { good: number | null; load: number }[];
    governor: number;
    selected: number;
    roles: { owner: number | null }[];
  };
  let arranged = game.setup({ seats: ['a', 'b', 'c'], options: {}, rng })
    .state as unknown as Arranged;
  const owner = arranged.current;
  arranged.players[owner]!.city.push({ id: 5, workers: 1 });
  arranged.buildings[5]!--;
  arranged.workers--;
  arranged.players[owner]!.goods[3] = 5;
  arranged.bank[3]! -= 5;
  arranged.players[owner]!.goods[4] = 3;
  arranged.bank[4]! -= 3;
  for (let g = 0; g < 3; g++) {
    arranged.ships[g]!.good = g;
    arranged.ships[g]!.load = 1;
    arranged.bank[g]!--;
  }
  state = game.deserialize(arranged);
  seatId = arranged.seats[owner]!;
  state = game.applyAction(
    state,
    { kind: 'seat', seatId, controllerEpoch: 0 },
    { type: 'role', role: 5, privilege: true },
    rng,
  ).state;
  await publish();
  await expect(frame.getByRole('status')).toContainText('保存剩余货物');
  await frame.getByLabel('保存咖啡').fill('2');
  await expect(frame.locator('#confirm')).toBeDisabled();
  await frame.getByLabel('保存咖啡').fill('1');
  await expect(frame.locator('#confirm')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('warehouse.png'), fullPage: true });
  await frame.locator('#confirm').click();
  await expect.poll(() => received.length).toBe(4);
  arranged = game.setup({ seats: ['a', 'b', 'c'], options: {}, rng }).state as unknown as Arranged;
  const finisher = (arranged.governor + 2) % 3;
  arranged.selected = 2;
  arranged.current = finisher;
  arranged.roles[0]!.owner = arranged.governor;
  arranged.roles[1]!.owner = (arranged.governor + 1) % 3;
  arranged.players[finisher]!.money = 30;
  for (const id of [18, 19, 20, 21, 22, 0]) {
    arranged.players[finisher]!.city.push({ id, workers: 1 });
    arranged.buildings[id]!--;
    arranged.workers--;
  }
  state = game.deserialize(arranged);
  seatId = arranged.seats[finisher]!;
  state = game.applyAction(
    state,
    { kind: 'seat', seatId, controllerEpoch: 0 },
    { type: 'role', role: 2, privilege: true },
    rng,
  ).state;
  state = game.applyAction(
    state,
    { kind: 'seat', seatId, controllerEpoch: 0 },
    { type: 'build', building: 1, worker: false },
    rng,
  ).state;
  for (let i = 0; i < 2; i++) {
    const next = state as unknown as Snapshot;
    state = game.applyAction(
      state,
      { kind: 'seat', seatId: next.seats[next.current]!, controllerEpoch: 0 },
      { type: 'pass' },
      rng,
    ).state;
  }
  await publish();
  await expect(frame.getByRole('status')).toContainText('本轮落幕');
  await expect(frame.locator('.result')).toHaveCount(3);
  await expect(frame.locator('.result').first()).toContainText('公会大厅');
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('finished-full-city.png'), fullPage: true });
  const before = await frame.getByRole('status').textContent();
  await child.evaluate(() =>
    dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'boardgame:view', view: { players: [], actions: [] } },
      }),
    ),
  );
  await expect(frame.getByRole('status')).toHaveText(before);
  await publish(false, true);
  expect(received).toHaveLength(4);
  await expect(frame.locator('#confirm')).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}
test('three signed-in players install, join, act and recover through the live platform', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  await setup();
  await login(page, 'stage7_admin');
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
  const dialog = page.getByRole('dialog', { name: '上传并审核游戏 ZIP' });
  await dialog.getByLabel('游戏 ZIP 文件').setInputFiles(gameZip);
  await dialog.getByRole('button', { name: '检查游戏包' }).click();
  await expect(dialog.getByText(/^(新游戏|此版本已安装)$/)).toBeVisible();
  await dialog.getByRole('button', { name: /^(审核通过并上架|确认已安装版本)$/ }).click();
  await expect(dialog).not.toBeVisible();
  const contexts = await Promise.all([
    browser.newContext({ viewport: page.viewportSize()! }),
    browser.newContext({ viewport: page.viewportSize()! }),
  ]);
  try {
    const peers = await Promise.all(contexts.map((c) => c.newPage()));
    await login(peers[0]!, 'stage2_a');
    await login(peers[1]!, 'stage2_b');
    await page.goto(`/games/online.puerto-rico/${gameVersion}`);
    await expect
      .poll(() =>
        page
          .locator('.game-detail-icon img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 256),
      )
      .toBe(true);
    await expect(page.locator('.game-detail-icon img')).toHaveCSS('object-fit', 'contain');
    await expect(page.locator('.game-detail-icon')).toHaveCSS('box-shadow', 'none');
    await expect(page.locator('.game-banner-background img')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('real-game-detail.png'), fullPage: true });
    await page.getByRole('link', { name: '创建房间', exact: true }).click();
    await page.getByLabel('房间名', { exact: true }).fill('海港联机验收');
    await page.getByLabel('人数', { exact: true }).fill('3');
    await page.getByRole('button', { name: '创建并生成邀请码' }).click();
    await expect(page.getByRole('heading', { name: '海港联机验收', exact: true })).toBeVisible();
    const roomUrl = page.url(),
      inviteCode = (await page.getByRole('button', { name: '复制邀请码' }).innerText()).replaceAll(
        '-',
        '',
      );
    for (const peer of peers) {
      const me = (await (await peer.request.get('/api/v1/auth/me')).json()).data;
      expect(
        (
          await peer.request.post('/api/v1/rooms/join', {
            headers: { origin: new URL(roomUrl).origin, 'x-csrf-token': me.csrfToken },
            data: { requestId: crypto.randomUUID(), inviteCode },
          })
        ).ok(),
      ).toBe(true);
      await peer.goto(roomUrl);
      await peer.getByRole('button', { name: '坐这里', exact: true }).first().click();
    }
    for (const [i, peer] of peers.entries()) {
      await expect(peer.getByText(`3/3 已入座 · ${i}/3 已准备`, { exact: true })).toBeVisible();
      await peer.getByRole('button', { name: '准备', exact: true }).click();
      await expect(peer.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
      await expect(page.getByText(`3/3 已入座 · ${i + 1}/3 已准备`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('3/3 已入座 · 2/3 已准备', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    const pages = [page, ...peers];
    for (const p of pages) await expect(p.locator('iframe')).toBeVisible();
    const matchUrl = page.url();
    const snapshots = await Promise.all(
      pages.map(
        async (p) =>
          (
            await (
              await p.request.get(
                new URL(matchUrl).pathname.replace('/matches/', '/api/v1/matches/') + '/view',
              )
            ).json()
          ).data,
      ),
    );
    const current = snapshots[0].view.current,
      acting = pages[current]!,
      board = acting.frameLocator('iframe');
    await expect(board.getByRole('status')).toContainText('你 · 选择本轮角色');
    await board.getByRole('button', { name: /^市长 ·/ }).click();
    await board.getByRole('button', { name: '确认行动', exact: true }).click();
    for (const p of pages)
      await expect(p.frameLocator('iframe').getByRole('status')).toContainText('安排全部工人');
    await board.getByRole('button', { name: '推荐分配', exact: true }).click();
    await board.getByRole('button', { name: '确认行动', exact: true }).click();
    const next = pages[(current + 1) % 3]!;
    await expect(next.frameLocator('iframe').getByRole('status')).toContainText(
      '你 · 安排全部工人',
    );
    await acting.reload();
    await expect(acting.frameLocator('iframe').getByRole('status')).toContainText('玩家');
    const response = await acting.request.get(
      new URL(matchUrl).pathname.replace('/matches/', '/api/v1/matches/') + '/view',
    );
    const recovered = (await response.json()).data;
    expect(recovered.revision).toBe(2);
    expect(
      recovered.view.players
        .filter((_: unknown, i: number) => i !== recovered.view.you)
        .every((p: { vp: unknown; result: unknown }) => p.vp === null && p.result === null),
    ).toBe(true);
    await next
      .frameLocator('iframe')
      .getByRole('button', { name: '推荐分配', exact: true })
      .click();
    await next
      .frameLocator('iframe')
      .getByRole('button', { name: '确认行动', exact: true })
      .click();
    await expect(
      pages[(current + 2) % 3]!.frameLocator('iframe').getByRole('status'),
    ).toContainText('你 · 安排全部工人');
    await acting.screenshot({ path: info.outputPath('real-three-player.png'), fullPage: true });
    expect(await acting.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
