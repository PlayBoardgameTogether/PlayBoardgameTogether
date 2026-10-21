import { useEffect, useRef, useState } from 'react';
import type { AdminGame } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../../platform.js';
import { AdminLayout, adminError, useAdminRequestId } from './AdminLayout.js';
import { GamePackageUpload } from './GamePackageUpload.js';

function Games() {
  const requestId = useAdminRequestId();
  const [games, setGames] = useState<AdminGame[]>();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const gameButtons = useRef(new Map<string, HTMLButtonElement>());
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    if (selectedId) selectionHeading.current?.focus();
  }, [selectedId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setError('');
    setGames(undefined);
    void api
      .adminGames()
      .then((value) => {
        if (!disposed) setGames(value);
      })
      .catch((cause) => {
        if (!disposed) setError(adminError(cause));
      });
    return () => {
      disposed = true;
    };
  }, [attempt]);
  async function change(game: AdminGame) {
    if (lock.current) return;
    if (
      !window.confirm(
        game.enabled
          ? `下架「${game.name} ${game.version}」？新房间与等待房间将不能开局，进行中的对局继续。`
          : `上架「${game.name} ${game.version}」？此版本将可用于新建房间与开局。`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.setAdminGameStatus(game.id, game.version, {
        requestId: requestId([game.id, game.version, game.revision, !game.enabled]),
        expectedRevision: game.revision,
        enabled: !game.enabled,
      });
      if (!alive.current) return;
      setGames((previous) =>
        previous?.map((item) =>
          item.id === saved.id && item.version === saved.version ? saved : item,
        ),
      );
      setNotice(`${saved.name} ${saved.version}已${saved.enabled ? '上架' : '下架'}。`);
    } catch (cause) {
      if (alive.current) setError(adminError(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const grouped = new Map<string, [AdminGame, ...AdminGame[]]>();
  for (const game of games ?? []) {
    const versions = grouped.get(game.id);
    if (versions) versions.push(game);
    else grouped.set(game.id, [game]);
  }
  const selected = selectedId ? grouped.get(selectedId) : undefined;
  const visible = [...grouped.values()].filter(([game]) =>
    `${game.name} ${game.id}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <>
      <GamePackageUpload onInstalled={() => setAttempt((value) => value + 1)} />
      <div className="admin-actions admin-game-toolbar">
        {selectedId && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              const previousId = selectedId;
              setSelectedId(undefined);
              setError('');
              setNotice('');
              requestAnimationFrame(() => gameButtons.current.get(previousId)?.focus());
            }}
          >
            ← 返回游戏列表
          </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setAttempt((value) => value + 1)}
        >
          刷新游戏
        </button>
      </div>
      {!selectedId && (
        <label className="admin-filter">
          筛选游戏
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="名称或游戏 ID"
          />
        </label>
      )}
      {selected && (
        <header className="admin-game-heading">
          <h2 ref={selectionHeading} tabIndex={-1}>
            {selected[0].name}
          </h2>
          <p className="muted">
            {selectedId} · {selected.length} 个安装版本
          </p>
        </header>
      )}
      {selectedId && (
        <details className="admin-guidance">
          <summary>版本管理说明</summary>
          <p>
            下架隐藏大厅入口并阻止新建、开局；进行中的对局保留原规则与资源。重新上架后等待房间可继续开局。
          </p>
          <p>
            在线格式游戏包可从上方直接上传安装。普通源码项目由维护者审查、部署并同步；新版本使用新版本号，旧版本需继续保留以恢复已有对局。
          </p>
          <a href="/developers/add-game">查看游戏接入指南</a>
        </details>
      )}
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!games ? (
        !error && <PageFeedback title="正在加载游戏…" loading />
      ) : (
        <>
          {!selectedId ? (
            <ul className="admin-game-list" aria-label="选择游戏">
              {visible.map((versions) => (
                <li key={versions[0].id}>
                  <button
                    className="secondary admin-game-choice"
                    ref={(element) => {
                      if (element) gameButtons.current.set(versions[0].id, element);
                      else gameButtons.current.delete(versions[0].id);
                    }}
                    onClick={() => {
                      setSelectedId(versions[0].id);
                      setError('');
                      setNotice('');
                    }}
                  >
                    <span>
                      <strong>{versions[0].name}</strong>
                      <small>{versions[0].id}</small>
                    </span>
                    <span className="admin-game-meta">
                      <span
                        className="status-badge"
                        data-status={versions.some((game) => game.enabled) ? 'active' : 'disabled'}
                      >
                        {versions.some((game) => game.enabled) ? '已上架' : '已下架'}
                      </span>
                      <span className="muted">
                        {versions.length} 个版本 <span aria-hidden="true">→</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="admin-records" aria-label="游戏版本">
              {selected?.map((game) => (
                <article
                  className="panel admin-record"
                  key={`${game.id}@${game.version}`}
                  aria-label={`${game.name} ${game.version}`}
                >
                  <div>
                    <h2>
                      版本 <small>{game.version}</small>
                    </h2>
                    {game.developmentOnly && <p className="muted">仅开发环境</p>}
                    <p>{game.available ? '规则与资源已加载' : '规则或资源不可用，需检查部署'}</p>
                  </div>
                  <div className="admin-record-actions">
                    <span
                      className="status-badge"
                      data-status={game.enabled ? 'active' : 'disabled'}
                    >
                      {game.enabled ? '已上架' : '已下架'}
                    </span>
                    <button
                      className="secondary"
                      disabled={busy || (!game.enabled && !game.available)}
                      onClick={() => void change(game)}
                    >
                      {game.enabled ? '下架版本' : '上架版本'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!selectedId && visible.length === 0 && (
            <p>
              {games.length === 0
                ? '暂无安装游戏，可上传游戏 ZIP 或部署并同步游戏。'
                : '没有匹配的游戏，请尝试其他名称或游戏 ID。'}
            </p>
          )}
          {selectedId && !selected && <p>此游戏已不在安装列表中，请返回选择其他游戏。</p>}
        </>
      )}
    </>
  );
}
export function AdminGamesPage() {
  return (
    <AdminLayout
      path="/admin/catalog"
      title="游戏管理"
      description="先选择游戏，再查看和管理它的版本。"
    >
      <Games />
    </AdminLayout>
  );
}
