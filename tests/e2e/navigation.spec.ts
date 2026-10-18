import { test, expect } from './fixtures.js';


test('rapid page changes settle on the latest route', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: '界面固定场景' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('nav a[href="/profile"]')!.click();
    document.querySelector<HTMLAnchorElement>('nav a[href="/developers"]')!.click();
  });
  await expect(page).toHaveURL('/developers');
  await expect(page.locator('.workspace-toolbar strong')).toHaveText('开发者文档');
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('game navigation preserves a real match and clears the mobile action area', async ({ page, isMobile }, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goto('/games/color-match/1.0.0/new');
  await page.getByLabel('房间名').fill('手机导航回归桌');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await page.getByRole('button', { name: '添加脚本 AI', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('.color-hand-cards button')).toHaveCount(5);
  const matchUrl = page.url();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  const draw = page.getByRole('button', { name: '摸牌或跳过并结束回合', exact: true });
  await expect(draw).toBeEnabled();
  if (isMobile) await expect(nav).toBeHidden();
  else await expect(nav).toBeVisible();
  await draw.scrollIntoViewIfNeeded();
  await expect(draw).toBeInViewport();
  await page.screenshot({ path: info.outputPath('real-match-actions.png') });
  const response = page.waitForResponse(result => result.url().endsWith('/actions') && result.request().method() === 'POST');
  await draw.click();
  expect((await response).status()).toBe(200);
  if (isMobile) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: '导航', exact: true }).click();
  }
  await nav.getByRole('link', { name: '好友', exact: true }).click();
  await expect(page).toHaveURL('/friends');
  await page.goBack();
  await expect(page).toHaveURL(matchUrl);
  await expect(page.locator('.color-hand-cards button').first()).toBeVisible();
  if (isMobile) await expect(nav).toBeHidden();
  const revision = await page.evaluate(async () => {
    const response = await fetch(`/api/v1${location.pathname}/view`);
    return (await response.json()).data.revision;
  });
  expect(revision).toBeGreaterThan(0);
});

test('page links preserve the shell, history and keyboard access without a reload', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: '界面固定场景' })).toBeVisible();
  await page.evaluate(() => { document.body.dataset.navigationMarker = 'same-document'; });
  const documents: string[] = [];
  page.on('request', request => { if (request.isNavigationRequest()) documents.push(request.url()); });
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '开发者文档', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/developers');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('.nav-tools')).not.toHaveAttribute('open');
  await expect(page.locator('.workspace-toolbar strong')).toHaveText('开发者文档');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '界面固定场景' })).toBeVisible();
  await page.goForward();
  await expect(page.locator('.workspace-toolbar strong')).toHaveText('开发者文档');
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '界面场景', exact: true }).click();
  await page.getByRole('combobox', { name: '场景', exact: true }).selectOption('room-four');
  const seats = page.locator('.seat-card');
  expect(await seats.evaluateAll(elements => elements.map(element => getComputedStyle(element).animationDelay)))
    .toEqual(['0.04s', '0.08s', '0.12s', '0.16s']);
  await page.screenshot({ path: info.outputPath('seats.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(seats.first()).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined }));
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '开发者文档', exact: true }).click();
  await expect(page.locator('#main-content')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.nav-tools summary').click();
  await page.getByRole('link', { name: '界面场景', exact: true }).click();
  await expect(page.getByRole('heading', { name: '界面固定场景' })).toBeVisible();
  await page.getByRole('link', { name: '跳到主要内容' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  expect(await page.evaluate(() => document.body.dataset.navigationMarker)).toBe('same-document');
  expect(documents).toEqual([]);
});
