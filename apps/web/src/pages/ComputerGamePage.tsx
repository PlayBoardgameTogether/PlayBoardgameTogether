import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError } from '@boardgame/client-sdk';
import {
  createRoomInputSchema,
  officialAiEnrollSchema,
  type OfficialAiOffer,
  type ModelProfile,
  type AiPointWallet,
} from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api, command, navigate } from '../platform.js';
import { clientGame } from '../game-registry.js';
import { gamePath, useGameCatalog } from './game-catalog.js';
import { OfficialAiPrice } from './OfficialAiPrice.js';

const pendingSchema = z
  .object({
    accountId: z.string().uuid(),
    create: createRoomInputSchema,
    readyId: z.string(),
    startId: z.string(),
    roomId: z.string().uuid().optional(),
    enrollment: officialAiEnrollSchema.optional(),
  })
  .strict();
type Pending = z.infer<typeof pendingSchema>;

export function ComputerGamePage({ id, version }: { id: string; version: string }) {
  const { games, error: catalogError, retry } = useGameCatalog();
  const [accountId, setAccountId] = useState<string>();
  const [authError, setAuthError] = useState('');
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offers, setOffers] = useState<OfficialAiOffer[]>();
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [wallet, setWallet] = useState<AiPointWallet>();
  const [offerId, setOfferId] = useState('');
  const [budget, setBudget] = useState(100);
  const [seatCount, setSeatCount] = useState<number>();
  const [aiError, setAiError] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);
  const key = `boardgame:computer-game:${id}@${version}`;
  const game = games?.find((item) => item.id === id && item.version === version);
  const offer = offers?.find((item) => item.id === offerId);
  const selectedSeatCount = pending?.create.seatCount ?? seatCount ?? game?.players.min ?? 2;
  const budgetValid = Number.isInteger(budget) && budget >= 1 && budget <= 1000000;
  const minimumCallPoints = offer?.tokenPricing ? 1 : (offer?.pointsPerAction ?? 1);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void api
      .me(controller.signal)
      .then(async (me) => {
        if (!mounted.current || controller.signal.aborted) return;
        setAccountId(me.account.id);
        try {
          const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
          const saved = pendingSchema.safeParse(raw);
          if (
            saved.success &&
            saved.data.accountId === me.account.id &&
            saved.data.create.gameId === id &&
            saved.data.create.version === version &&
            saved.data.create.computerOpponents === true
          )
            setPending(saved.data);
          else sessionStorage.removeItem(key);
        } catch {
          setError('无法读取开局进度，请允许浏览器使用会话存储后重试。');
        }
        try {
          const [catalog, saved, points] = await Promise.all([
            api.officialAiOffers(false, controller.signal),
            api.officialAiProfiles(controller.signal),
            api.aiPointWallet(controller.signal),
          ]);
          if (controller.signal.aborted) return;
          const available = catalog.filter((item) => item.enabled);
          const preferred =
            available.find((item) =>
              saved.some((profile) => profile.official_offer_id === item.id),
            ) ?? available[0];
          setOffers(available);
          setProfiles(saved);
          setWallet(points);
          setOfferId(preferred?.id ?? '');
          setBudget(
            saved.find((profile) => profile.official_offer_id === preferred?.id)
              ?.official_match_budget ?? Math.max(100, preferred?.pointsPerAction ?? 1),
          );
        } catch {
          if (!controller.signal.aborted) setAiError('暂时无法读取官方 AI 与点数，请刷新重试。');
        }
      })
      .catch((cause) => {
        if (mounted.current && !controller.signal.aborted)
          setAuthError(
            cause instanceof ApiError && cause.code === 'UNAUTHENTICATED'
              ? '登录后即可和电脑开一局。'
              : '暂时无法验证登录状态，请刷新重试。',
          );
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [id, version, key]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || !accountId || lock.current || (!pending && !offers)) return;
    const fields = new FormData(event.currentTarget);
    let operation = pending;
    if (!operation)
      operation = pendingSchema.parse({
        accountId,
        create: {
          requestId: command(),
          name: `${game.name} · 电脑对局`.slice(0, 40),
          gameId: id,
          version,
          options: clientGame(id, version)?.defaultOptions ?? {},
          seatCount: Number(fields.get('seatCount')),
          visibility: 'private',
          computerOpponents: true,
        },
        readyId: command(),
        startId: command(),
        ...(offer
          ? { enrollment: { requestId: command(), offerId: offer.id, matchBudget: budget } }
          : {}),
      });
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      // Persist before sending; refresh and retries reuse every command's exact identity/body.
      sessionStorage.setItem(key, JSON.stringify(operation));
      setPending(operation);
      if (operation.enrollment && !operation.create.computerModelProfileId) {
        const enrolled = await api.enrollOfficialAi(operation.enrollment);
        if (!mounted.current) return;
        operation = {
          ...operation,
          create: { ...operation.create, computerModelProfileId: enrolled.profileId },
        };
        sessionStorage.setItem(key, JSON.stringify(operation));
        setPending(operation);
      }
      const created = await api.createRoom(operation.create);
      if (!mounted.current) return;
      operation = { ...operation, roomId: created.roomId };
      sessionStorage.setItem(key, JSON.stringify(operation));
      setPending(operation);
      await api.roomCommand(created.roomId, {
        type: 'ready',
        requestId: operation.readyId,
        expectedRoomRevision: 0,
        ready: true,
      });
      if (!mounted.current) return;
      const started = await api.roomCommand(created.roomId, {
        type: 'start',
        requestId: operation.startId,
        expectedRoomRevision: 1,
      });
      if (!mounted.current || !('matchId' in started)) return;
      sessionStorage.removeItem(key);
      navigate(`/matches/${started.matchId}`);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof ApiError ? cause.message : '开局暂未完成，请检查网络后继续。');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (catalogError)
    return (
      <PageFeedback title="游戏加载失败" retry={retry}>
        {catalogError}
      </PageFeedback>
    );
  if (!games) return <PageFeedback title="正在加载游戏…" loading />;
  if (!game || !game.supportsScriptAi)
    return (
      <PageFeedback title="暂时无法开始电脑对局">
        此版本未启用或不支持脚本 AI。<a href={gamePath({ id, version })}>返回游戏详情</a>
      </PageFeedback>
    );
  return (
    <div className="new-room-page">
      <p>
        <a href={gamePath(game)}>← 返回游戏详情</a>
      </p>
      <section className="room-create-shell">
        <p className="eyebrow">{game.name}</p>
        <h1>和电脑开一局</h1>
        <p className="muted">你坐第一席，其余席位由电脑陪玩；可选择官方 AI 优先或全程免费脚本。</p>
        <p className="muted">这是完整正式对局，会计入对局记录；每人最多同时主持一个房间。</p>
        {authError ? (
          <PageFeedback title="需要确认登录状态">
            {authError} <a href="/login">前往登录</a>
          </PageFeedback>
        ) : !accountId ? (
          <p role="status">正在验证会话…</p>
        ) : (
          <form className="form-stack" onSubmit={(event) => void start(event)}>
            {!pending &&
              (aiError ? (
                <p className="error-notice" role="alert">
                  {aiError}
                </p>
              ) : !offers ? (
                <p role="status">正在读取官方 AI 与点数…</p>
              ) : offers.length ? (
                <>
                  <label>
                    陪玩 AI
                    <select
                      value={offerId}
                      disabled={busy}
                      onChange={(event) => {
                        const selected = offers.find((item) => item.id === event.target.value);
                        setOfferId(event.target.value);
                        setBudget(
                          profiles.find((profile) => profile.official_offer_id === selected?.id)
                            ?.official_match_budget ??
                            Math.max(100, selected?.pointsPerAction ?? 1),
                        );
                      }}
                    >
                      {offers.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}（官方 AI 优先）
                        </option>
                      ))}
                      <option value="">免费脚本 AI</option>
                    </select>
                  </label>
                  {offer && (
                    <>
                      <p className="muted">
                        AI 点数：可用 {wallet?.available ?? 0} 点（已预留 {wallet?.reserved ?? 0}{' '}
                        点）。
                        <br />
                        <OfficialAiPrice offer={offer} />
                      </p>
                      <label>
                        每席位单局 AI 点数上限
                        <input
                          name="matchBudget"
                          type="number"
                          min={offer.tokenPricing ? 1 : offer.pointsPerAction}
                          max={1000000}
                          step={1}
                          required
                          aria-describedby="computer-budget-help"
                          value={budget}
                          disabled={busy}
                          onChange={(event) => setBudget(Number(event.target.value))}
                        />
                      </label>
                      <p className="muted" id="computer-budget-help">
                        上限按席位分别累计，各电脑共享你的 AI 点数。开始时保存上限，也会更新此官方
                        AI 的其他进行中席位；有活跃席位时只能提高，不能降低。
                      </p>
                    </>
                  )}
                </>
              ) : null)}
            <label>
              总人数（含你）
              <select
                name="seatCount"
                disabled={busy || !!pending}
                value={selectedSeatCount}
                onChange={(event) => setSeatCount(Number(event.target.value))}
              >
                {Array.from(
                  { length: game.players.max - game.players.min + 1 },
                  (_, index) => game.players.min + index,
                ).map((count) => (
                  <option value={count} key={count}>
                    {count} 人 · {count - 1} 位电脑
                  </option>
                ))}
              </select>
            </label>
            {!pending && offers && (
              <section
                className="computer-ai-summary"
                aria-label="本局陪玩与预算"
                aria-live="polite"
              >
                <strong>
                  {selectedSeatCount - 1} 位电脑 · {offer ? `${offer.name}优先` : '免费脚本 AI'}
                </strong>
                {offer ? (
                  <>
                    <p>
                      {budgetValid
                        ? `每席位上限 ${budget} 点，${selectedSeatCount - 1} 位电脑合计上限 ${(selectedSeatCount - 1) * budget} 点。`
                        : '请填写 1–1,000,000 的整数点数上限。'}
                      这是消费上限，开局不会一次扣除；仅成功的官方 AI 行动按价格结算。
                    </p>
                    <p>
                      {(wallet?.available ?? 0) < minimumCallPoints
                        ? `当前可用点数不足 ${minimumCallPoints} 点，将先用免费脚本陪玩。`
                        : '点数或该席位剩余额度不足时，免费脚本会接续当前行动。'}
                      后续行动额度足够时再优先官方 AI；不会自动提高上限。
                    </p>
                    <small>
                      余额为读取时的快照，其他对局也会使用；不保证每个席位都能用满上限。桌游币不能支付
                      AI。
                    </small>
                  </>
                ) : (
                  <p>
                    {offers.length ? '已选择全程脚本陪玩。' : '官方 AI 尚未开放。'}
                    本局不使用官方模型，不扣 AI 点数。
                  </p>
                )}
              </section>
            )}
            {pending && (
              <section className="computer-ai-summary" aria-label="已保存的开局设置">
                <strong>
                  {selectedSeatCount - 1} 位电脑 ·{' '}
                  {pending.enrollment ? '官方 AI 优先' : '免费脚本 AI'}
                </strong>
                {pending.enrollment && (
                  <p>
                    每席位单局上限 {pending.enrollment.matchBudget} 点；额度不足时免费脚本接续。
                  </p>
                )}
                <p role="status">已保存本次开局进度。继续时会核对原请求，不会重复建房或开局。</p>
              </section>
            )}
            {error && (
              <p className="error-notice" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy || (!pending && !offers)} type="submit">
              {busy ? '正在准备棋桌…' : pending ? '继续本次开局' : '开始电脑对局'}
            </button>
            {pending?.roomId && <a href={`/rooms/${pending.roomId}`}>查看已创建的房间</a>}
          </form>
        )}
      </section>
    </div>
  );
}
