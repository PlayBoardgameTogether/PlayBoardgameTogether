import { test, expect, type Page } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

test('administrator installs ZIP and players complete a real iframe game', async ({ page, browser }, info) => {
  test.setTimeout(60000);
  await login(page, 'stage7_admin');
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
  const dialog = page.getByRole('dialog', { name: '上传并审核游戏 ZIP' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '检查游戏包' })).toBeDisabled();
  const example = await page.request.get('/api/v1/game-packages/example.zip');
  expect(example.ok()).toBe(true);
  await page.getByLabel('游戏 ZIP 文件').setInputFiles({ name: 'score-race.zip', mimeType: 'application/zip', buffer: await example.body() });
  await page.screenshot({ path: info.outputPath('game-package-dialog.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '检查游戏包' }).click();
  await expect(dialog.getByText(/^(新游戏|此版本已安装)$/)).toBeVisible();
  await dialog.getByRole('button', { name: /^(审核通过并上架|确认已安装版本)$/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '已安装并上架' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '夺分赛 online.score-race', exact: false }).click();
  await expect(page.getByRole('article', { name: '夺分赛 1.0.0', exact: true })).toContainText('已上架');
  await page.goto('/');
  await page.locator('a.game-card[href="/games/online.score-race/1.0.0"]').click();
  await page.getByRole('link', { name: '创建房间', exact: true }).click();
  await page.getByLabel('房间名', { exact: true }).fill('在线夺分验收');
  await page.getByLabel('人数', { exact: true }).fill('2');
  await page.getByRole('button', { name: '创建并生成邀请码' }).click();
  await expect(page.getByRole('heading', { name: '在线夺分验收', exact: true })).toBeVisible();
  const roomUrl = page.url();
  const inviteCode = (await page.getByRole('button', { name: '复制邀请码' }).innerText()).replaceAll('-', '');
  const otherContext = await browser.newContext({ viewport: page.viewportSize()! });
  const other = await otherContext.newPage();
  try {
    await login(other, 'stage2_b');
    const identity = await other.request.get('/api/v1/auth/me');
    const csrf: string = (await identity.json()).data.csrfToken;
    const joined = await other.request.post('/api/v1/rooms/join', { headers: { origin: new URL(roomUrl).origin, 'x-csrf-token': csrf }, data: { requestId: crypto.randomUUID(), inviteCode } });
    expect(joined.ok()).toBe(true);
    await other.goto(roomUrl);
    await other.getByRole('button', { name: '坐这里', exact: true }).click();
    await expect(page.getByText('2/2 已入座 · 0/2 已准备', { exact: true })).toBeVisible();
    await other.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByText('2/2 已入座 · 1/2 已准备', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(page.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
    await expect(other.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
    const iframe = page.frameLocator('iframe[title="在线游戏桌面"]');
    const rival = other.frameLocator('iframe[title="在线游戏桌面"]');
    await expect(iframe.getByRole('button', { name: '抢分', exact: true })).toBeEnabled();
    // Actual opaque-origin isolation: game code cannot inspect platform cookie or the parent DOM.
    const child = page.frames().find(frame => frame.url().includes('/desktop'))!;
    expect(await child.evaluate(() => {
      try { return parent.document.cookie; } catch { return 'blocked'; }
    })).toBe('blocked');
    await iframe.getByRole('button', { name: '抢分', exact: true }).click();
    await expect(rival.getByRole('button', { name: '抢分', exact: true })).toBeEnabled();
    await page.reload();
    await expect(iframe.locator('#scores')).not.toContainText('正在同步');
    for (let turn = 0; turn < 12; turn++) {
      if ((await iframe.locator('#status').innerText()).includes('获胜')) break;
      const mine = iframe.getByRole('button', { name: '抢分', exact: true });
      const theirs = rival.getByRole('button', { name: '抢分', exact: true });
      if (await mine.isEnabled()) {
        await mine.click();
        await expect(rival.locator('#status')).toHaveText(/轮到你|获胜/);
      } else {
        await expect(theirs).toBeEnabled(); await theirs.click();
        await expect(iframe.locator('#status')).toHaveText(/轮到你|获胜/);
      }
    }
    await expect(iframe.locator('#status')).toContainText('获胜');
    await page.screenshot({ path: info.outputPath('game-package-finished.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const matchId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.goto(`/matches/${matchId}/replay`);
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await expect(iframe.locator('#scores')).not.toContainText('正在同步');
    const replayDesktop = page.frames().find(frame => frame.url().includes('/desktop'))!;
    await replayDesktop.evaluate(() => { document.documentElement.dataset.replayInstance = 'original'; });
    let desktopReads = 0;
    let actions = 0;
    page.on('request', request => {
      if (request.url().endsWith('/desktop')) desktopReads++;
      if (request.method() === 'POST' && request.url().includes(`/matches/${matchId}/actions`)) actions++;
    });
    const initialScores = (await iframe.locator('#scores').textContent())!;
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('1');
    await expect(iframe.locator('#scores')).not.toHaveText(initialScores);
    await expect(iframe.locator('html')).toHaveAttribute('data-replay-instance', 'original');
    await page.getByRole('button', { name: '末尾', exact: true }).click();
    await expect(iframe.locator('#status')).toContainText('获胜');
    await page.getByRole('button', { name: '开头', exact: true }).click();
    await expect(page.getByLabel('回放进度')).toHaveValue('0');
    await expect(iframe.locator('#scores')).toHaveText(initialScores);
    await page.getByLabel('播放速度').selectOption('4');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(iframe.locator('#status')).toContainText('获胜', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await expect(iframe.getByRole('button', { name: '抢分', exact: true })).toBeDisabled();
    await expect(iframe.locator('html')).toHaveAttribute('data-replay-instance', 'original');
    expect(desktopReads).toBe(0);
    expect(actions).toBe(0);
    await page.screenshot({ path: info.outputPath('game-package-replay.png'), fullPage: true });
  } finally { await otherContext.close(); }
});
