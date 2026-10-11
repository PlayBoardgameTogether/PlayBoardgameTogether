import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { DeterministicRng } from '@boardgame/game-sdk';
import { azulExtension as game } from '../../games/azul/src/server/index.js';
import { azulTutorialReferences } from '../unit/azul-tutorial-reference.js';
import type { AzulView } from '../../games/azul/src/shared/index.js';

function settlement(index: number) {
  const scene = azulTutorialReferences()[index]!;
  const viewer = { kind: 'seat' as const, seatId: 'tutorial.you' };
  const result = game.applyAction(scene.state, { ...viewer, controllerEpoch: 0 }, scene.action, new DeterministicRng(42));
  return {
    before: game.getView(scene.state, viewer),
    after: game.getView(result.state, viewer),
    events: game.projectEvents(result.events, viewer).map((event, i) => ({ ...event, eventId: `score-${index}-${i}` })),
  };
}

async function render(page: Page, view: AzulView, events: unknown[] = [], replay = false) {
  await page.evaluate(({ view, events, replay }) => Reflect.get(window, 'renderAzul')(view, events, replay), { view, events, replay });
}

async function mount(page: Page) {
  // Mount the production component through the dev server; only public Views enter the browser.
  await page.evaluate(async boardPath => {
    const load = (url: string) => import(/* @vite-ignore */ url);
    const [{ default: React }, { default: ReactDOM }, { AzulBoard }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'),
      load('/node_modules/.vite/deps/react-dom_client.js'),
      load(boardPath),
    ]);
    document.body.innerHTML = '<div id="azul-test"></div>';
    document.body.style.cssText = 'margin:0;background:#162a35';
    const root = ReactDOM.createRoot(document.getElementById('azul-test'));
    Reflect.set(window, 'renderAzul', (view: unknown, events: unknown[], replay = false) => root.render(
      React.createElement(AzulBoard, { view, events, busy: replay, onAction: () => {},
        replay: replay ? { id: 1, animate: true, hold: (duration: number) => { document.documentElement.dataset.replayDuration = String(duration); } } : undefined }),
    ));
  }, `/@fs/${resolve('games/azul/src/client/index.tsx').replaceAll('\\', '/')}`);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/');
  await mount(page);
});

test('read-only replay preserves developer scoring flights and reserves the entire sequence', async ({ page }, info) => {
  const data = settlement(7);
  await render(page, data.before, [], true);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('10分');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await render(page, data.after, data.events, true);
  await expect(page.locator('.az-flying-tile')).toHaveCount(1);
  const duration = Number(await page.locator('html').getAttribute('data-replay-duration'));
  expect(duration).toBeGreaterThan(1500);
  await page.clock.runFor(1460);
  await expect(page.locator('.az-score-float')).toBeVisible();
  await page.screenshot({ path: info.outputPath('replay-scoring.png'), fullPage: true });
  await page.clock.runFor(duration);
  await expect(page.locator('.az-flying-tile, .az-score-float')).toHaveCount(0);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('53分');
});

test('HTTP finished View cannot flash final scores or wall before delayed live settlement', async ({ page }) => {
  const data = settlement(7);
  await render(page, data.before);
  const score = page.getByLabel('你得分', { exact: true });
  await expect(score).toHaveText('10分');
  await render(page, data.after);
  await expect(score).toHaveText('10分');
  await expect(page.locator('.az-finale')).toHaveCount(0);
  await expect(page.locator('.az-wall-cell').first()).toHaveAccessibleName(/空位$/);
  await render(page, data.after, data.events);
  await expect(score).toHaveText('10分');
  await expect(page.locator('.az-flying-tile')).toHaveCount(1);
  await expect(page.locator('.az-finale')).toHaveCount(0);
  await expect(score).toHaveText('53分', { timeout: 6000 });
  await expect(page.locator('.az-finale')).toBeVisible();
});

test('fast crossing combo grows to +6, then clears without changing layout', async ({ page }, info) => {
  const data = settlement(5);
  await render(page, data.before);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('0分');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await render(page, data.after);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('0分');
  await expect(page.locator('.az-wall-cell').nth(12)).toHaveAccessibleName(/空位$/);
  await render(page, data.after, data.events);
  await expect(page.locator('.az-flying-tile')).toHaveCount(1);
  await page.clock.runFor(160);
  await expect(page.locator('.az-score-float')).toHaveText('+3');
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('3分');
  await page.clock.runFor(180);
  await expect(page.locator('.az-score-float')).toHaveText('+6');
  await expect(page.locator('.az-score-float')).toHaveClass(/az-combo-strong/);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('6分');
  await page.locator('.az-score-float').evaluate(element => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 100;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('cross-combo.png'), fullPage: true });
  await page.clock.runFor(400);
  await expect(page.locator('.az-score-float, .az-flying-tile')).toHaveCount(0);
  await render(page, data.after, [...data.events]);
  await expect(page.locator('.az-score-float, .az-flying-tile')).toHaveCount(0);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('6分');
});

test('lost live event converges, late delivery and refresh do not rewind or replay', async ({ page }) => {
  const data = settlement(7);
  await render(page, data.before);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('10分');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await render(page, data.after);
  await expect(page.locator('.az-finale')).toHaveCount(0);
  await page.clock.runFor(700);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('53分');
  await render(page, data.after, data.events);
  await expect(page.locator('.az-finale')).toBeVisible();
  await expect(page.locator('.az-flying-tile, .az-score-float')).toHaveCount(0);
  await page.reload();
  await mount(page);
  await render(page, data.after);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('53分');
  await expect(page.locator('.az-flying-tile, .az-score-float')).toHaveCount(0);
});

test('initial final snapshot shows authoritative scores without replay', async ({ page }) => {
  const data = settlement(7);
  await render(page, data.after);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('53分');
  await expect(page.locator('.az-finale')).toBeVisible();
  await expect(page.locator('.az-flying-tile, .az-score-float')).toHaveCount(0);
});

test('large bonus counts up in 60ms and reduced motion skips all movement', async ({ page }, info) => {
  const data = settlement(7);
  await render(page, data.before);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('10分');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await render(page, data.after, data.events);
  // Tile: 740ms; row bonus: 560ms; first column impact: 160ms.
  await page.clock.runFor(1460);
  await expect(page.locator('.az-score-float')).toHaveText('+3');
  await page.clock.runFor(60);
  await expect(page.locator('.az-score-float')).toHaveText('+7');
  await page.clock.runFor(180);
  await expect(page.locator('.az-score-float')).toHaveText('+10');
  await page.clock.runFor(60);
  await expect(page.locator('.az-score-float')).toHaveText('+14');
  await expect(page.locator('.az-score-float')).toHaveClass(/az-combo-mega/);
  await page.locator('.az-score-float').evaluate(element => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 100;
  });
  await page.screenshot({ path: info.outputPath('bonus-combo.png'), fullPage: true });
  await page.clock.runFor(3000);
  await expect(page.locator('.az-finale')).toBeVisible();
  // Remount to exercise the exact same settlement with reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.resume();
  await page.reload();
  await mount(page);
  await render(page, data.before);
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('10分');
  await render(page, data.after, data.events);
  await expect(page.locator('.az-flying-tile')).toHaveCount(0);
  await expect(page.locator('.az-score-float')).not.toBeVisible();
  await expect(page.getByLabel('你得分', { exact: true })).toHaveText('53分', { timeout: 1500 });
});
