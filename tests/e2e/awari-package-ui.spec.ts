import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { DeterministicRng, type Json } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import { platformStyles } from '../fixtures/platform-styles.js';

const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { buildSync } = createRequire(webRequire.resolve('vite'))('esbuild');

test('sandbox sowing previews, confirmation, busy recovery, orientation and final result', async ({
  page,
}, info) => {
  const parsed = readGamePackage(await readFile('dist/game-packages/awari-1.0.0.zip'));
  expect(Object.keys(parsed.presentation!)).toEqual(['icon', 'cover']);
  const game = (await PackageRuntime.create()).extension(parsed.server);
  const rng = new DeterministicRng(7);
  let state = game.setup({ seats: ['a', 'b'], options: {}, rng }).state;
  let seatId = 'a';
  const received: Json[] = [],
    errors: string[] = [];
  let publishedEvents: Json[] = [];
  let rejectNext = false;
  page.on('pageerror', (error) => errors.push(error.message));
  const view = () => game.getView(state, { kind: 'seat', seatId });
  const publish = async (busy = false) =>
    page.evaluate(
      ({ next, busy, events }) => {
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'fixture:view', view: next, busy, events } }),
        );
      },
      { next: view(), busy, events: publishedEvents },
    );
  await page.exposeFunction('acceptAction', async (raw: unknown) => {
    received.push(game.parseAction(raw));
    if (rejectNext) {
      rejectNext = false;
      await publish(true);
      await publish(false);
      return;
    }
    const result = game.applyAction(
      state,
      { kind: 'seat', seatId, controllerEpoch: 0 },
      game.parseAction(raw),
      rng,
    );
    state = result.state;
    publishedEvents = game.projectEvents(result.events, { kind: 'seat', seatId });
    await publish();
  });
  const stylesheet = await platformStyles();
  const fixture = buildSync({
    stdin: {
      contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PackageBoard } from './src/games/PackageBoard.tsx';
      const root = createRoot(document.getElementById('root'));
      const render = (view, busy = false, events = []) => root.render(<PackageBoard
        id="online.awari" version="1.0.0" view={view} busy={busy} events={events}
        onAction={action => window.acceptAction(action)} />);
      addEventListener('message', event => {
        if (event.data?.type === 'fixture:view') render(event.data.view, event.data.busy, event.data.events);
      });
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
  await page.route('http://awari.test/**', async (route) => {
    if (route.request().url().endsWith('/desktop')) {
      await route.fulfill({
        contentType: 'text/html',
        body: parsed.client,
        headers: {
          'content-security-policy':
            "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'",
        },
      });
    } else
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesheet}</style><body style="margin:0"><div id="root"></div><script id="initial-view" type="application/json">${JSON.stringify(view())}</script><script>${fixture}</script></body></html>`,
      });
  });
  await page.goto('http://awari.test/');
  const frame = page.frameLocator('iframe');
  const confirm = frame.getByRole('button', { name: '确认播种', exact: true });
  await expect(frame.getByRole('status')).toHaveText('轮到你播种');
  await expect(frame.locator('.pit')).toHaveCount(12);
  await frame.locator('[data-pit="0"]').click();
  await expect(frame.locator('#preview')).toContainText('末子落在 E 坑');
  await expect(frame.locator('[data-pit="4"]')).toHaveClass(/landing/);
  await expect(frame.locator('.incoming').filter({ hasText: '+1' })).toHaveCount(4);
  expect(received).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('awari-selected.png') });
  await publish(true);
  await expect(confirm).toBeDisabled();
  await publish(false);
  await expect(confirm).toBeDisabled();
  // A definitive rejected action must unlock the same revision for a fresh human confirmation.
  rejectNext = true;
  await frame.locator('[data-pit="0"]').click();
  await confirm.click();
  await expect(frame.getByRole('status')).toHaveText('轮到你播种');
  await frame.locator('[data-pit="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(frame.getByRole('status')).toHaveText('等待对手播种');
  expect(received).toEqual([
    { type: 'sow', pit: 0 },
    { type: 'sow', pit: 0 },
  ]);
  await expect(frame.locator('[data-pit="0"] .count')).toHaveText('0');
  await expect(confirm).toBeDisabled();
  state = game.deserialize(game.serialize(state));
  await page.reload();
  await expect(frame.locator('#last')).toContainText('第 1 手');
  seatId = 'b';
  await publish();
  await expect(frame.locator('#mine .pit').first()).toHaveAttribute('data-pit', '6');
  await expect(frame.locator('#opponent .pit').first()).toHaveAttribute('data-pit', '5');
  await frame.getByRole('button', { name: '玩法说明', exact: true }).click();
  await expect(frame.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.getByRole('button', { name: '玩法说明', exact: true })).toBeFocused();
  const child = page.frames().find((f) => f.url().endsWith('/desktop'))!;
  expect(
    await child.evaluate(() => {
      try {
        return parent.document.cookie;
      } catch {
        return 'blocked';
      }
    }),
  ).toBe('blocked');
  expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const size = await frame.locator('#mine .pit').first().boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Continue through the actual QuickJS rules and show the terminal View in the same iframe.
  for (
    let step = 0;
    step < 5000 && (game.getOutcome(state) as { status: string }).status === 'ongoing';
    step++
  ) {
    const current = state as { seats: string[]; turn: number };
    seatId = current.seats[current.turn]!;
    const nextView = view();
    const action = game.getFallbackAction(
      nextView,
      game.getActionSpec(state, { kind: 'seat', seatId }),
    )!;
    state = game.applyAction(
      state,
      { kind: 'seat', seatId, controllerEpoch: 0 },
      action,
      rng,
    ).state;
  }
  publishedEvents = [];
  await publish();
  await expect(frame.getByRole('status')).toHaveText(/获胜|平局/);
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: info.outputPath('awari-finished.png') });
  expect(errors).toEqual([]);
});
