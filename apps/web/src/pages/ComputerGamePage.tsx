import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError } from '@boardgame/client-sdk';
import { createRoomInputSchema } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api, command, navigate } from '../platform.js';
import { clientGame } from '../game-registry.js';
import { gamePath, useGameCatalog } from './game-catalog.js';

const pendingSchema = z
  .object({
    accountId: z.string().uuid(),
    create: createRoomInputSchema,
    readyId: z.string(),
    startId: z.string(),
    roomId: z.string().uuid().optional(),
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
  const mounted = useRef(false);
  const lock = useRef(false);
  const key = `boardgame:computer-game:${id}@${version}`;
  const game = games?.find((item) => item.id === id && item.version === version);

  useEffect(() => {
    mounted.current = true;
    void api
      .me()
      .then((me) => {
        if (!mounted.current) return;
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
      })
      .catch((cause) => {
        if (mounted.current)
          setAuthError(
            cause instanceof ApiError && cause.code === 'UNAUTHENTICATED'
              ? '登录后即可和电脑开一局。'
              : '暂时无法验证登录状态，请刷新重试。',
          );
      });
    return () => {
      mounted.current = false;
    };
  }, [id, version, key]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || !accountId || lock.current) return;
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
      });
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      // Persist before sending; refresh and retries reuse every command's exact identity/body.
      sessionStorage.setItem(key, JSON.stringify(operation));
      setPending(operation);
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
        <p className="muted">
          你坐第一席，其余席位由免费脚本 AI 陪玩。使用默认规则，不消耗 AI 点数。
        </p>
        <p className="muted">这是完整正式对局，会计入对局记录；每人最多同时主持一个房间。</p>
        {authError ? (
          <PageFeedback title="需要确认登录状态">
            {authError} <a href="/login">前往登录</a>
          </PageFeedback>
        ) : !accountId ? (
          <p role="status">正在验证会话…</p>
        ) : (
          <form className="form-stack" onSubmit={(event) => void start(event)}>
            <label>
              总人数（含你）
              <select
                name="seatCount"
                disabled={busy || !!pending}
                defaultValue={pending?.create.seatCount ?? game.players.min}
                key={pending?.create.seatCount ?? 'new'}
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
            {pending && (
              <p role="status">已保存本次开局进度。继续时会核对原请求，不会重复建房或开局。</p>
            )}
            {error && (
              <p className="error-notice" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} type="submit">
              {busy ? '正在准备棋桌…' : pending ? '继续本次开局' : '开始电脑对局'}
            </button>
            {pending?.roomId && <a href={`/rooms/${pending.roomId}`}>查看已创建的房间</a>}
          </form>
        )}
      </section>
    </div>
  );
}
