import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  BadgeCondition,
  BadgeDefinition,
  BadgeDefinitionInput,
  BadgeRule,
} from '@boardgame/protocol';
import { badgeDefinitionInputSchema } from '@boardgame/protocol';
import { ApiError } from '@boardgame/client-sdk';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../../platform.js';
import { badgeRuleLabel } from '../../badges/rule-label.js';
import { AdminLayout, adminError } from './AdminLayout.js';
import '../../styles/badges.css';

type Draft = Omit<BadgeDefinition, 'id'> & { id?: string };
const empty = (): Draft => ({
  name: '',
  description: '',
  symbol: '🏅',
  enabled: true,
  revision: 0,
  rule: { type: 'manual' },
});
const condition = (): BadgeCondition => ({ metric: 'finished', target: 10 });

function Designer() {
  const [items, setItems] = useState<BadgeDefinition[]>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [games, setGames] = useState<{ id: string; name: string }[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BadgeDefinitionInput>();
  const alive = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    alive.current = true;
    setError('');
    void Promise.all([api.adminBadgeDefinitions(controller.signal), api.adminGames()])
      .then(([definitions, installed]) => {
        if (controller.signal.aborted) return;
        setItems(definitions.items);
        setGames([
          ...new Map(
            installed
              .filter((game) => !game.developmentOnly)
              .map((game) => [game.id, { id: game.id, name: game.name }]),
          ).values(),
        ]);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(adminError(cause));
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [attempt]);

  function changeRule(rule: BadgeRule) {
    setDraft((current) => ({ ...current, rule }));
  }
  function changeCondition(index: number, value: BadgeCondition) {
    if (draft.rule.type !== 'automatic') return;
    changeRule({
      ...draft.rule,
      conditions: draft.rule.conditions.map((item, i) => (i === index ? value : item)),
    });
  }
  async function save(input: BadgeDefinitionInput) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setPending(input);
    setError('');
    setNotice('');
    try {
      await api.saveBadgeDefinition(input);
      const current = await api.adminBadgeDefinitions();
      if (!alive.current) return;
      setItems(current.items);
      const saved = current.items.find((item) => item.id === input.id);
      if (saved) setDraft(saved);
      setPending(undefined);
      setNotice('徽章设计已保存。');
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && !cause.retryable) setPending(undefined);
      setError(adminError(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = badgeDefinitionInputSchema.safeParse({
      id: draft.id ?? `custom-${crypto.randomUUID()}`,
      name: draft.name,
      description: draft.description,
      symbol: draft.symbol,
      enabled: draft.enabled,
      rule: draft.rule,
      requestId: crypto.randomUUID(),
      expectedRevision: draft.revision,
    });
    if (!result.success) {
      setError('请填写完整的名称、说明、符号和有效规则；条件目标须为 1–1000000 的整数。');
      return;
    }
    void save(result.data);
  }
  if (!items)
    return (
      <PageFeedback
        title={error ? '徽章设计加载失败' : '正在加载徽章设计…'}
        loading={!error}
        {...(error ? { retry: () => setAttempt((value) => value + 1) } : {})}
      >
        {error}
      </PageFeedback>
    );
  return (
    <div className="badge-designer">
      <section className="panel">
        <h2>{draft.id ? '编辑徽章' : '创建徽章'}</h2>
        <p className="muted">
          规则按历史正式对局实时计算。提高门槛或停用后，不再符合条件的徽章会从名片隐藏；重新启用后恢复。
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy || !!pending}>
            <label>
              徽章名称
              <input
                required
                maxLength={40}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              徽章符号
              <input
                required
                maxLength={16}
                value={draft.symbol}
                onChange={(event) => setDraft({ ...draft, symbol: event.target.value })}
              />
            </label>
            <label>
              徽章说明
              <textarea
                required
                maxLength={500}
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>
            <label>
              授予方式
              <select
                aria-label="授予方式"
                disabled={!!draft.id}
                value={draft.rule.type}
                onChange={(event) =>
                  changeRule(
                    event.target.value === 'manual'
                      ? { type: 'manual' }
                      : { type: 'automatic', mode: 'all', conditions: [condition()] },
                  )
                }
              >
                <option value="manual">管理员手动授予</option>
                <option value="automatic">达标自动解锁</option>
              </select>
            </label>
            {draft.id && <small>授予方式创建后固定；自动规则的条件仍可编辑。</small>}
            {draft.rule.type === 'automatic' && (
              <>
                <label>
                  条件组合
                  <select
                    aria-label="条件组合"
                    value={draft.rule.mode}
                    onChange={(event) => {
                      if (draft.rule.type === 'automatic')
                        changeRule({
                          ...draft.rule,
                          mode: event.target.value === 'all' ? 'all' : 'any',
                        });
                    }}
                  >
                    <option value="all">满足全部条件</option>
                    <option value="any">满足任一条件</option>
                  </select>
                </label>
                {draft.rule.conditions.map((item, index) => (
                  <div className="badge-rule-row" key={index}>
                    <label>
                      条件 {index + 1}
                      <select
                        aria-label={`条件 ${index + 1}`}
                        value={item.metric}
                        onChange={(event) =>
                          changeCondition(
                            index,
                            event.target.value === 'gameFinished'
                              ? {
                                  metric: 'gameFinished',
                                  target: item.target,
                                  gameId: games[0]?.id ?? '',
                                }
                              : {
                                  metric: event.target.value === 'games' ? 'games' : 'finished',
                                  target: item.target,
                                },
                          )
                        }
                      >
                        <option value="finished">完成正式对局数</option>
                        <option value="games">完成不同游戏种类数</option>
                        <option value="gameFinished">指定游戏完成局数</option>
                      </select>
                    </label>
                    {item.metric === 'gameFinished' && (
                      <label>
                        指定游戏 {index + 1}
                        <select
                          aria-label={`指定游戏 ${index + 1}`}
                          required
                          value={item.gameId}
                          onChange={(event) =>
                            changeCondition(index, { ...item, gameId: event.target.value })
                          }
                        >
                          <option value="">请选择游戏</option>
                          {games.map((game) => (
                            <option key={game.id} value={game.id}>
                              {game.name}（{game.id}）
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      目标 {index + 1}
                      <input
                        type="number"
                        required
                        min={1}
                        max={1000000}
                        step={1}
                        value={item.target}
                        onChange={(event) =>
                          changeCondition(index, { ...item, target: Number(event.target.value) })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        draft.rule.type !== 'automatic' || draft.rule.conditions.length <= 1
                      }
                      aria-label={`删除条件 ${index + 1}`}
                      onClick={() => {
                        if (draft.rule.type === 'automatic')
                          changeRule({
                            ...draft.rule,
                            conditions: draft.rule.conditions.filter((_, i) => i !== index),
                          });
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={draft.rule.conditions.length >= 8}
                  onClick={() => {
                    if (draft.rule.type === 'automatic')
                      changeRule({
                        ...draft.rule,
                        conditions: [...draft.rule.conditions, condition()],
                      });
                  }}
                >
                  添加条件
                </button>
              </>
            )}
            <label className="badge-select">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              启用徽章
            </label>
            <p aria-label="规则预览">
              {draft.symbol} {draft.name || '新徽章'} · {badgeRuleLabel(draft.rule)}
            </p>
            <div className="badge-feedback">
              <button type="submit">{busy ? '保存中…' : '保存徽章设计'}</button>
              {draft.id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDraft(empty());
                    setNotice('');
                    setError('');
                  }}
                >
                  新建徽章
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {error && (
          <div role="alert">
            <p>{error}</p>
            {pending && (
              <button disabled={busy} onClick={() => void save(pending)}>
                重试原操作
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setPending(undefined);
                setItems(undefined);
                setDraft(empty());
                setAttempt((value) => value + 1);
              }}
            >
              刷新设计
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section aria-label="已设计徽章">
        <h2>已设计徽章</h2>
        {!items.length && (
          <p className="muted">还没有自定义徽章，使用表单创建第一枚。内置徽章保持原有规则。</p>
        )}
        <div className="badge-grid">
          {items.map((item) => (
            <article className="panel" key={item.id} aria-label={item.name}>
              <h3>
                {item.symbol} {item.name}
              </h3>
              <p>{item.description}</p>
              <p>{badgeRuleLabel(item.rule)}</p>
              <p>{item.enabled ? '已启用' : '已停用'}</p>
              <button
                className="secondary"
                disabled={busy || !!pending}
                onClick={() => {
                  setDraft(item);
                  setNotice('');
                  setError('');
                }}
              >
                编辑{item.name}
              </button>
            </article>
          ))}
        </div>
        <p>
          <a href="/admin/accounts">前往账户管理，授予或收回手动徽章 →</a>
        </p>
      </section>
    </div>
  );
}

export function AdminBadgeDesignerPage() {
  return (
    <AdminLayout
      path="/admin/badges"
      title="徽章设计"
      description="设计专属徽章，为玩家制定获取规则。"
    >
      <Designer />
    </AdminLayout>
  );
}
