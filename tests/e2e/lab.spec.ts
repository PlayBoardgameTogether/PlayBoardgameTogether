import { test,expect } from './fixtures.js';
test('catalog and status pages use live API, database, and WebSocket data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Color Match', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '选择游戏' }).getByRole('link', { name: '查看 Color Match', exact: true })).toHaveAttribute('href', '/games/color-match/1.0.0');
  await page.goto('/status');
  await page.getByRole('button', { name: '立即检查' }).click();
  await expect(page.getByText('就绪', { exact: true })).toBeVisible();
  await expect(page.getByText('可用', { exact: true })).toHaveCount(2);
});

test('development lab completes a server-backed game',async({page},testInfo)=>{
  await page.goto('/dev/lab');
  await page.getByRole('button',{name:'创建对局'}).click();
  await expect(page.getByText('revision 0')).toBeVisible();
  await page.getByRole('button',{name:'加 2'}).click();
  await expect(page.getByRole('button',{name:'seat-b'})).toBeEnabled();
  await page.getByRole('button',{name:'seat-b'}).click();
  await expect(page.getByRole('button',{name:'加 1'})).toBeEnabled();
  await page.getByRole('button',{name:'加 1'}).click();
  await expect(page.getByRole('button',{name:'seat-a'})).toBeEnabled();
  await page.getByRole('button',{name:'seat-a'}).click();
  await expect(page.getByRole('button',{name:'加 1'})).toBeEnabled();
  await page.getByRole('button',{name:'加 1'}).click();
  await expect(page.getByText('当前行动：已结束')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/stage-1/lab-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('button', { name: '重开' }).click();
  await expect(page.getByText('revision 0')).toBeVisible();
});
