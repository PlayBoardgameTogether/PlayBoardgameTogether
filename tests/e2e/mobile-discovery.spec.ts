import { test, expect } from '@playwright/test';
import type { GamePresentation } from '../../packages/protocol/src/index.js';

const games = [
  { id: 'azul.base', name: '花砖物语', description: '花砖拼图', players: { min: 2, max: 4 } },
  { id: 'color-match', name: 'Color Match', description: '颜色卡牌', players: { min: 2, max: 4 } },
  { id: 'grid-garden', name: 'Grid Garden', description: '规划花园', players: { min: 2, max: 4 } },
  { id: 'splendor.base', name: '璀璨宝石', description: '收集宝石', players: { min: 2, max: 4 } },
  { id: 'duel', name: '双人棋', description: '双人对弈', players: { min: 2, max: 2 } },
  { id: 'party', name: '聚会桌游', description: '多人合作', players: { min: 3, max: 4 } },
].map(game => ({ ...game, version: '1.0.0', developmentOnly: false }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/games')) return route.fulfill({ json: { ok: true, traceId: 'discovery', data: games } });
    if (path.endsWith('/games/presentations')) return route.fulfill({ json: { ok: true, traceId: 'discovery', data: [] } });
    return route.fulfill({ status: 401, json: { ok: false, traceId: 'discovery', error: {
      code: 'UNAUTHENTICATED', message: '请登录', retryable: false,
    } } });
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(6);
});

