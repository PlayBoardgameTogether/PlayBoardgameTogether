import { platformStyles } from '../fixtures/platform-styles.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { DeterministicRng, type Json } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { buildSync } = createRequire(webRequire.resolve('vite'))('esbuild');
const id = (color: number, number: number) => color * 26 + (number - 1) * 2;
const run = (color: number, number: number, length = 3) => Array.from({ length }, (_, i) => id(color, number + i));

test('catalog artwork fits the real cover and small icon without letterboxing or cropping', async ({ page }, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/rummikub-1.0.3.zip'));
  const css = await readFile(new URL('../../apps/web/src/styles/catalog.css', import.meta.url), 'utf8');
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--text:#eff0f3;--muted:#b7bec8;--line-strong:#69787e;--accent:#d9c08a}
    *{box-sizing:border-box}body{margin:0;padding:12px;background:#1e2527;font-family:"Microsoft YaHei",sans-serif}
    ${css}
    .game-card{max-width:318px;margin:auto}
    </style></head><body><a class="game-card" href="#">
      <div class="game-cover"><img alt="拉密封面" src="${parsed.presentation.cover}"></div>
      <div class="game-card-info"><div class="game-card-heading">
        <div class="game-card-icon"><img alt="拉密图标" src="${parsed.presentation.icon}"></div><h3>拉密</h3>
      </div><p class="game-card-desc">2–4 人经典数字牌桌：30 分破冰、普通百搭与自由重组。支持基础 AI。</p>
      <div class="game-card-footer"><span class="game-card-players">2–4 人</span><span class="game-card-action">查看房间 →</span></div>
      </div></a></body></html>`);
  for (const img of [page.getByAltText('拉密封面'), page.getByAltText('拉密图标')]) {
    await expect(img).toBeVisible();
    await img.evaluate((el: HTMLImageElement) => el.decode());
  }
  const coverRatio = await page.getByAltText('拉密封面').evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
  expect(coverRatio).toBe(16 / 9);
  expect(await page.getByAltText('拉密图标').evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight)).toBe(1);
  expect(parsed.presentation.icon).not.toBe(parsed.presentation.cover);
  const box = (await page.locator('.game-cover').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(coverRatio, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.game-card').screenshot({ path: info.outputPath('catalog-cover.png') });
});

test('real sandbox tile drafting, atomic play, privacy, recovery and responsive motion', async ({ page }, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/rummikub-1.0.3.zip'));
  expect(Object.keys(parsed.presentation).sort()).toEqual(['background', 'cover', 'icon']);
  const game = (await PackageRuntime.create()).extension(parsed.server);
  const rng = new DeterministicRng(7);
  const openingHand = [...run(0, 10), ...run(1, 1), ...run(2, 4), ...run(3, 8), 104, 105];
  const rest = Array.from({ length: 106 }, (_, i) => i).filter(n => !openingHand.includes(n));
  let state = game.deserialize({ seats: ['a', 'b'], hands: [openingHand, rest.splice(0, 14)],
    pool: rest, table: [], opened: [false, false], turn: 0, passes: 0, move: 0, publicLayout: null, layoutSeq: 0 });
  let seatId = 'a';
  const opponent = await page.context().newPage();
  const received: Json[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = () => game.getView(state, { kind: 'seat', seatId });
  async function publish(busy = false, events: Json[] = []) {
    await page.evaluate(({ next, busy, events }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy, events } }));
    }, { next: view(), busy, events });
    if (opponent) await opponent.evaluate(({ next, busy, events }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy, events } }));
    }, { next: game.getView(state, { kind: 'seat', seatId: 'b' }), busy, events });
  }
  await page.exposeFunction('acceptAction', async (raw: unknown) => {
    const action = game.parseAction(raw); received.push(action);
    await publish(true);
    const result = game.applyAction(state, { kind: 'seat', seatId, controllerEpoch: 0 }, action, rng);
    state = result.state; await publish(false, game.projectEvents(result.events, { kind: 'seat', seatId }));
  });
  const stylesheet = await platformStyles();
  const fixture = buildSync({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PackageBoard } from './src/games/PackageBoard.tsx';
    const root = createRoot(document.getElementById('root'));
    const render = (view, busy = false, events = []) => root.render(<PackageBoard
      id="online.rummikub" version="1.0.3" view={view} busy={busy} events={events}
      onAction={action => window.acceptAction(action)} />);
    addEventListener('message', event => {
      if (event.data?.type === 'fixture:view') render(event.data.view, event.data.busy, event.data.events);
    });
    render(JSON.parse(document.getElementById('initial-view').textContent));
  `, loader: 'tsx', resolveDir: webRoot }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0]!.text;
  await page.context().route('http://rummikub.test/**', async route => {
    if (route.request().url().endsWith('/desktop')) await route.fulfill({ contentType: 'text/html', body: parsed.client,
      headers: { 'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'" } });
    else await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><style>${stylesheet}</style>
      <body style="margin:0;background:#23262c;color:white"><div class="match-page">
      <div style="height:145px;padding:24px;background:#23262c"><div style="font-size:24px">拉密对局</div><p>实时同步 · 数字棋桌</p></div><div id="root"></div></div>
      <script id="initial-view" type="application/json">${JSON.stringify(route.request().frame().page() === opponent
        ? game.getView(state, { kind: 'seat', seatId: 'b' }) : view())}</script><script>${fixture}</script></body></html>` });
  });
  await page.goto('http://rummikub.test/');
  const frame = page.frameLocator('iframe');
  let child = page.frames().find(f => f.url().endsWith('/desktop'))!;
  await expect(frame.getByRole('status')).toContainText('轮到你');
  await expect(frame.locator('#rack .tile')).toHaveCount(14);
  await expect(frame.getByRole('button', { name: '确认出牌' })).toBeDisabled();
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await child.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const confirmBox = (await frame.locator('#play').boundingBox())!;
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await frame.getByRole('button', { name: '玩法说明' }).click();
  await expect(frame.getByRole('dialog')).toBeVisible();
  await frame.getByRole('button', { name: '回到棋桌' }).click();
  // Short low-valued opening stays local and cannot submit.
  for (const number of [1, 2, 3]) await frame.locator('#rack').getByRole('button', { name: '蓝 ' + number, exact: true }).click();
  await frame.getByRole('button', { name: '组成新组' }).click();
  expect(await child.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
  await expect(frame.locator('#feedback')).toContainText('还需 24 分');
  await expect(frame.locator('#play')).toBeDisabled(); expect(received).toEqual([]);
  await frame.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(frame.locator('#rack .tile')).toHaveCount(14);
  // Keyboard and touch both use ordinary tile buttons. First form a 33-point opening.
  for (const number of [10, 11, 12]) {
    const tile = frame.locator('#rack').getByRole('button', { name: '红 ' + number, exact: true });
    if (info.project.name === 'desktop') { await tile.focus(); await tile.press('Enter'); }
    else await tile.click();
  }
  await frame.getByRole('button', { name: '组成新组' }).click();
  await expect(frame.locator('#play')).toBeEnabled();
  await expect(frame.locator('#draw')).toBeDisabled();
  await expect.poll(() => child.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.screenshot({ path: info.outputPath('opening.png') });
  // Busy publication must preserve the draft and block action.
  await publish(true); await expect(frame.locator('#play')).toBeDisabled();
  await publish(); await expect(frame.locator('#play')).toBeEnabled();
  await frame.locator('#play').click();
  await expect(frame.getByRole('status')).toContainText('等待玩家 2');
  expect(received).toEqual([{ type: 'play', table: [run(0, 10)] }]);
  await expect(frame.locator('#rack .tile')).toHaveCount(11);
  await expect(frame.locator('#play')).toBeDisabled();
  // Restore exactly, then advance the other participant through the same runtime.
  state = game.deserialize(game.serialize(state));
  state = game.applyAction(state, { kind: 'seat', seatId: 'b', controllerEpoch: 0 }, { type: 'draw' }, rng).state;
  await publish(); await expect(frame.getByRole('status')).toContainText('轮到你');
  await opponent.goto('http://rummikub.test/');
  const otherFrame = opponent.frameLocator('iframe');
  await expect(otherFrame.locator('#table .tile')).toHaveCount(3);
  // Existing table can be split locally. Invalid loose groups prevent submission.
  await frame.locator('#table').getByRole('button', { name: '红 10', exact: true }).click();
  await frame.locator('#new-row').click();
  await expect(frame.locator('#table .invalid')).toHaveCount(2);
  await expect(frame.locator('#play')).toBeDisabled();
  await expect.poll(() => received.length).toBe(2);
  await expect(otherFrame.getByRole('status')).toContainText('正在整理公共牌');
  await expect(otherFrame.locator('#table .invalid')).toHaveCount(2);
  await expect(otherFrame.locator('#table .tile')).toHaveCount(3);
  await expect(otherFrame.locator('#new-row')).toBeDisabled();
  await expect.poll(() => opponent.frames().find(frame => frame.url().endsWith('/desktop'))!
    .evaluate(() => document.getAnimations().length)).toBe(0);
  await opponent.screenshot({ path: info.outputPath('opponent-arrangement.png') });
  await opponent.reload();
  await expect(otherFrame.getByRole('status')).toContainText('正在整理公共牌');
  await expect(otherFrame.locator('#table .invalid')).toHaveCount(2);
  await frame.locator('#undo').click();
  await expect.poll(() => received.length).toBe(3);
  await expect(otherFrame.locator('#table .invalid')).toHaveCount(0);
  await frame.locator('#table').getByRole('button', { name: '红 10', exact: true }).click();
  await frame.locator('#new-row').click();
  await expect.poll(() => received.length).toBe(4);
  await expect(otherFrame.locator('#table .invalid')).toHaveCount(2);
  await frame.locator('#reset').click();
  await expect(frame.locator('#table .invalid')).toHaveCount(0);
  await expect.poll(() => received.length).toBe(5);
  await expect(otherFrame.locator('#table .invalid')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frame.locator('#sort-number').click();
  expect(await child.evaluate(() => document.getAnimations().length)).toBe(0);
  // Players form their own combinations; the removed suggestion control is absent.
  await expect(frame.getByRole('button', { name: '组合建议' })).toHaveCount(0);
  for (const number of [1, 2, 3]) await frame.locator('#rack').getByRole('button', { name: '蓝 ' + number, exact: true }).click();
  await frame.locator('#new-row').click();
  await expect(frame.locator('#play')).toBeEnabled();
  expect(received).toHaveLength(5);
  await expect(otherFrame.locator('#table .tile')).toHaveCount(3);
  await frame.locator('#reset').click();
  await frame.locator('#draw').click();
  await expect(frame.getByRole('status')).toContainText('等待玩家 2');
  expect(received).toHaveLength(6);
  const saved = game.serialize(state); await page.reload(); state = game.deserialize(saved); await publish();
  child = page.frames().find(f => f.url().endsWith('/desktop'))!;
  await expect(frame.locator('#rack .tile')).toHaveCount(12);
  expect(await child.evaluate(() => document.getAnimations().length)).toBe(0);
  // View switching must not retain the old participant's secret rack/draft.
  seatId = 'b'; await publish();
  await expect(frame.locator('#rack .tile')).toHaveCount(15);
  await expect(frame.locator('#rack').getByRole('button', { name: '百搭牌 1', exact: true })).toHaveCount(0);
  await publish(true); await expect(frame.locator('#play')).toBeDisabled();
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('table.png') });
  await opponent.close();
});
