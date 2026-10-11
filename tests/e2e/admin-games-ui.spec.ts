import { sessionFixture } from '../fixtures/session.js';
import { test, expect } from '@playwright/test';
import type { AdminGame } from '@boardgame/protocol';

test('select a game before managing its versions and preserve selection on refresh', async ({ page }, info) => {
  const games: AdminGame[] = [
    { id: 'online.gomoku', name: '五子棋', version: '1.0.1', enabled: false, available: true, developmentOnly: false, revision: 2 },
    { id: 'online.gomoku', name: '五子棋', version: '1.0.2', enabled: true, available: true, developmentOnly: false, revision: 1 },
    { id: 'color-match', name: 'Color Match', version: '1.0.0', enabled: true, available: true, developmentOnly: false, revision: 1 },
    { id: 'offline.game', name: '待恢复游戏', version: '1.0.0', enabled: false, available: false, developmentOnly: false, revision: 1 },
  ];
  let writes = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (path === '/api/v1/admin/games') data = games;
    else if (route.request().method() === 'PUT' && path.includes('/admin/games/')) {
      expect(path).toContain('online.gomoku');
      expect(path).toContain('1.0.2');
      const command = route.request().postDataJSON();
      expect(command.expectedRevision).toBe(1);
      expect(command.enabled).toBe(false);
      writes++;
      games[1] = { ...games[1], enabled: false, revision: 2 };
      data = games[1];
    } else { await route.abort(); return; }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui' } });
  });
  await page.goto('/admin/catalog');
  const choices = page.getByRole('list', { name: '选择游戏' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下架版本' })).toHaveCount(0);
  await expect(page.getByText('1.0.2', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '下载可玩示例 ZIP' })).not.toBeVisible();
  await page.getByLabel('筛选游戏').fill('gomoku');
  await expect(choices.getByRole('button')).toHaveCount(1);
  const gomoku = choices.getByRole('button', { name: /五子棋/ });
  expect(await gomoku.evaluate(element => getComputedStyle(element).justifyContent)).toBe('space-between');
  await page.screenshot({ path: info.outputPath('game-selection.png'), fullPage: true });
  await gomoku.click();
  await expect(page.getByRole('heading', { name: '五子棋', exact: true })).toBeFocused();
  await expect(choices).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article', { name: 'Color Match 1.0.0' })).toHaveCount(0);
  const current = page.getByRole('article', { name: '五子棋 1.0.2', exact: true });
  page.on('dialog', dialog => dialog.accept());
  await current.getByRole('button', { name: '下架版本' }).click();
  await expect(current).toContainText('已下架');
  expect(writes).toBe(1);
  await expect(page.getByRole('article', { name: '五子棋 1.0.1' })).toContainText('已下架');
  await page.getByRole('button', { name: '刷新游戏', exact: true }).click();
  await expect(current).toContainText('已下架');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('game-versions.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '← 返回游戏列表' }).click();
  await expect(gomoku).toBeFocused();
  await expect(page.getByLabel('筛选游戏')).toHaveValue('gomoku');
  await page.getByLabel('筛选游戏').fill('无此游戏');
  await expect(page.getByText('没有匹配的游戏，请尝试其他名称或游戏 ID。')).toBeVisible();
  await page.getByLabel('筛选游戏').fill('');
  await choices.getByRole('button', { name: /待恢复游戏/ }).click();
  await expect(page.getByRole('button', { name: '上架版本' })).toBeDisabled();
  await expect(page.getByText('规则或资源不可用，需检查部署')).toBeVisible();
});