test('search and player filters compose, recover from an empty result and retain game links', async ({ page }) => {
  await page.getByRole('button', { name: '双人对战', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(5);
  await page.getByRole('button', { name: '多人聚会', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(5);
  await page.getByRole('searchbox', { name: '搜索游戏' }).fill('  COLOR  ');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.game-card')).toHaveAttribute('href', '/games/color-match/1.0.0');
  await page.getByRole('searchbox').fill('不存在的桌游');
  await expect(page.getByText('还没找到合适的游戏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.getByRole('button', { name: '全部游戏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('.game-card')).toHaveCount(6);
});

test('game avatars use complete square portraits across themes and viewports', async ({ page, isMobile }, info) => {
  const widths = isMobile ? [320, 390] : [1280, 1440];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: isMobile ? 844 : 900 });
      for (const name of ['花砖物语', 'Color Match', 'Grid Garden', '璀璨宝石']) {
        const card = page.getByRole('link', { name: `查看 ${name}`, exact: true });
        await card.scrollIntoViewIfNeeded();
        const avatar = card.locator('.game-avatar img');
        await expect(avatar).toBeVisible();
        await expect.poll(() => avatar.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(512);
        const box = await avatar.boundingBox();
        expect(box!.width / box!.height).toBeCloseTo(1, 1);
        await expect(avatar).toHaveCSS('object-fit', 'contain');
        expect(await avatar.evaluate(node => {
          const image = node as HTMLImageElement;
          return image.naturalWidth / image.naturalHeight;
        })).toBe(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`pixel-games-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('catalog avatars, legacy covers and detail backgrounds keep their separate image roles', async ({ page }, info) => {
  await page.route('**/api/v1/games/presentations', route => route.fulfill({ json: {
    ok: true, traceId: 'avatar-roles', data: [
      { gameId: 'party', version: '1.0.0', revision: 1, iconUrl: '/game-art/counter-icon.svg', coverUrl: '/game-art/color-match.svg', backgroundUrl: '/game-art/grid-garden.svg' },
      { gameId: 'duel', version: '1.0.0', revision: 1, iconUrl: null, coverUrl: '/game-art/counter.svg', backgroundUrl: '/game-art/color-match.svg' },
    ],
  } }));
  await page.goto('/');
  const avatar = page.getByRole('link', { name: '查看 聚会桌游', exact: true });
  await expect(avatar.locator('.game-avatar img')).toHaveAttribute('src', '/game-art/counter-icon.svg');
  const legacyCover = page.getByRole('link', { name: '查看 双人棋', exact: true }).locator('.game-avatar img');
  await expect(legacyCover).toHaveAttribute('src', '/game-art/counter.svg');
  await expect(legacyCover).toHaveCSS('object-fit', 'cover');
  await avatar.click();
  await expect(page.locator('.game-detail-icon img')).toHaveAttribute('src', '/game-art/counter-icon.svg');
  await expect(page.locator('.game-banner-background img')).toHaveAttribute('src', '/game-art/grid-garden.svg');
  await expect(page.locator('.game-detail-icon img')).toHaveCSS('object-fit', 'contain');
  await page.screenshot({ path: info.outputPath('separate-avatar-and-background.png'), fullPage: true });
});

test('the gallery upgrades old official package artwork and preserves newer and custom artwork', async ({ page, isMobile }, info) => {
  const icons = '/game-art/catalog-20261107';
  const packageBase = '/api/v1/game-packages';
  const onlineGames = [
    ['online.awari', '1.0.0', '阿瓦里', 'awari'],
    ['online.catan', '1.0.1', '卡坦岛', 'catan'],
    ['online.gomoku', '1.0.3', '五子棋', 'gomoku'],
    ['online.rummikub', '1.0.3', '拉密', 'rummikub'],
    ['online.uno', '1.2.0', 'UNO · 休闲版', 'uno'],
    ['online.uno-no-mercy', '1.0.0', 'UNO · 毫不留情', 'uno-no-mercy'],
  ] as const;
  const newerIcon = `${packageBase}/online.uno/versions/1.2.1/art/icon.png`;
  const customIcon = '/game-art/counter-icon.svg';
  const customScene = '/game-art/counter.svg';
  const catalog = [
    ...games.slice(0, 4),
    ...onlineGames.map(([id, version, name]) => ({
      id, version, name, description: '和桌友一起玩。', players: { min: 2, max: 4 }, developmentOnly: false,
    })),
    { ...games[4]!, id: 'online.uno', version: '1.2.1', name: 'UNO · 新版' },
  ];
  const presentations: GamePresentation[] = onlineGames.map(([gameId, version]) => {
    const base = `${packageBase}/${gameId}/versions/${version}/art`;
    return { gameId, version, revision: 0, iconUrl: `${base}/icon.png`, coverUrl: null, backgroundUrl: `${base}/background.png` };
  });
  presentations.push({ gameId: 'online.uno', version: '1.2.1', revision: 0, iconUrl: newerIcon, coverUrl: null, backgroundUrl: null });
  await page.route('**/api/v1/games', route => route.fulfill({ json: { ok: true, traceId: 'gallery', data: catalog } }));
  await page.route('**/api/v1/games/presentations', route => route.fulfill({ json: { ok: true, traceId: 'gallery', data: presentations } }));
  await page.route(`**${newerIcon}`, route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#174"/></svg>',
  }));
  await page.goto('/');
  for (const [, , name, key] of onlineGames) {
    const avatar = page.getByRole('link', { name: `查看 ${name}`, exact: true }).locator('.game-avatar img');
    await avatar.scrollIntoViewIfNeeded();
    await expect(avatar).toHaveAttribute('src', `${icons}/${key}-avatar.webp`);
    await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([512, 512]);
  }
  const newerCard = page.getByRole('link', { name: '查看 UNO · 新版', exact: true });
  await expect(newerCard.locator('.game-avatar img')).toHaveAttribute('src', newerIcon);
  await page.locator('.game-catalog-grid').screenshot({ path: info.outputPath('gallery-lobby.png') });
  await page.getByRole('link', { name: '查看 UNO · 休闲版', exact: true }).click();
  const scene = page.locator('.game-banner-background img');
  const copy = page.locator('.game-banner-content');
  await expect(scene).toHaveAttribute('src', `${icons}/uno-scene.webp`);
  await expect.poll(() => scene.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(960);
  const sceneBox = (await scene.boundingBox())!;
  const copyBox = (await copy.boundingBox())!;
  if (isMobile) {
    expect(sceneBox.y + sceneBox.height).toBeLessThanOrEqual(copyBox.y + 1);
  } else {
    expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(sceneBox.x + 1);
  }
  await page.locator('.game-detail-banner').screenshot({ path: info.outputPath('gallery-uno.png') });
  const uno = presentations.find(item => item.gameId === 'online.uno' && item.version === '1.2.0')!;
  Object.assign(uno, { revision: 1, iconUrl: customIcon, backgroundUrl: customScene });
  await page.reload();
  await expect(page.locator('.game-detail-icon img')).toHaveAttribute('src', customIcon);
  await expect(scene).toHaveAttribute('src', customScene);
  await page.route(`**${customScene}`, route => route.abort());
  await page.reload();
  await expect(page.locator('.game-banner-background')).toBeHidden();
  await expect(page.getByRole('link', { name: '创建房间' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile navigation stays reachable and content clears the bar at narrow widths', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Mobile navigation and grid');
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    const first = await page.locator('.game-card').nth(0).boundingBox();
    const second = await page.locator('.game-card').nth(1).boundingBox();
    expect(first!.y).toBe(second!.y);
    expect(second!.x).toBeGreaterThan(first!.x);
    await expect(nav).toBeInViewport();
    const bar = await nav.boundingBox();
    expect(bar!.y + bar!.height).toBe(844);
    for (const control of await nav.locator(':scope > a, summary').all()) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expect(nav).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`mobile-lobby-${width}.png`), fullPage: true });
  }
  await page.locator('.nav-tools summary').click();
  const menu = page.locator('.nav-tools > div');
  await expect(menu).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-tools')).not.toHaveAttribute('open');
  await expect(page.locator('.nav-tools summary')).toBeFocused();
  await page.getByRole('link', { name: '公共聊天', exact: true }).click();
  await expect(page).toHaveURL('/chat');
  await expect(page.getByRole('link', { name: '公共聊天', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main')).toBeFocused();
});

test('light mobile game chrome retains readable text around the immersive table', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'Mobile game shell');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('boardgame.theme', 'light'));
  await page.goto('/games/azul.base/1.0.0/tutorial');
  await expect(page.locator('.az-table')).toBeVisible();
  const contrast = await page.locator('.brand-name').evaluate(element => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const text = luminance(getComputedStyle(element).color);
    const surface = luminance(getComputedStyle(element.closest('header')!).backgroundColor);
    return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-light-tutorial.png'), fullPage: true });
  await page.goto('/games/splendor.base/1.0.0/tutorial');
  const bank = page.getByRole('region', { name: '公共宝石库存' });
  await bank.getByRole('button', { name: /^祖母绿库存/ }).click();
  const decision = page.getByRole('region', { name: '确认本回合操作' });
  await expect(decision).toBeVisible();
  const decisionBox = await decision.boundingBox();
  const navBox = await page.getByRole('navigation', { name: '主导航', exact: true }).boundingBox();
  expect(decisionBox!.y + decisionBox!.height).toBeLessThanOrEqual(navBox!.y);
  await page.screenshot({ path: info.outputPath('mobile-decision-above-navigation.png') });
});

test('pixel lobby retains filters across themes and leaves tutorial presentation independent', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('searchbox', { name: '搜索游戏' }).fill('Color');
  const widths = info.project.name === 'desktop' ? [1440, 1280, 390, 320] : [390];
  for (const theme of ['light', 'dark']) {
    await page.locator('.nav-tools summary').click();
    await page.getByLabel('外观', { exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox')).toHaveValue('Color');
    await expect(page.locator('.game-card')).toHaveCount(1);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.pixel-club-art')).toBeVisible();
      expect(await page.locator('.pixel-club-art').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
      await page.getByRole('link', { name: '先试一手', exact: true }).focus();
      await expect(page.getByRole('link', { name: '先试一手', exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`pixel-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  // Compare a tutorial reached from the lobby with a fresh direct visit. Lobby
  // palette and control overrides must not survive in the game presentation.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: '先试一手', exact: true }).click();
  await expect(page).toHaveURL('/games/color-match/1.0.0/tutorial');
  await expect(page.getByRole('region', { name: '教程指引' })).toBeVisible();
  const presentation = () => page.locator('.site-header').evaluate(element => {
    const header = getComputedStyle(element);
    const button = getComputedStyle(document.querySelector('main button')!);
    return { surface: header.backgroundColor, layout: header.flexDirection, button: button.backgroundColor, radius: button.borderRadius };
  });
  const fromLobby = await presentation();
  await expect(page.locator('.pixel-wordmark')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: '教程指引' })).toBeVisible();
  expect(await presentation()).toEqual(fromLobby);
  await page.getByRole('link', { name: '游戏大厅', exact: true }).click();
  await expect(page.locator('.pixel-wordmark')).toBeVisible();
});
