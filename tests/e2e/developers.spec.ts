import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('guest can browse production developer docs and download exact SDK without the API', async ({
  page,
  request,
}, testInfo) => {
  await page.route('**/api/**', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: '开发者中心', exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    await page.locator('.nav-tools summary').click();
    await expect(page.locator('.nav-mobile-doc')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.nav-mobile-doc')).toBeVisible();
    await page.locator('.nav-tools summary').click();
  } else {
    await expect(
      page.getByRole('navigation', { name: '辅助导航' }).getByRole('link', { name: '开发者文档' }),
    ).toHaveAttribute('aria-current', 'page');
  }
  const nav = page.getByRole('navigation', { name: '开发文档', exact: true });
  for (const [label, heading, path] of [
    ['快速开始', '快速开始', 'quickstart'],
    ['游戏 SDK', '游戏 SDK', 'game-sdk'],
    ['客户端 SDK', '客户端 SDK', 'client-sdk'],
    ['HTTP API', 'HTTP API', 'api'],
    ['WebSocket 与恢复', 'WebSocket 与恢复', 'realtime'],
    ['添加游戏', '添加游戏扩展', 'add-game'],
    ['AI 开发指南', 'AI 开发指南', 'ai'],
  ]) {
    await nav.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/developers/${path}$`));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AI 开发指南', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '添加游戏扩展', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '查找指南' }).fill('不存在的指南');
  await expect(page.getByRole('status')).toContainText('没有匹配指南');
  await page.getByRole('searchbox', { name: '查找指南' }).fill('SDK');
  await expect(nav.getByRole('link', { name: '游戏 SDK' })).toBeVisible();
  await page.getByRole('searchbox', { name: '查找指南' }).fill('');
  await nav.getByRole('link', { name: 'HTTP API' }).click();
  await expect(page.getByRole('heading', { name: 'HTTP API', exact: true })).toBeVisible();
  await page.locator('.developer-toc summary').click();
  await page
    .getByRole('navigation', { name: '本页目录' })
    .getByRole('link', { name: '认证与响应' })
    .click();
  await expect(page.getByRole('heading', { name: '认证与响应', exact: true })).toBeInViewport();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载本页 Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('api.md');
  const sdk = await request.get('/developer-sdk/sdk-sources.json');
  expect(sdk.ok()).toBe(true);
  const snapshot = (await sdk.json()) as {
    files: Record<string, { content: string; sha256: string }>;
  };
  for (const [path, file] of Object.entries(snapshot.files)) {
    expect(path).toMatch(/^packages\/(game-sdk|client-sdk|protocol)\//);
    expect(file.content).toBe(await readFile(path, 'utf8'));
    expect(file.sha256).toBe(createHash('sha256').update(file.content).digest('hex'));
    const response = await request.get(`/developer-sdk/${path}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe(file.content);
  }
  expect(await (await request.get('/llms.txt')).text()).toContain('/developer-docs/api.md');
  expect(await (await request.get('/llms-full.txt')).text()).toContain('# HTTP API');
  await page.goto('/developers/api');
  await page.getByRole('heading', { name: 'HTTP API', exact: true }).waitFor();
  await page.screenshot({ path: testInfo.outputPath('developers-api.png') });
  await page.goto('/developers/not-a-guide');
  await expect(page.getByRole('heading', { name: '未找到开发文档' })).toBeVisible();
  expect(errors).toEqual([]);
});
