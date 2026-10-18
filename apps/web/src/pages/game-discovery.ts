import type { AvailableGame } from './game-catalog.js';

// Editorial presentation only, scoped to reviewed versions. Rules and tutorials
// remain owned by the game extensions; unknown versions use catalog metadata.
const discovery: Record<string, { invitation: string; hook: string; firstMove: string }> = {
  'color-match@1.0.0': {
    invitation: '一张牌，就能让局面反转。',
    hook: '跟颜色，还是跟数字？打出数字 5，把摸牌留给对手。',
    firstMove: '匹配公共牌的颜色或数字，先打完手牌的人获胜。',
  },
  'splendor.base@1.0.0': {
    invitation: '从几颗宝石，到你的商业帝国。',
    hook: '先攒折扣，还是抢下高分卡？每一次拿取，都在为下一手铺路。',
    firstMove: '拿取宝石、购买发展卡，用永久折扣建立你的得分引擎。',
  },
  'azul.base@1.0.0': {
    invitation: '好看的花砖，也能下出漂亮的一手。',
    hook: '补齐自己的图案行，还是拿走对手想要的颜色？选砖也是一场博弈。',
    firstMove: '挑选同色花砖，填满图案行，再铺到彩墙上连接得分。',
  },
  'grid-garden@1.0.0': {
    invitation: '小小花园，藏着你的一盘好棋。',
    hook: '收获眼前的分数，还是为下一轮扩建？一起秘密选择，揭晓各自的打算。',
    firstMove: '秘密选择收获或建造，把骨牌放进自己的花园，争取最高分。',
  },
  'gomoku@1.0.0': {
    invitation: '黑白交错，方寸之间见真章。',
    hook: '连珠成线，攻守瞬息万变。开局抢占先手，步步为营。',
    firstMove: '黑白双方轮流落子，率先在横、竖或斜向连成五子获胜。',
  },
  'uno@1.0.0': {
    invitation: '喊出 UNO，好友聚会的欢乐焦点。',
    hook: '跟色、跟数字，善用反转与加牌卡，给对手一个措手不及！',
    firstMove: '打出相同颜色或数字的手牌，最后一张牌时记得喊出 UNO。',
  },
  'catan@1.0.0': {
    invitation: '扬帆起航，开拓你的卡坦岛。',
    hook: '掷骰产出资源，修路建房，与邻桌展开智慧的交易博弈。',
    firstMove: '收集资源建设定居点与道路，率先达到 10 分夺得胜利。',
  },
  'rummikub@1.0.0': {
    invitation: '数字重组，桌面上的脑力风暴。',
    hook: '顺子还是同号？拆分公共牌池，拼接出让人惊叹的全新牌组。',
    firstMove: '30分破冰入场，将手中的数字牌拼成顺子或同数套牌，最快清空手牌获胜。',
  },
};

export function gameDiscovery(game: AvailableGame) {
  return discovery[`${game.id}@${game.version}`];
}
