import { openRoomCreation, openInviteJoin } from './fixtures.js';
import {test,expect} from './fixtures.js';

test('quick creation opens the room, copies invite, and exposes password rooms through filtered lobby',async({browser},testInfo)=>{
  const host=await browser.newContext(testInfo.project.use);
  const guest=await browser.newContext(testInfo.project.use);
  const a=await host.newPage(),b=await guest.newPage();
  await a.addInitScript(()=>{
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as unknown as {copied:string}).copied=text;}}});
  });
  try {
    for(const [page,user] of [[a,'stage3_a'],[b,'stage3_b']] as const){
      await page.goto('/login');await page.getByLabel('用户名').fill(user);
      await page.getByLabel('密码',{exact:true}).fill('stage two password');
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await expect(page.getByRole('heading',{name:'游戏大厅',exact:true})).toBeVisible();
    }
    await openRoomCreation(a);
    await a.getByLabel('游戏与版本').selectOption('color-match@1.0.0');
    await a.getByLabel('房间名',{exact:true}).fill('周五密码桌');
    await a.getByLabel('人数',{exact:true}).fill('3');
    await a.getByLabel('房间密码（选填）',{exact:true}).fill('room-password');
    await a.getByRole('button',{name:'创建并生成邀请码'}).click();
    await expect(a.getByRole('heading',{name:'周五密码桌',exact:true})).toBeVisible();
    await expect(a).toHaveURL(/\/rooms\//);
    await a.getByRole('button',{name:'复制邀请码'}).click();
    await expect(a.getByText('邀请码已复制',{exact:true})).toBeVisible();
    expect(await a.evaluate(()=>(window as unknown as {copied:string}).copied)).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    await a.getByText('游戏规则与 AI 提示词',{exact:true}).click();
    await expect(a.getByText(/数字 5：出牌后必须选择另一位玩家/)).toBeVisible();
    await a.getByRole('button',{name:'复制规则'}).click();
    await expect(a.getByText('规则已复制，可用于模型提示词。',{exact:true})).toBeVisible();
    await a.getByRole('link',{name:'游戏大厅',exact:true}).click();
    await openRoomCreation(a);
    await a.getByRole('button',{name:'创建并生成邀请码'}).click();
    await expect(a.getByRole('alert')).toContainText('已创建一个有效房间');

    await openInviteJoin(b);
    await expect(b.getByLabel('筛选游戏')).toHaveCount(0);
    await b.getByLabel('筛选房间类型').selectOption('password');
    const row=b.locator('article.room-row').filter({hasText:'周五密码桌'});
    await expect(row).toBeVisible();
    await expect(row).toContainText('1/3 人');
    await expect(row).toContainText('房主：玩家 D · @stage3_a');
    await row.getByRole('button',{name:'加入房间'}).click();
    await expect(b.getByLabel('加入房间密码',{exact:true})).toBeFocused();
    await b.getByRole('button',{name:'取消',exact:true}).click();
    await expect(row.getByRole('button',{name:'加入房间'})).toBeFocused();
    await expect(b.getByLabel('加入房间密码',{exact:true})).toHaveCount(0);
    await row.getByRole('button',{name:'加入房间'}).click();
    await b.getByLabel('加入房间密码',{exact:true}).fill('incorrect');
    await b.getByRole('button',{name:'确认加入'}).click();
    await expect(b.getByRole('alert')).toContainText('房间密码不正确');
    await expect(b.getByLabel('加入房间密码',{exact:true})).toBeFocused();
    await expect(b.getByRole('form', { name: '加入 周五密码桌' }).getByRole('alert')).toContainText('房间密码不正确');
    await b.getByLabel('加入房间密码',{exact:true}).fill('room-password');
    await b.getByRole('button',{name:'确认加入'}).click();
    await expect(b.getByRole('heading',{name:'周五密码桌',exact:true})).toBeVisible();
    expect(await b.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await b.screenshot({path:testInfo.outputPath('password-room.png'),fullPage:true});
    await b.getByRole('link',{name:'游戏大厅',exact:true}).click();
    await expect(b.getByRole('heading',{name:'游戏大厅',exact:true})).toBeVisible();
    await b.screenshot({path:testInfo.outputPath('lobby.png'),fullPage:true});
    expect(await b.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  }finally{await host.close();await guest.close();}
});
