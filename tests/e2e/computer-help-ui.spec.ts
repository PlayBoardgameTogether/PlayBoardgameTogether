import { test, expect, type Page } from '@playwright/test';
import type { OfficialAiOffer } from '@boardgame/protocol';
import { sessionFixture } from '../fixtures/session.js';

const fixed: OfficialAiOffer = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '经典陪玩',
  pointsPerAction: 5,
  enabled: true,
  revision: 1,
};
const token: OfficialAiOffer = {
  ...fixed,
  id: '10000000-0000-4000-8000-000000000002',
  name: '灵活陪玩',
  pointsPerAction: 20,
  tokenPricing: { inputPointsPerMillion: 1000, outputPointsPerMillion: 2000, markupPercent: 25 },
};

async function fixture(page: Page, offers = [fixed, token], available = 3, fail = false) {
  const writes: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const ok = (data: unknown) =>
      route.fulfill({ json: { ok: true, traceId: 'computer-help', data } });
    if (route.request().method() !== 'GET') {
      writes.push(path);
      return route.abort();
    }
    if (path === '/auth/me') return ok(sessionFixture());
    if (path === '/games')
      return ok([
        {
          id: 'color-match',
          version: '1.0.0',
          name: 'Color Match',
          description: '配对卡牌',
          players: { min: 2, max: 4 },
          developmentOnly: false,
          supportsScriptAi: true,
        },
      ]);
    if (path === '/games/presentations') return ok([]);
    if (path === '/official-ai/offers') {
      if (fail) return route.abort();
      return ok(offers);
    }
    if (path === '/me/official-ai/profiles') return ok([]);
    if (path === '/me/ai-points') return ok({ balance: available + 7, reserved: 7, available });
    return ok([]);
  });
  await page.goto('/games/color-match/1.0.0/computer');
  return writes;
}

test('explains per-seat ceilings, shared balance, fixed and token prices before any write', async ({
  page,
}, info) => {
  const writes = await fixture(page);
  const summary = page.getByRole('region', { name: '本局陪玩与预算' });
  await expect(page.getByLabel('陪玩 AI')).toHaveValue(fixed.id);
  await expect(page.getByText('5 点 / 成功行动（原固定点价）')).toBeVisible();
  await expect(page.getByText(/可用 3 点（已预留 7 点）/)).toBeVisible();
  await expect(summary).toContainText('当前可用点数不足 5 点，将先用免费脚本陪玩');
  await page.getByLabel('每席位单局 AI 点数上限').fill('40');
  await page.getByLabel('总人数（含你）').selectOption('4');
  await expect(summary).toContainText('每席位上限 40 点，3 位电脑合计上限 120 点');
  await expect(summary).toContainText('开局不会一次扣除');
  await expect(summary).toContainText('不会自动提高上限');
  await expect(summary).toContainText('桌游币不能支付 AI');
  await expect(page.getByText(/有活跃席位时只能提高，不能降低/)).toBeVisible();
  await page.getByLabel('陪玩 AI').selectOption(token.id);
  await expect(page.getByText('输入 1,250 / 输出 2,500 点 / 百万 token')).toBeVisible();
  await expect(page.getByText(/单次最多 20 点/)).toBeVisible();
  await expect(summary).not.toContainText('当前可用点数不足');
  // Token calls can start below the single-call cap; no budget is silently raised.
  await page.getByLabel('每席位单局 AI 点数上限').fill('2');
  await expect(summary).toContainText('每席位上限 2 点，3 位电脑合计上限 6 点');
  await page.getByLabel('每席位单局 AI 点数上限').fill('');
  await expect(summary).toContainText('请填写');
  await page.getByLabel('每席位单局 AI 点数上限').fill('2');
  const widths = info.project.name === 'mobile' ? [390, 320] : [1440, 1280];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.emulateMedia({ reducedMotion: theme === 'dark' ? 'reduce' : 'no-preference' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      await page
        .getByRole('button', { name: '开始电脑对局', exact: true })
        .scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`budget-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.getByLabel('总人数（含你）').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '开始电脑对局', exact: true })).toBeFocused();
  expect(writes).toEqual([]);
});

test('explicit free-script selection hides paid settings and sends no enrollment', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.getByLabel('陪玩 AI').selectOption('');
  await expect(page.getByLabel('每席位单局 AI 点数上限')).toHaveCount(0);
  await page.getByLabel('总人数（含你）').selectOption('3');
  const summary = page.getByRole('region', { name: '本局陪玩与预算' });
  await expect(summary).toContainText('2 位电脑 · 免费脚本 AI');
  await expect(summary).toContainText('已选择全程脚本陪玩。本局不使用官方模型，不扣 AI 点数');
  await page.getByRole('button', { name: '开始电脑对局', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(writes).toEqual(['/rooms']);
  await expect(page.getByRole('button', { name: '继续本次开局' })).toBeEnabled();
});

test('an empty catalog uses scripts while a failed catalog keeps start disabled', async ({
  page,
}) => {
  const writes = await fixture(page, []);
  await expect(page.getByRole('region', { name: '本局陪玩与预算' })).toContainText(
    '官方 AI 尚未开放。本局不使用官方模型，不扣 AI 点数',
  );
  await expect(page.getByRole('button', { name: '开始电脑对局', exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
  await page.unroute('**/api/v1/**');
  await fixture(page, [], 0, true);
  await expect(page.getByRole('alert')).toContainText('暂时无法读取官方 AI 与点数');
  await expect(page.getByRole('button', { name: '开始电脑对局', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: '本局陪玩与预算' })).toHaveCount(0);
});
