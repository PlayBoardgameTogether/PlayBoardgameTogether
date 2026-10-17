import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, command, navigate } from '../platform.js';
import { clientGame } from '../game-registry.js';
import { GameRules } from './GameRules.js';
import { loadGames, type AvailableGame } from './game-catalog.js';

export type { AvailableGame } from './game-catalog.js';

export function RoomCreateForm({
  defaultName = '新的游戏桌',
  selectedGame,
}: {
  defaultName?: string;
  selectedGame?: { id: string; version: string };
}) {
  const [games, setGames] = useState<AvailableGame[]>([]);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [optionsError, setOptionsError] = useState(false);
  const optionsPanel = useRef<HTMLDetailsElement>(null);
  const optionsInput = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    void loadGames()
      .then((items) => {
        if (disposed) return;
        const available = items.filter((item) => !item.developmentOnly);
        setGames(available);
        const first = selectedGame
          ? available.find(
              (item) => item.id === selectedGame.id && item.version === selectedGame.version,
            )
          : available[0];
        if (first) setChoice(`${first.id}@${first.version}`);
        else if (selectedGame) setError('所选游戏或版本已不可用，请返回大厅重新选择。');
      })
      .catch(() => {
        if (!disposed) setError('无法加载可用游戏，请重试。');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [attempt, selectedGame?.id, selectedGame?.version]);

  const game = games.find((item) => `${item.id}@${item.version}` === choice);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || busy) return;
    const fields = new FormData(event.currentTarget);
    let options: unknown;
    try {
      options = JSON.parse(String(fields.get('options')));
      setOptionsError(false);
    } catch {
      setError('游戏选项格式不正确，请填写有效的 JSON。');
      setOptionsError(true);
      if (optionsPanel.current) optionsPanel.current.open = true;
      optionsInput.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const password = String(fields.get('password') ?? '');
      const result = await api.createConfiguredRoom({
        requestId: command(),
        name: String(fields.get('name')).trim(),
        gameId: game.id,
        version: game.version,
        seatCount: Number(fields.get('seatCount')),
        options,
        visibility: fields.get('visibility') === 'public' ? 'public' : 'private',
        ...(password ? { password } : {}),
      });
      if (active.current) navigate(`/rooms/${result.roomId}`, { inviteCode: result.inviteCode });
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : '创建失败，请检查设置。');
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <>
      <form className="form-stack room-create-form" onSubmit={submit}>
        <fieldset className="room-create-fields form-stack" disabled={busy || loading}>
          <label>
            房间名
            <input
              name="name"
              defaultValue={defaultName}
              maxLength={40}
              required
              placeholder="例如：周末欢乐桌"
            />
          </label>

          <label>
            游戏与版本
            <select
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value);
                setOptionsError(false);
                setError('');
              }}
            >
              {games.map((item) => (
                <option key={`${item.id}@${item.version}`} value={`${item.id}@${item.version}`}>
                  {item.name} · {item.version}
                </option>
              ))}
            </select>
          </label>
          {game && <p className="muted game-form-desc">{game.description}</p>}

          <label>
            人数
            <input
              name="seatCount"
              type="number"
              min={game?.players.min ?? 2}
              max={game?.players.max ?? 2}
              defaultValue={game?.players.min ?? 2}
              key={choice}
              required
            />
          </label>

          <label>
            房间类型
            <select name="visibility" defaultValue="public">
              <option value="public">公开房间（展示在大厅）</option>
              <option value="private">私人邀请房间（不展示在大厅）</option>
            </select>
          </label>

          <label>
            房间密码（选填）
            <input name="password" type="password" autoComplete="new-password" maxLength={128} />
          </label>
          <p className="muted">
            设置密码后，大厅和邀请码加入都需要密码。每人最多创建一个未关闭房间。
          </p>

          <details className="room-disclosure room-advanced" ref={optionsPanel}>
            <summary>高级设置</summary>
            <p className="muted">默认规则即可开局；仅在需要自定义规则时修改。</p>
            <label>
              游戏选项（JSON）
              <textarea
                name="options"
                ref={optionsInput}
                aria-invalid={optionsError || undefined}
                aria-describedby={optionsError ? 'room-create-error' : undefined}
                onChange={() => {
                  if (optionsError) {
                    setOptionsError(false);
                    setError('');
                  }
                }}
                rows={2}
                key={`${choice}-options`}
                defaultValue={JSON.stringify(
                  (game && clientGame(game.id, game.version)?.defaultOptions) ?? {},
                )}
              />
            </label>
          </details>
        </fieldset>

        {error && (
          <p className="error-notice" id="room-create-error" role="alert">
            {error}
          </p>
        )}
        {loading && <p role="status">正在加载可用游戏…</p>}
        {!loading && !games.length && <p role="status">暂无可用游戏，请联系管理员安装游戏扩展。</p>}
        {!loading && error && !games.length && (
          <button
            type="button"
            className="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新加载游戏
          </button>
        )}

        <button type="submit" disabled={busy || !game}>
          {busy ? '创建中…' : '创建并生成邀请码'}
        </button>
      </form>
      {game && <GameRules gameId={game.id} version={game.version} />}
    </>
  );
}
