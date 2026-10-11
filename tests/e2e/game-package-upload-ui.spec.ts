import { sessionFixture } from '../fixtures/session.js';
import { test, expect } from '@playwright/test';

test('review classifies new and updated games before publishing', async ({ page }, info) => {
  let kind: 'new' | 'update' = 'new';
  let publications = 0;
  let stale = false;
  const result = { gameId: 'online.score-race', version: '1.1.0', name: '积分竞赛', hash: 'a'.repeat(64) };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === '/api/v1/auth/me') data = sessionFixture({ role: 'administrator' });
    else if (url.pathname === '/api/v1/admin/games') data = [];
    else if (url.pathname === '/api/v1/admin/game-packages/review') {
      data = { ...result, kind, installedVersions: kind === 'new' ? [] : ['1.0.0'], catalogHash: 'b'.repeat(64) };
    } else if (url.pathname === '/api/v1/admin/game-packages') {
      expect(url.searchParams.get('expectedCatalogHash')).toBe('b'.repeat(64));
      expect(url.searchParams.get('requestId')).toMatch(/^[a-f0-9-]{36}$/);
      publications++;
      if (stale) {
        stale = false;
        await route.fulfill({ status: 409, json: { ok: false, error: { code: 'STATE_CONFLICT', message: '请重新检查并审核游戏包', retryable: false }, traceId: 'ui' } });
        return;
      }
      data = result;
    } else { await route.abort(); return; }
    await route.fulfill({ json: { ok: true, data, traceId: 'ui' } });
  });
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
  const dialog = page.getByRole('dialog');
  const select = () => dialog.getByLabel('游戏 ZIP 文件').setInputFiles({ name: 'game.zip', mimeType: 'application/zip', buffer: Buffer.from('mock archive') });
  await select();
  await dialog.getByRole('button', { name: '检查游戏包' }).click();
  await expect(dialog.getByText('新游戏', { exact: true })).toBeVisible();
  expect(publications).toBe(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(publications).toBe(0);
  kind = 'update';
  await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
  await select();
  await dialog.getByRole('button', { name: '检查游戏包' }).click();
  await expect(dialog.getByText('已有游戏更新', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('进行中的对局和历史记录保留原规则');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('package-review.png'), fullPage: true });
  stale = true;
  await dialog.getByRole('button', { name: '审核通过并更新' }).click();
  await expect(dialog.getByRole('alert')).toContainText('重新检查');
  await expect(dialog.getByRole('button', { name: '检查游戏包' })).toBeEnabled();
  await dialog.getByRole('button', { name: '检查游戏包' }).click();
  await dialog.getByRole('button', { name: '审核通过并更新' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('已安装并上架');
  expect(publications).toBe(2);
});
