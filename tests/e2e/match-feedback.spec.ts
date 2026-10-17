import { test, expect, type Page, type BrowserContext } from './fixtures.js';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
}

async function startMatch(first: BrowserContext, second: BrowserContext) {
  const a = await first.newPage(),
    b = await second.newPage();
  await login(a, 'stage3_a');
  await login(b, 'stage3_b');
  await a.goto('/games/color-match/1.0.0/new');
  await a.getByLabel('房间名', { exact: true }).fill('操作反馈回归桌');
  await a.getByRole('button', { name: '创建并生成邀请码' }).click();
  const code = await a.locator('.invite-box strong').innerText();
  await b.goto('/');
  await b.getByText('邀请码加入', { exact: true }).click();
  await b.getByLabel('12 位邀请码').fill(code);
  await b.getByRole('button', { name: '加入私人房间', exact: true }).click();
  await b.getByRole('button', { name: '坐这里', exact: true }).click();
  await b.getByRole('button', { name: '准备', exact: true }).click();
  await a.getByRole('button', { name: '准备', exact: true }).click();
  await a.getByRole('button', { name: '开始游戏', exact: true }).click();
  for (const page of [a, b]) {
    await expect(page.locator('.color-hand-cards button')).toHaveCount(5);
    await expect(page.getByText('连接中断或正在同步，操作已暂停。')).toHaveCount(0);
  }
  const active = (await a.getByText('轮到你行动', { exact: true }).count()) ? a : b;
  return { active, a, b };
}

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

const actionPath = '**/api/v1/matches/*/actions';
const receiptPath = '**/api/v1/matches/*/commands/*';
const draw = (page: Page) => page.getByRole('button', { name: '摸牌或跳过并结束回合' });
const uncertain = (page: Page) => page.getByRole('button', { name: '确认操作结果', exact: true });
const tableTop = (page: Page) =>
  page
    .getByRole('region', { name: '游戏桌', exact: true })
    .evaluate((table) => table.getBoundingClientRect().top + window.scrollY);

