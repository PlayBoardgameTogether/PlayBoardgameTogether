import type { BadgeRule } from '@boardgame/protocol';

export function badgeRuleLabel(rule: BadgeRule) {
  if (rule.type === 'manual') return '由管理员授予或收回';
  const conditions = rule.conditions.map((condition) =>
    condition.metric === 'finished'
      ? `完成 ${condition.target} 局正式对局`
      : condition.metric === 'games'
        ? `完成 ${condition.target} 种不同游戏`
        : `在 ${condition.gameId} 完成 ${condition.target} 局`,
  );
  return `${rule.mode === 'all' ? '满足全部条件' : '满足任一条件'}：${conditions.join('；')}`;
}
