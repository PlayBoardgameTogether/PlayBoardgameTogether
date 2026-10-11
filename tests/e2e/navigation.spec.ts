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
  await page.locator('.nav-tools summary').click();
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
