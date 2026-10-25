import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';
const colorNames: Record<string, string> = { red: '红', yellow: '黄', green: '绿', blue: '蓝', wild: '万能' };
const symbols: Record<string, string> = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4', draw4: '+4', reverse4: '⇄+4', draw6: '+6', draw10: '+10', skipAll: '⊘∀', discardAll: '≋', roulette: '◉' };
for (const edition of [
    { id: 'online.uno', name: 'UNO · 休闲版', version: '1.2.0', archive: 'uno' },
    { id: 'online.uno-no-mercy', name: 'UNO · 毫不留情', version: '1.0.0', archive: 'uno-no-mercy' },
]) {
  test(`${edition.name} ZIP completes a real human/script-AI game`, async ({ page }, info) => {
    test.setTimeout(180000);
    await page.goto('/login');
    await page.getByLabel('用户名').fill('stage7_admin');
    await page.getByLabel('密码', { exact: true }).fill('stage two password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '游戏大厅', exact: true })).toBeVisible();
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: '上传游戏 ZIP' }).click();
    const bytes = await readFile(`dist/game-packages/${edition.archive}-${edition.version}.zip`);
    await page.getByLabel('游戏 ZIP 文件').setInputFiles({ name: `${edition.archive}-${edition.version}.zip`, mimeType: 'application/zip', buffer: bytes });
    await page.getByRole('button', { name: '检查游戏包', exact: true }).click();
    await page.getByRole('button', { name: /^(审核通过并上架|确认已安装版本)$/, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已安装并上架' })).toBeVisible();
    await page.goto('/');
    const card = page.locator(`a.game-card[href="/games/${edition.id}/${edition.version}"]`);
    await expect(card).toBeVisible();
    await expect.poll(() => card.locator('.game-cover img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 100)).toBe(true);
    const icon = card.locator('.game-card-icon img');
    if (info.project.name === 'mobile') {
        // The current mobile catalog intentionally hides redundant icons; lazy images need not decode.
        await expect(icon).toBeHidden();
        const art = await page.request.get((await icon.getAttribute('src'))!);
        expect(art.ok()).toBe(true);
        expect(art.headers()['content-type']).toContain('image/png');
    } else {
        await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 100)).toBe(true);
    }
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('uno-lobby-cover.png'), fullPage: true });
    await card.click();
    await expect(page.getByRole('heading', { name: edition.name, exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.game-banner-background img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 100)).toBe(true);
    await page.screenshot({ path: info.outputPath('uno-detail-background.png'), fullPage: true });
    await page.getByRole('link', { name: '创建房间', exact: true }).click();
    await page.getByLabel('房间名', { exact: true }).fill('UNO AI ' + info.project.name);
    await page.getByLabel('人数', { exact: true }).fill('2');
    await page.getByRole('button', { name: '创建并生成邀请码' }).click();
    await page.getByRole('button', { name: '添加脚本 AI', exact: true }).click();
    await expect(page.getByText('脚本 AI · 已就绪', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(page.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: edition.name, exact: true })).toBeVisible();
    const matchId = new URL(page.url()).pathname.split('/').at(-1)!;
    const snapshot = async () => {
        const response = await page.request.get(`/api/v1/matches/${matchId}/view`);
        expect(response.ok()).toBe(true);
        return (await response.json()).data;
    };
    const frame = page.frameLocator('iframe[title="在线游戏桌面"]');
    await expect(frame.locator('#hand button').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('uno-ai-table.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('iframe[title="在线游戏桌面"]')).toBeVisible();
    let finished = false;
    for (let move = 0; move < 400; move++) {
        await expect.poll(async () => {
            const data = await snapshot();
            return data.status === 'finished' || (data.view.currentSeat === data.view.you && data.view.actions.length > 0);
        }, { timeout: 15000 }).toBe(true);
        const data = await snapshot();
        if (data.status === 'finished') {
            finished = true;
            break;
        }
        const action = data.view.actions[0];
        expect(data.view).not.toHaveProperty('hands');
        expect(data.view).not.toHaveProperty('deck');
        const reply = page.waitForResponse(response => response.url().endsWith(`/matches/${matchId}/actions`) && response.request().method() === 'POST');
        if (action.type === 'play') {
            const card = data.view.hand.find((item: {
                id: string;
            }) => item.id === action.cardId);
            const uno = frame.getByLabel('出牌时喊 UNO');
            if (await uno.isVisible())
                await uno.check();
            const index = data.view.hand.findIndex((item: {
                id: string;
            }) => item.id === action.cardId);
            const selected = frame.locator('#hand button').nth(index);
            await expect(selected).toHaveAccessibleName(`${colorNames[card.color]}色 ${symbols[card.value] || card.value}`);
            await selected.click();
            if (action.color !== null)
                await frame.getByRole('button', { name: colorNames[action.color], exact: true }).click();
        }
        else if (action.type === 'swap') {
            const seat = data.view.players.findIndex((player: {seatId: string}) => player.seatId === action.target) + 1;
            await frame.getByRole('button', { name: new RegExp(`^与座位 ${seat}交换`) }).click();
        } else if (action.type === 'roulette') {
            await frame.getByRole('button', { name: `轮盘选${colorNames[action.color]}色`, exact: true }).click();
        } else if (action.type === 'callUno' || action.type === 'catchUno') {
            await frame.locator('#uno-alert').click();
        } else {
            await frame.locator('#draw').click();
        }
        expect((await reply).status()).toBe(200);
        await expect.poll(async () => (await snapshot()).revision).toBeGreaterThan(data.revision);
    }
    expect(finished).toBe(true);
    await expect(frame.locator('#status')).toContainText('获胜');
    await page.screenshot({ path: info.outputPath('uno-ai-finished.png'), fullPage: true });
    await page.getByRole('button', { name: '返回房间', exact: true }).click();
    await expect(page).toHaveURL(/\/rooms\//);
    await expect(page.getByRole('button', { name: '准备', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('uno-ai-returned-room.png'), fullPage: true });
});

}
