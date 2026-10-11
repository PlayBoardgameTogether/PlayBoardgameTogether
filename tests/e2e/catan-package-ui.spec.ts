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

test('updated cover fits the catalog alongside existing geometric artwork', async ({ page }, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/catan-1.0.1.zip'));
  const css = await readFile(new URL('../../apps/web/src/styles/catalog.css', import.meta.url), 'utf8');
  const cards = [{ name: '卡坦岛', cover: parsed.presentation.cover }];
  for (const [name, file] of [['璀璨宝石', 'apps/web/public/game-art/splendor.svg'], ['五子棋', 'game-packages/gomoku/art/cover.svg'], ['花砖物语', 'apps/web/public/game-art/azul.svg']]) {
    const svg = await readFile(file!, 'utf8');
    cards.push({ name: name!, cover: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') });
  }
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--text:#eff0f3;--muted:#b7bec8;--line-strong:#69787e;--accent:#d9c08a}
    *{box-sizing:border-box}body{margin:0;padding:16px;background:#23262c;font-family:"Microsoft YaHei",sans-serif}
    ${css}</style></head><body><div class="game-catalog-grid">
    ${cards.map(card => `<a class="game-card" href="#"><div class="game-cover"><img alt="${card.name}封面" src="${card.cover}"></div><div class="game-card-info"><h3>${card.name}</h3><p class="game-card-desc">经典桌游 · 查看房间</p></div></a>`).join('')}
    </div></body></html>`);
  for (const img of await page.locator('.game-cover img').all()) await img.evaluate((el: HTMLImageElement) => el.decode());
  const cover = page.getByAltText('卡坦岛封面');
  expect(await cover.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight)).toBe(16 / 9);
  const box = (await cover.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true });
});

test('sandbox island placement, trades, modal privacy, busy guards and responsive board', async ({ page }, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/catan-1.0.1.zip'));
  expect(Object.keys(parsed.presentation).sort()).toEqual(['background', 'cover', 'icon']);
  const game = (await PackageRuntime.create()).extension(parsed.server), rng = new DeterministicRng(123);
  let state = game.setup({ seats: ['a', 'b', 'c'], options: {}, rng }).state;
  let seatId = (state as { seats: string[]; start: number }).seats[(state as { start: number }).start]!;
  const received: Json[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = () => game.getView(state, { kind: 'seat', seatId });
  async function publish(busy = false) {
    await page.evaluate(({ next, busy }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy } }));
    }, { next: view(), busy });
  }
  await page.exposeFunction('acceptAction', async (raw: unknown) => {
    const action = game.parseAction(raw); received.push(action); await publish(true);
    state = game.applyAction(state, { kind: 'seat', seatId, controllerEpoch: 0 }, action, rng).state; await publish(false);
  });
  const stylesheet = await platformStyles();
  const fixture = buildSync({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PackageBoard } from './src/games/PackageBoard.tsx';
    const root = createRoot(document.getElementById('root'));
    const render = (view, busy = false) => root.render(<PackageBoard
      id="online.catan" version="1.0.1" view={view} busy={busy} events={[]}
      onAction={action => window.acceptAction(action)} />);
    addEventListener('message', event => { if(event.data?.type==='fixture:view')render(event.data.view,event.data.busy); });
    render(JSON.parse(document.getElementById('initial-view').textContent));
  `, loader: 'tsx', resolveDir: webRoot }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0]!.text;
  await page.route('http://catan.test/**', async route => {
    if (route.request().url().endsWith('/desktop')) await route.fulfill({ contentType: 'text/html', body: parsed.client,
      headers: { 'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'" } });
    else await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><style>${stylesheet}</style>
      <body style="margin:0;background:#23262c;color:white"><div class="match-page">
      <div style="height:120px;padding:20px;background:#23262c">卡坦岛对局 · 实时同步</div><div id="root"></div></div>
      <script id="initial-view" type="application/json">${JSON.stringify(view())}</script><script>${fixture}</script></body></html>` });
  });
  await page.goto('http://catan.test/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toContainText('你 · 放置起始聚落');
  await frame.getByRole('button', { name: '放大棋盘', exact: true }).click();
  await expect(frame.locator('#board')).not.toHaveAttribute('viewBox', '-5 -4.5 10 9');
  await frame.getByRole('button', { name: '全岛', exact: true }).click();
  await expect(frame.locator('#board')).toHaveAttribute('viewBox', '-5 -4.5 10 9');
  await frame.getByRole('button', { name: '选择位置', exact: true }).click();
  await expect(frame.getByLabel('可用位置')).toBeVisible();
  await frame.getByRole('button', { name: '预览位置', exact: true }).click();
  expect(received).toEqual([]);
  await frame.getByRole('button', { name: '取消选择', exact: true }).click();
  await frame.getByRole('button', { name: /^聚落 / }).first().focus();
  await page.keyboard.press('Enter'); expect(received).toEqual([]);
  await expect(frame.getByRole('button', { name: '确认聚落', exact: true })).toBeEnabled();
  await publish(true); await expect(frame.getByRole('button', { name: '确认聚落', exact: true })).toBeDisabled();
  await publish(); await frame.getByRole('button', { name: '确认聚落', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('放置起始道路');
  await frame.getByRole('button', { name: /^道路 / }).first().click();
  await frame.getByRole('button', { name: '确认道路', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('玩家'); expect(received).toHaveLength(2);
  while ((state as { phase: string }).phase.startsWith('setup_')) {
    const snapshot = game.getView(state, { kind: 'seat', seatId }) as { current: number; seats: string[] };
    const currentSeat = snapshot.seats[snapshot.current]!;
    const decision = game.getDecisionContext!(state, { kind: 'seat', seatId: currentSeat })!;
    state = game.applyAction(state, { kind: 'seat', seatId: currentSeat, controllerEpoch: 0 }, decision.legalActions[0]!, rng).state;
  }
  seatId = (state as { seats: string[]; turn: number }).seats[(state as { turn: number }).turn]!;
  await publish(); await expect(frame.getByRole('button', { name: '掷骰', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: '掷骰', exact: true }).click();
  await expect.poll(() => (state as { phase: string }).phase).not.toBe('roll');
  await expect(frame.getByRole('status')).not.toContainText('提交中');
  const arranged = state as { phase: string; resources: number[][]; bank: number[]; discards: number[] };
  arranged.phase = 'main'; arranged.discards = [];
  arranged.resources = [[4, 2, 1, 2, 3], [1, 3, 2, 1, 1], [0, 1, 2, 1, 1]];
  arranged.bank = Array.from({ length: 5 }, (_, r) => 19 - arranged.resources.reduce((s, h) => s + h[r]!, 0));
  state = game.deserialize(state); await publish();
  await frame.getByRole('button', { name: '交易', exact: true }).click();
  await expect(frame.locator('#panel')).toBeVisible();
  await frame.getByLabel('木材提供').fill('1'); await frame.getByLabel('砖块需要').fill('1');
  await frame.getByRole('button', { name: '发出报价', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('回应交易');
  const names = (state as { seats: string[] }).seats;
  seatId = names[(state as { offer: { to: number } }).offer.to]!; await publish();
  await frame.getByRole('button', { name: '查看交易', exact: true }).click();
  await frame.getByRole('button', { name: '还价', exact: true }).click();
  await frame.getByLabel('砖块提供').fill('1'); await frame.getByLabel('木材需要').fill('2');
  await frame.getByRole('button', { name: '提交还价', exact: true }).click();
  await expect(frame.locator('#panel')).not.toBeVisible();
  seatId = names[(state as { offer: { to: number } }).offer.to]!; await publish();
  await frame.getByRole('button', { name: '查看交易', exact: true }).click();
  await frame.getByRole('button', { name: '接受交易', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('交易与建设');
  await frame.getByRole('button', { name: '玩法说明' }).click(); await expect(frame.locator('#rules')).toBeVisible();
  await frame.locator('#rules-close').click();
  const saved = game.serialize(state); await page.reload(); state = game.deserialize(saved); await publish();
  await expect(frame.getByRole('status')).toContainText('交易与建设');
  const child = page.frames().find(f => f.url().endsWith('/desktop'))!;
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await child.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const actionBox = (await frame.getByRole('button', { name: '结束回合', exact: true }).boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('table.png') });
  await frame.getByRole('button', { name: '交易', exact: true }).click();
  await frame.getByLabel('木材提供').fill('1');
  seatId = names[(names.indexOf(seatId) + 1) % 3]!; await publish();
  await expect(frame.locator('#panel')).not.toBeVisible();
  await publish(true); await expect(frame.getByRole('button', { name: '提出交易', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
