import { platformStyles } from '../fixtures/platform-styles.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { DeterministicRng, type Json } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

// Use Vite's existing bundler to exercise the real React iframe container.
const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { buildSync } = createRequire(webRequire.resolve('vite'))('esbuild');

test('sandbox desktop completes a QuickJS game and restores the authoritative board', async ({ page }, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/gomoku-1.0.3.zip'));
  expect(Object.keys(parsed.presentation!)).toEqual(['icon', 'cover', 'background']);
  expect(parsed.client).toContain(parsed.presentation!.background);
  expect(parsed.client).not.toContain('__GOMOKU_BACKGROUND__');
  const game = (await PackageRuntime.create()).extension(parsed.server);
  const rng = new DeterministicRng(7);
  let state = game.setup({ seats: ['a', 'b'], options: {}, rng }).state;
  let seatId = 'a';
  let received: Json[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = () => game.getView(state, { kind: 'seat', seatId });
  async function publish(busy = false) {
    await page.evaluate(({ next, busy }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy } }));
    }, { next: view(), busy });
  }
  await page.exposeFunction('acceptAction', async (raw: unknown) => {
    const action = game.parseAction(raw);
    received.push(action);
    state = game.applyAction(state, { kind: 'seat', seatId, controllerEpoch: 0 }, action, rng).state;
    await publish();
  });
  const stylesheet = await platformStyles();
  const fixture = buildSync({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PackageBoard } from './src/games/PackageBoard.tsx';
      const root = createRoot(document.getElementById('root'));
      const render = (view, busy = false) => root.render(<PackageBoard
        id="online.gomoku" version="1.0.3" view={view} busy={busy} events={[]}
        onAction={action => window.acceptAction(action)} />);
      addEventListener('message', event => {
        if (event.data?.type === 'fixture:view') render(event.data.view, event.data.busy);
      });
      render(JSON.parse(document.getElementById('initial-view').textContent));
    `, loader: 'tsx', resolveDir: webRoot },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0]!.text;
  await page.route('http://gomoku.test/**', async route => {
    if (route.request().url().endsWith('/desktop')) {
      await route.fulfill({
        contentType: 'text/html', body: parsed.client,
        headers: { 'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'" },
      });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <style>${stylesheet}</style>
        <body style="margin:0;background:#23262c;color:white">
        <div class="match-page"><header style="height:160px;padding:16px"><h1>五子棋对局</h1><p>实时同步 · 你的座位 1</p></header><div id="root"></div></div>
        <script id="initial-view" type="application/json">${JSON.stringify(view())}</script>
        <script>${fixture}</script></body></html>` });
    }
  });
  await page.goto('http://gomoku.test/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('轮到你落子');
  // A full-page screenshot hid this regression: the board must fit the visible viewport.
  const visibleBottom = page.viewportSize()!.height;
  const initialBoard = (await frame.locator('#board').boundingBox())!;
  const initialConfirm = (await frame.getByRole('button', { name: '确认落子' }).boundingBox())!;
  expect(initialBoard.y + initialBoard.height).toBeLessThanOrEqual(visibleBottom);
  expect(initialConfirm.y + initialConfirm.height).toBeLessThanOrEqual(visibleBottom);
  const childFrame = page.frames().find(item => item.url().endsWith('/desktop'))!;
  const fits = () => childFrame.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1);
  await expect.poll(fits).toBe(true);
  const boardWidth = (await frame.locator('#board').boundingBox())!.width;
  expect(boardWidth).toBeGreaterThan(info.project.name === 'mobile' ? 270 : 350);
  const originalHeight = (await page.locator('iframe').boundingBox())!.height;
  await frame.getByRole('button', { name: '玩法说明', exact: true }).click();
  await expect(frame.getByRole('dialog', { name: '玩法说明' })).toBeVisible();
  expect((await page.locator('iframe').boundingBox())!.height).toBe(originalHeight);
  await expect.poll(fits).toBe(true);
  await frame.getByRole('button', { name: '关闭说明' }).click();
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBe(originalHeight);
  // Untrusted parent messages and invalid child dimensions must not resize the container.
  await page.evaluate(() => window.postMessage({ type: 'boardgame:resize', height: 4096 }, '*'));
  await childFrame.evaluate(() => {
    for (const height of [0, -1, 4097, NaN, Infinity, '900']) {
      parent.postMessage({ type: 'boardgame:resize', height }, '*');
    }
  });
  await frame.getByRole('button', { name: 'H8 空位', exact: true }).focus();
  expect((await page.locator('iframe').boundingBox())!.height).toBe(originalHeight);
  await frame.getByRole('button', { name: 'H8 空位', exact: true }).click();
  await expect(frame.getByText('已选择 H8')).toBeVisible();
  expect(received).toHaveLength(0);
  await frame.getByRole('button', { name: '确认落子' }).click();
  await expect(frame.getByRole('status')).toHaveText('等待白棋落子');
  expect(received).toEqual([{ type: 'place', x: 7, y: 7 }]);
  await expect(frame.getByRole('button', { name: 'H8 黑棋' })).toHaveAttribute('aria-disabled', 'true');
  await expect(frame.getByRole('button', { name: '确认落子' })).toBeDisabled();
  const child = page.frames().find(item => item.url().endsWith('/desktop'))!;
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await child.evaluate(() => { try { return parent.document.cookie; } catch { return 'blocked'; } })).toBe('blocked');
  state = game.deserialize(game.serialize(state));
  await page.reload();
  await expect(frame.getByRole('button', { name: 'H8 黑棋' })).toBeVisible();
  await expect(frame.getByText('第 1 手 · 最后落子 H8')).toBeVisible();

  // Recover an ongoing public position, then use each player's real View to finish through the bridge.
  state = game.setup({ seats: ['a', 'b'], options: {}, rng }).state;
  received = [];
  for (let i = 0; i < 5; i++) {
    seatId = 'a';
    await publish();
    await frame.getByRole('button', { name: String.fromCharCode(65 + i) + '1 空位', exact: true }).click();
    await publish(true);
    await expect(frame.getByRole('button', { name: '确认落子' })).toBeDisabled();
    await publish(false);
    await frame.getByRole('button', { name: String.fromCharCode(65 + i) + '1 空位', exact: true }).click();
    await frame.getByRole('button', { name: '确认落子' }).click();
    if (i < 4) {
      await expect(frame.getByRole('status')).toHaveText('等待白棋落子');
      seatId = 'b';
      await publish();
      await frame.getByRole('button', { name: 'O' + (i * 2 + 1) + ' 空位', exact: true }).click();
      await frame.getByRole('button', { name: '确认落子' }).click();
      await expect(frame.getByRole('status')).toHaveText('等待黑棋落子');
    }
  }
  await expect(frame.getByRole('status')).toHaveText('你获胜了');
  expect(game.getOutcome(state)).toEqual({ status: 'finished', winners: ['a'] });
  expect(received).toHaveLength(9);
  await expect(frame.locator('.stone.win')).toHaveCount(5);
  await expect(frame.getByRole('button', { name: '确认落子' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('gomoku-finished.png') });
  expect(await page.frames().find(item => item.url().endsWith('/desktop'))!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  state = game.setup({ seats: ['a', 'b'], options: {}, rng }).state;
  await publish();
  await frame.getByRole('button', { name: 'H8 空位' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(frame.getByText('已选择 I8')).toBeVisible();
  await page.screenshot({ path: info.outputPath('gomoku-selection.png') });
  await page.setViewportSize({ width: 390, height: 600 });
  const resizedChild = page.frames().find(item => item.url().endsWith('/desktop'))!;
  await expect.poll(() => resizedChild.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  expect(await resizedChild.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const resizedBoard = (await frame.locator('#board').boundingBox())!;
  const resizedConfirm = (await frame.getByRole('button', { name: '确认落子' }).boundingBox())!;
  expect(resizedBoard.y + resizedBoard.height).toBeLessThanOrEqual(600);
  expect(resizedConfirm.y + resizedConfirm.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // Old hosts ignore the optional fit hint: a fixed 560px frame must still show every row.
  await page.route('http://gomoku.test/legacy', route => route.fulfill({
    contentType: 'text/html', body: '<body style="margin:0"><iframe sandbox="allow-scripts" src="/desktop" style="width:100%;height:560px;border:0"></iframe></body>',
  }));
  await page.goto('http://gomoku.test/legacy');
  const legacy = page.frameLocator('iframe');
  await expect(legacy.locator('#board .point')).toHaveCount(225);
  const legacyChild = page.frames().find(item => item.url().endsWith('/desktop'))!;
  expect(await legacyChild.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const legacyConfirm = (await legacy.getByRole('button', { name: '确认落子' }).boundingBox())!;
  expect(legacyConfirm.y + legacyConfirm.height).toBeLessThanOrEqual(560);
  expect(errors).toEqual([]);
});
