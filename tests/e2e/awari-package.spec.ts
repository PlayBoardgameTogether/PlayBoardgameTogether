import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';
test('Awari uploads, restores and completes a real human/script-AI match', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage7_admin');
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
  const bytes = await readFile('dist/game-packages/awari-1.0.0.zip');
  await page
    .getByLabel('游戏 ZIP 文件')
    .setInputFiles({ name: 'awari-1.0.0.zip', mimeType: 'application/zip', buffer: bytes });
  await page.getByRole('button', { name: '检查游戏包', exact: true }).click();
  await page
    .getByRole('button', { name: /^(审核通过并上架|确认已安装版本)$/, exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: '已安装并上架' })).toBeVisible();
  await page.goto('/');
  const card = page.locator('a.game-card[href="/games/online.awari/1.0.0"]');
  await expect(card).toBeVisible();
  await expect
    .poll(() =>
      card
        .locator('.game-cover img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 100),
    )
    .toBe(true);
  if (info.project.name === 'mobile') {
    // The platform deliberately hides card icons on phones; lazy images need not decode there.
    await expect(card.locator('.game-card-icon')).toBeHidden();
    const icon = await page.request.get(
      '/api/v1/game-packages/online.awari/versions/1.0.0/art/icon.png',
    );
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/png');
    expect((await icon.body()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  } else {
    await expect
      .poll(() =>
        card
          .locator('.game-card-icon img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 100),
      )
      .toBe(true);
  }
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('awari-lobby-cover.png'), fullPage: true });
  await card.click();
  await expect(page.getByRole('heading', { name: '阿瓦里', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '创建房间', exact: true }).click();
  await page.getByLabel('房间名', { exact: true }).fill('阿瓦里 AI ' + info.project.name);
  await page.getByLabel('人数', { exact: true }).fill('2');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]+$/);

  await page.getByRole('button', { name: '添加脚本 AI', exact: true }).click();
  await expect(page.getByText('脚本 AI · 已就绪', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
  const matchId = new URL(page.url()).pathname.split('/').at(-1)!;
  const snapshot = async () => {
    const response = await page.request.get(`/api/v1/matches/${matchId}/view`);
    expect(response.ok()).toBe(true);
    return (await response.json()).data;
  };
  const frame = page.frameLocator('iframe[title="在线游戏桌面"]');
  await expect(frame.locator('.pit')).toHaveCount(12);
  await page.screenshot({ path: info.outputPath('awari-ai-table.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
  let finished = false;
  for (let move = 0; move < 400; move++) {
    await expect
      .poll(
        async () => {
          const data = await snapshot();
          return data.status === 'finished' || data.view.actions.length > 0;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const data = await snapshot();
    if (data.status === 'finished') {
      finished = true;
      break;
    }
    const action = data.view.actions[0];
    expect(data.view).not.toHaveProperty('history');
    const reply = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/matches/${matchId}/actions`) &&
        response.request().method() === 'POST',
    );
    await frame.locator(`[data-pit="${action.pit}"]`).click();
    await expect(frame.locator('#preview')).toContainText('末子落在');
    await frame.getByRole('button', { name: '确认播种', exact: true }).click();
    expect((await reply).status()).toBe(200);
    await expect.poll(async () => (await snapshot()).revision).toBeGreaterThan(data.revision);
  }
  expect(finished).toBe(true);
  await expect(frame.locator('#status')).toHaveText(/获胜|平局/);
  await page.screenshot({ path: info.outputPath('awari-ai-finished.png'), fullPage: true });
  await page.getByRole('button', { name: '返回房间', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('awari-ai-returned-room.png'), fullPage: true });
});
