import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { test, expect } from './fixtures.js';

test('player expands a complete match bill, retries details and pages older actions on both layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('用户名').fill('stage3_a');
  await page.getByLabel('密码').fill('stage two password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const headers = { origin: 'http://127.0.0.1:5273', 'x-csrf-token': me.csrfToken };
  const response = await page.request.post('/api/v1/rooms', {
    headers,
    data: {
      requestId: randomUUID(),
      name: '单局账单测试桌',
      gameId: 'color-match',
      version: '1.0.0',
      options: {},
      seatCount: 2,
    },
  });
  expect(response.ok()).toBe(true);
  const { roomId } = (await response.json()).data;
  async function command(method: 'post' | 'put', path: string, input = {}) {
    const room = (await (await page.request.get(`/api/v1/rooms/${roomId}`)).json()).data;
    const result = await page.request[method](`/api/v1/rooms/${roomId}/${path}`, {
      headers,
      data: {
        requestId: randomUUID(),
        expectedRoomRevision: room.roomRevision,
        ...input,
      },
    });
    expect(result.ok()).toBe(true);
    return (await result.json()).data;
  }
  const room = (await response.json()).data.room;
  await command('put', `seats/${room.seats[1].seatId}/bot`, { policyId: 'basic-v1' });
  await command('put', 'my-ready', { ready: true });
  const { matchId } = await command('post', 'start');
  // Durable billing fixtures; real model settlement and payer isolation are integration-tested.
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    await db.query(`INSERT INTO ai_point_wallets(account_id,balance) VALUES($1,26)`, [
      me.account.id,
    ]);
    await db.query(
      `INSERT INTO ai_point_ledger(id,account_id,delta,balance_after,kind,note,created_at)
      VALUES($1,$2,100,100,'grant','体验点数','2026-10-24T00:00:00Z')`,
      [randomUUID(), me.account.id],
    );
    let balance = 100;
    for (let index = 0; index < 25; index++) {
      const points = index === 0 ? 2 : 3;
      balance -= points;
      await db.query(
        `INSERT INTO ai_point_ledger
        (id,account_id,delta,balance_after,kind,note,match_id,token_billing,created_at)
        VALUES($1,$2,$3,$4,'action','官方 AI 成功行动',$5,$6,$7)`,
        [
          randomUUID(),
          me.account.id,
          -points,
          balance,
          matchId,
          index === 0
            ? null
            : {
                offerId: randomUUID(),
                pricing: {
                  inputPointsPerMillion: 1000,
                  outputPointsPerMillion: 2000,
                  markupPercent: 25,
                },
                inputTokens: 1000,
                outputTokens: 500,
                chargedPoints: points,
              },
          new Date(Date.UTC(2026, 9, 25, 0, 0, index)),
        ],
      );
    }
  } finally {
    await db.end();
  }

  await page.goto('/official-ai');
  await expect(page.locator('.ai-wallet strong')).toHaveText('26');
  await expect(page.locator('.ai-match-bill')).toHaveCount(1);
  await expect(page.locator('.ai-point-grant')).toContainText('+100 点');
  const toggle = page.locator('.ai-bill-toggle');
  await expect(toggle).toContainText('Color Match');
  await expect(toggle).toContainText('25 次计费行动');
  await expect(toggle).toContainText('-74 点');
  await expect(page.getByRole('region', { name: 'Color Match' })).toHaveCount(0);
  let failDetails = true;
  await page.route('**/api/v1/me/ai-points/ledger?**', async (route) => {
    if (failDetails) {
      await route.abort('failed');
    } else await route.continue();
  });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('region', { name: 'Color Match' });
  await expect(details.locator('.ai-bill-tokens')).toHaveText('输入 24,000 / 输出 12,000 token');
  await expect(details).toContainText('1 次行动的 token 记录不完整');
  await expect(details.getByRole('button', { name: '重试明细' })).toBeVisible();
  failDetails = false;
  await details.getByRole('button', { name: '重试明细' }).click();
  await expect(details.locator('.ai-charge-list > li')).toHaveCount(20);
  await expect(details).toContainText('输入 1,000 / 输出 500 token');
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await toggle.evaluate((element) => {
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 100);
    });
    await page.screenshot({
      path: test.info().outputPath(`match-bill-${width}.png`),
      fullPage: false,
    });
  }
  await details.getByRole('button', { name: '更早行动明细' }).click();
  await expect(details.locator('.ai-charge-list > li')).toHaveCount(25);
  await expect(details).toContainText('输入 未记录 / 输出 未记录 token');
  await expect(details.getByRole('button', { name: '更早行动明细' })).toHaveCount(0);
  await expect(details.getByRole('link', { name: '查看对局（需参与权限）' })).toHaveAttribute(
    'href',
    `/matches/${matchId}`,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await toggle.evaluate((element) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 100);
  });
  await page.screenshot({ path: test.info().outputPath('match-bill-dark.png'), fullPage: false });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toHaveCount(0);
  await page.getByRole('button', { name: '刷新余额与账单' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ai-match-bill')).toHaveCount(1);
});