test('a slow successful action stays calm, keeps the table still and never races background recovery', async ({
  browser,
}, info) => {
  const first = await browser.newContext(info.project.use),
    second = await browser.newContext(info.project.use);
  const submit = gate(),
    ack = gate();
  try {
    const { active, a, b } = await startMatch(first, second);
    let posts = 0,
      receipts = 0;
    active.on('request', (request) => {
      if (/\/commands\//.test(request.url())) receipts++;
    });
    await active.route(actionPath, async (route) => {
      posts++;
      await submit.promise;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await ack.promise;
      await route.fulfill({ response });
    });
    if (info.project.name === 'mobile') {
      const publicArea = active.getByRole('region', { name: '公共牌区域', exact: true });
      const card = await publicArea.locator('.color-card').boundingBox();
      const label = await publicArea.getByText('公共牌', { exact: true }).boundingBox();
      expect(card!.x + card!.width).toBeLessThanOrEqual(label!.x);
    }
    const y = await tableTop(active);
    const requested = active.waitForRequest(actionPath);
    await draw(active).click();
    await requested;
    await expect(active.locator('.match-action-feedback')).toHaveText('正在保存操作…');
    await expect(uncertain(active)).toHaveCount(0);
    await expect(draw(active)).toBeDisabled();
    await draw(active).evaluate((button) =>
      button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    const synced = active.waitForResponse('**/api/v1/matches/*/view');
    await active.evaluate(() => window.dispatchEvent(new Event('focus')));
    await synced;
    expect(posts).toBe(1);
    expect(receipts).toBe(0);
    expect(await tableTop(active)).toBe(y);
    await active.screenshot({
      path: info.outputPath('saving-without-warning.png'),
      fullPage: true,
    });
    submit.release();
    for (const page of [a, b])
      await expect(page.getByText('对局 · revision 1', { exact: true })).toBeVisible();
    // The live snapshot can arrive before the original HTTP acknowledgement.
    await expect(uncertain(active)).toHaveCount(0);
    await expect(active.locator('.match-action-feedback')).toHaveText('正在保存操作…');
    expect(receipts).toBe(0);
    ack.release();
    await expect(active.locator('.match-action-feedback')).toHaveText('操作已保存。');
    expect(await tableTop(active)).toBe(y);
    expect(posts).toBe(1);
    await active.screenshot({
      path: info.outputPath('stable-action-feedback.png'),
      fullPage: true,
    });
  } finally {
    submit.release();
    ack.release();
    await first.close();
    await second.close();
  }
});

test('a lost acknowledgement is checked immediately and unresolved recovery survives reload without resubmitting', async ({
  browser,
}, info) => {
  const first = await browser.newContext(info.project.use),
    second = await browser.newContext(info.project.use);
  const receipt = gate();
  try {
    const { active } = await startMatch(first, second);
    const matchId = new URL(active.url()).pathname.split('/').at(-1)!;
    let posts = 0;
    await active.route(actionPath, async (route) => {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    });
    await active.route(receiptPath, async (route) => {
      await receipt.promise;
      await route.abort('failed');
    });
    const checking = active.waitForRequest(receiptPath);
    await draw(active).click();
    await checking;
    await expect(active.locator('.match-action-feedback')).toHaveText('正在核对操作结果…');
    await expect(uncertain(active)).toHaveCount(0);
    receipt.release();
    await expect(uncertain(active)).toBeEnabled();
    // Even an accepted receipt must not discard recovery data if reading the view fails.
    await active.unroute(receiptPath);
    await active.route('**/api/v1/matches/*/view', (route) => route.abort('failed'));
    await uncertain(active).click();
    await expect(uncertain(active)).toBeEnabled();
    expect(
      await active.evaluate(
        (id) => sessionStorage.getItem(`boardgame:pending-match:${id}`),
        matchId,
      ),
    ).toBeTruthy();
    await active.unroute('**/api/v1/matches/*/view');
    await active.reload();
    await expect(active.locator('.match-action-feedback')).toHaveText(
      '操作已保存，已同步最新局面。',
    );
    await expect(uncertain(active)).toHaveCount(0);
    await expect(active.getByText('对局 · revision 1', { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    expect(
      await active.evaluate(
        (id) => sessionStorage.getItem(`boardgame:pending-match:${id}`),
        matchId,
      ),
    ).toBeNull();
  } finally {
    receipt.release();
    await first.close();
    await second.close();
  }
});

test('a request lost before commit retries only the original command after a missing receipt', async ({
  browser,
}, info) => {
  const first = await browser.newContext(info.project.use),
    second = await browser.newContext(info.project.use);
  try {
    const { active } = await startMatch(first, second);
    const commands: string[] = [];
    await active.route(actionPath, async (route) => {
      commands.push(route.request().postData()!);
      if (commands.length === 1) await route.abort('failed');
      else await route.continue();
    });
    await draw(active).click();
    await expect(active.locator('.match-action-feedback')).toHaveText('操作已保存。');
    await expect(active.getByText('对局 · revision 1', { exact: true })).toBeVisible();
    await expect(uncertain(active)).toHaveCount(0);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
  } finally {
    await first.close();
    await second.close();
  }
});

test('receipt recovery waits for a view at least as new as the committed action', async ({
  browser,
}, info) => {
  const first = await browser.newContext(info.project.use),
    second = await browser.newContext(info.project.use);
  const captured = gate(),
    oldView = gate();
  try {
    // Withhold the live update so recovery must obtain the committed revision over HTTP.
    for (const context of [first, second])
      await context.routeWebSocket('**/api/v1/ws/session', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          const value = JSON.parse(String(message));
          if (value.type !== 'match.snapshot' || value.revision === 0) socket.send(message);
        });
      });
    const { active } = await startMatch(first, second);
    let views = 0;
    await active.route('**/api/v1/matches/*/view', async (route) => {
      views++;
      if (views !== 1) return route.continue();
      const response = await route.fetch();
      expect((await response.json()).data.revision).toBe(0);
      captured.release();
      await oldView.promise;
      await route.fulfill({ response });
    });
    await active.evaluate(() => window.dispatchEvent(new Event('focus')));
    await captured.promise;
    await active.route(actionPath, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    });
    const receipt = active.waitForResponse(receiptPath);
    await draw(active).click();
    await receipt;
    await expect(active.locator('.match-action-feedback')).toHaveText('正在核对操作结果…');
    oldView.release();
    await expect(active.locator('.match-action-feedback')).toHaveText(
      '操作已保存，已同步最新局面。',
    );
    await expect(active.getByText('对局 · revision 1', { exact: true })).toBeVisible();
    expect(views).toBe(2);
    await expect(uncertain(active)).toHaveCount(0);
  } finally {
    captured.release();
    oldView.release();
    await first.close();
    await second.close();
  }
});
