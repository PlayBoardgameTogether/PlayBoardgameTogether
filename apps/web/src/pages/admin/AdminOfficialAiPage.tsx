import { useEffect, useRef, useState } from 'react';
import type { ModelProfile, OfficialAiOffer } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { ApiError } from '@boardgame/client-sdk';
import { api } from '../../platform.js';
import { AdminLayout, adminError, useAdminRequestId } from './AdminLayout.js';
import '../../styles/official-ai.css';
import { OfficialAiPrice, tokenSellingRates } from '../OfficialAiPrice.js';

export function AdminOfficialAiPage() {
  return (
    <AdminLayout
      path="/admin/official-ai"
      title="官方 AI 与点数"
      description="发布陪玩模型、发放点数，并核对实际调用用量。"
    >
      <OfficialAiAdmin />
    </AdminLayout>
  );
}
function OfficialAiAdmin() {
  const [offers, setOffers] = useState<OfficialAiOffer[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof api.adminAccounts>>['items']>(
    [],
  );
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.officialAiStats>>>();
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState(100);
  const [inputRate, setInputRate] = useState(0);
  const [outputRate, setOutputRate] = useState(0);
  const [markup, setMarkup] = useState(0);
  const tokenPricing = {
    inputPointsPerMillion: inputRate,
    outputPointsPerMillion: outputRate,
    markupPercent: markup,
  };
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState('官方 AI 体验点数');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const locked = useRef(false);
  const alive = useRef(true);
  const requestId = useAdminRequestId();
  const grantSequence = useRef(0);
  const pending = useRef<{ work: () => Promise<unknown>; message: string } | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void Promise.all([
      api.officialAiOffers(true, controller.signal),
      api.modelProfiles(),
      api.officialAiStats(controller.signal),
    ])
      .then(([catalog, saved, usage]) => {
        if (controller.signal.aborted) return;
        setOffers(catalog);
        setProfiles(saved);
        setStats(usage);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(adminError(cause));
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [refresh]);
  async function run(work: () => Promise<unknown>, message: string, mutation = true) {
    if (locked.current || (pending.current && pending.current.work !== work)) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    if (mutation) pending.current = { work, message };
    try {
      await work();
      pending.current = undefined;
      if (alive.current) {
        setUncertain(false);
        setNotice(message);
        setRefresh((value) => value + 1);
      }
    } catch (cause) {
      const unknownResult =
        mutation &&
        (!(cause instanceof ApiError) ||
          ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'].includes(cause.code));
      if (!unknownResult) pending.current = undefined;
      if (alive.current) setUncertain(unknownResult);
      if (alive.current) setError(adminError(cause));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="official-ai-page">
      {error && (
        <PageFeedback title="操作未完成" retry={() => setRefresh((value) => value + 1)}>
          {error}
        </PageFeedback>
      )}
      {notice && (
        <div className="ai-feedback" role="status">
          {notice}
        </div>
      )}
      {uncertain && (
        <div className="ai-feedback" role="status">
          <p>上次操作结果尚未确认，已暂时锁定表单。请以原请求重试，避免重复发放。</p>
          <button
            disabled={busy}
            onClick={() => {
              if (pending.current) void run(pending.current.work, pending.current.message);
            }}
          >
            重试上次未确认操作
          </button>
        </div>
      )}
      {stats && (
        <section className="ai-feedback" aria-label="官方 AI 用量">
          <h2>实际用量</h2>
          <p>
            发放 {stats.grantedPoints} 点 · 已消费 {stats.chargedPoints} 点 · 预留{' '}
            {stats.reservedPoints} 点
          </p>
          <p>
            调用 {stats.calls} 次 · 失败 {stats.failedCalls} 次 · 结果未知 {stats.unknownCalls} 次
          </p>
          <p>
            输入 {stats.inputTokens} token · 输出 {stats.outputTokens} token · 完成但缺少用量{' '}
            {stats.missingUsageCalls} 次
          </p>
          <p className="muted">
            新档位按实际 token
            用量结算成功行动。基础点价由管理员换算填写，供应商货币账单需另行核对。
          </p>
        </section>
      )}
      <fieldset className="ai-admin-forms" disabled={busy || uncertain}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = { name, profileId, pointsPerAction: price, tokenPricing };
            void run(
              () =>
                api.publishOfficialAi({
                  ...input,
                  requestId: requestId({ operation: 'publish', ...input }),
                }),
              '官方 AI 已发布。价格与模型绑定固定，调整时请发布新档位。',
            );
          }}
        >
          <h2>发布官方 AI</h2>
          <a href="/settings/models">配置平台使用的模型密钥</a>
          <label>
            来源模型配置
            <select
              required
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              <option value="">请选择本人模型配置</option>
              {profiles
                .filter((profile) => profile.enabled && profile.has_credential)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            玩家可见名称
            <input
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            输入基础点价（点 / 百万 token）
            <input
              type="number"
              required
              min={0}
              max={1000000000}
              step="1"
              value={inputRate}
              onChange={(event) => setInputRate(event.target.valueAsNumber)}
            />
          </label>
          <label>
            输出基础点价（点 / 百万 token）
            <input
              type="number"
              required
              min={0}
              max={1000000000}
              step="1"
              value={outputRate}
              onChange={(event) => setOutputRate(event.target.valueAsNumber)}
            />
          </label>
          <label>
            加价比例（%）
            <input
              type="number"
              required
              min={0}
              max={1000}
              step="1"
              value={markup}
              onChange={(event) => setMarkup(event.target.valueAsNumber)}
            />
          </label>
          <p className="muted" aria-live="polite">
            售价预览：{tokenSellingRates(tokenPricing)}（加价 {markup}%）。
            输入与输出基础点价至少一项大于 0；不自动获取供应商价格或汇率。
          </p>
          <label>
            单次预留上限（点）
            <input
              type="number"
              required
              min={1}
              max={10000}
              step="1"
              value={price}
              onChange={(event) => setPrice(event.target.valueAsNumber)}
            />
          </label>
          <p className="muted">
            按售价与实际用量合计向上取整。缺少用量或费用超过预留时免费兜底。
            发布后锁定点价、加价比例、模型和地址；调价需发布新档位。密钥可轮换或撤销。
          </p>
          <button disabled={busy || !profileId || !(inputRate + outputRate > 0)}>
            发布官方 AI
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = { accountId, points: amount, note };
            void run(async () => {
              await api.grantAiPoints({
                ...input,
                requestId: requestId({
                  operation: 'grant',
                  sequence: grantSequence.current,
                  ...input,
                }),
              });
              grantSequence.current++;
            }, '点数已发放并记入玩家账单。');
          }}
        >
          <h2>发放 AI 点数</h2>
          <label>
            搜索玩家
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={64}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(
                async () => {
                  const result = await api.adminAccounts(search);
                  if (alive.current) {
                    setAccounts(result.items);
                    setAccountId('');
                  }
                },
                '已更新玩家搜索结果。',
                false,
              )
            }
          >
            搜索账户
          </button>
          <label>
            收取点数的玩家
            <select
              required
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">请选择玩家</option>
              {accounts
                .filter((account) => account.status === 'active')
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} · @{account.username}
                  </option>
                ))}
            </select>
          </label>
          <label>
            发放点数
            <input
              type="number"
              required
              min={1}
              max={1000000}
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.valueAsNumber)}
            />
          </label>
          <label>
            账单说明
            <input
              required
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button disabled={busy || !accountId}>发放点数</button>
        </form>
      </fieldset>
      <section>
        <h2>官方模型目录</h2>
        {!offers.length && <p className="muted">尚未发布官方 AI。</p>}
        <ul className="ai-ledger">
          {offers.map((offer) => (
            <li key={offer.id}>
              <div>
                <strong>{offer.name}</strong>
                <div>
                  <OfficialAiPrice offer={offer} /> · {offer.enabled ? '开放中' : '已停用'}
                </div>
                {offer.tokenPricing && (
                  <small>
                    基础点价：输入 {offer.tokenPricing.inputPointsPerMillion} / 输出{' '}
                    {offer.tokenPricing.outputPointsPerMillion} 点 / 百万 token · 加价{' '}
                    {offer.tokenPricing.markupPercent}%
                  </small>
                )}
              </div>
              <button
                className="secondary"
                disabled={busy || uncertain}
                onClick={() => {
                  const input = { expectedRevision: offer.revision, enabled: !offer.enabled };
                  void run(
                    () =>
                      api.setOfficialAiStatus(offer.id, {
                        ...input,
                        requestId: requestId({ operation: 'status', id: offer.id, ...input }),
                      }),
                    '开放状态已更新。',
                  );
                }}
              >
                {offer.enabled ? '停用' : '开放'}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">停用会阻止新调用；已发送的有效决策仍可能完成并按原价格结算。</p>
      </section>
    </div>
  );
}
