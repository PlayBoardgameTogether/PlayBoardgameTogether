import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiPointLedger,
  AiPointWallet,
  ModelProfile,
  OfficialAiOffer,
} from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../platform.js';
import '../styles/official-ai.css';

export function OfficialAiPage() {
  const [offers, setOffers] = useState<OfficialAiOffer[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [wallet, setWallet] = useState<AiPointWallet>();
  const [ledger, setLedger] = useState<AiPointLedger>();
  const [budget, setBudget] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const previous = useRef<{ key: string; id: string } | undefined>(undefined);
  const generation = useRef(0);
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const current = ++generation.current;
    setError('');
    void Promise.all([
      api.officialAiOffers(false, controller.signal),
      api.officialAiProfiles(controller.signal),
      api.aiPointWallet(controller.signal),
      api.aiPointLedger(undefined, controller.signal),
    ])
      .then(([catalog, saved, points, history]) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setOffers(catalog);
        setProfiles(saved);
        setWallet(points);
        setLedger(history);
        setBudget(
          Object.fromEntries(
            catalog.map((offer) => [
              offer.id,
              saved.find((profile) => profile.official_offer_id === offer.id)
                ?.official_match_budget ?? Math.max(100, offer.pointsPerAction),
            ]),
          ),
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '读取失败，请重试');
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [refresh]);

  async function enable(offer: OfficialAiOffer) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const input = { offerId: offer.id, matchBudget: budget[offer.id] ?? 100 };
    const key = JSON.stringify(input);
    if (previous.current?.key !== key) previous.current = { key, id: crypto.randomUUID() };
    try {
      await api.enrollOfficialAi({ ...input, requestId: previous.current.id });
      previous.current = undefined;
      if (mounted.current) {
        setNotice(
          '已保存。可在房间添加此官方 AI，或在对局工具中启用本人托管；已有受阻决策会按新上限继续。',
        );
        retry();
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '保存未确认，请重试');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function more() {
    if (!ledger?.nextCursor || locked.current) return;
    locked.current = true;
    setBusy(true);
    const current = generation.current;
    try {
      const page = await api.aiPointLedger(ledger.nextCursor);
      if (mounted.current && current === generation.current)
        setLedger((old) =>
          old ? { items: [...old.items, ...page.items], nextCursor: page.nextCursor } : page,
        );
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '账单读取失败');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="official-ai-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">PlayBoard 陪玩</p>
          <h1>官方 AI</h1>
          <p>选好陪玩，给每一桌设一个安心的点数上限。</p>
        </div>
        <a href="/settings/models">自带模型配置</a>
      </header>
      {error && (
        <PageFeedback title="暂时无法完成操作" retry={retry}>
          {error}
        </PageFeedback>
      )}
      {notice && (
        <div className="ai-feedback" role="status">
          {notice}
        </div>
      )}
      {!wallet ? (
        !error && <PageFeedback title="正在读取 AI 点数…" loading />
      ) : (
        <>
          <section className="ai-wallet" aria-label="AI 点数账户">
            <div>
              <span>可用 AI 点数</span>
              <strong>{wallet.available.toLocaleString()}</strong>
            </div>
            <p>
              余额 {wallet.balance.toLocaleString()} 点 · 使用中预留{' '}
              {wallet.reserved.toLocaleString()} 点
            </p>
            <button type="button" className="secondary" onClick={retry} disabled={busy}>
              刷新余额与账单
            </button>
            <p className="muted">
              点数由管理员发放。每次官方 AI 成功行动扣费，失败与脚本兜底免费。
            </p>
          </section>
          <section aria-labelledby="ai-catalog-title">
            <h2 id="ai-catalog-title">选择官方 AI</h2>
            <p className="muted">
              单局上限按每个席位分别计算；多个 AI 共用你的余额。关闭页面不会停止托管。
              修改将应用于此官方 AI
              的所有进行中席位，进行中仅可提高上限；补点或提高上限会继续受阻决策，已消费点数不清零。
            </p>
            {!offers.length && (
              <p className="ai-feedback">
                官方 AI 尚未开放，请稍后再来。基础脚本 AI 仍可在房间免费添加。
              </p>
            )}
            <div className="ai-offer-grid">
              {offers.map((offer) => {
                const saved = profiles.find((profile) => profile.official_offer_id === offer.id);
                return (
                  <form
                    className="ai-offer"
                    key={offer.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void enable(offer);
                    }}
                  >
                    <h3>{offer.name}</h3>
                    <p>
                      <strong>{offer.pointsPerAction} 点</strong> / 成功行动
                    </p>
                    <label>
                      每席位单局上限（点）
                      <input
                        type="number"
                        min={offer.pointsPerAction}
                        max={1000000}
                        step="1"
                        required
                        value={budget[offer.id] ?? 100}
                        onChange={(event) =>
                          setBudget((old) => ({ ...old, [offer.id]: event.target.valueAsNumber }))
                        }
                      />
                    </label>
                    <button disabled={busy}>{saved ? '保存点数上限' : '启用此官方 AI'}</button>
                    {saved && (
                      <span className="muted">
                        已启用 · 当前上限 {saved.official_match_budget} 点
                      </span>
                    )}
                  </form>
                );
              })}
            </div>
            <p className="muted">
              启用后，在房间的“选择模型 AI”或对局的“控制方式”中选择官方 AI。由你启用的 AI
              消耗你的点数；模型仅接收该席位可见的信息。
            </p>
          </section>
          <section aria-labelledby="ai-ledger-title">
            <h2 id="ai-ledger-title">点数账单</h2>
            {!ledger?.items.length ? (
              <p className="muted">还没有点数记录。</p>
            ) : (
              <ol className="ai-ledger">
                {ledger.items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.note}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString()} · 余额 {item.balanceAfter}
                      </small>
                      {item.matchId && (
                        <a href={`/matches/${item.matchId}`}>查看对局（需参与权限）</a>
                      )}
                    </div>
                    <span className={item.delta > 0 ? 'ai-credit' : ''}>
                      {item.delta > 0 ? '+' : ''}
                      {item.delta} 点
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {ledger?.nextCursor && (
              <button className="secondary" disabled={busy} onClick={() => void more()}>
                更早记录
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
