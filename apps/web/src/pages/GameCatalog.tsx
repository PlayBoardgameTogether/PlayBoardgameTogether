import { useState } from 'react';
import { PageFeedback } from '@boardgame/ui';
import { clientTutorial } from '../game-registry.js';
import { gamePath, useGameCatalog, type AvailableGame } from './game-catalog.js';
import { gameDiscovery } from './game-discovery.js';
import { gameArt } from './catalog-art.js';
import { GameArtwork } from './GameArtwork.js';

export function GameCover({ game }: { game: AvailableGame }) {
  return <GameArtwork src={gameArt(game).coverUrl} className="game-cover" name={game.name} />;
}

export function GameCatalog() {
  const { games, error, retry } = useGameCatalog();
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<'all' | 'two' | 'group'>('all');
  const [practiceOnly, setPracticeOnly] = useState(false);
  if (error)
    return (
      <PageFeedback title="游戏加载失败" retry={retry}>
        {error}
      </PageFeedback>
    );
  if (!games) return <PageFeedback title="正在加载游戏…" loading />;
  const featured =
    games.find((game) => game.id === 'color-match' && clientTutorial(game.id, game.version)) ??
    games.find((game) => clientTutorial(game.id, game.version));
  const visible = games.filter((game) => {
    const text =
      `${game.name} ${game.description} ${gameDiscovery(game)?.firstMove ?? ''}`.toLocaleLowerCase();
    return (
      text.includes(search.trim().toLocaleLowerCase()) &&
      (players === 'all' ||
        (players === 'two'
          ? game.players.min <= 2 && game.players.max >= 2
          : game.players.max >= 3)) &&
      (!practiceOnly || !!clientTutorial(game.id, game.version))
    );
  });
  return (
    <section className="game-catalog discovery-catalog" aria-label="选择游戏">
      {featured && (
        <section className="discovery-spotlight" aria-label="先试一手">
          <div className="discovery-spotlight-copy">
            <p className="eyebrow">免登录单人练习</p>
            <h2>{gameDiscovery(featured)?.invitation ?? `从 ${featured.name} 的第一手开始。`}</h2>
            <p>{gameDiscovery(featured)?.hook ?? featured.description}</p>
            <div className="discovery-spotlight-actions">
              <a className="button-link" href={`${gamePath(featured)}/tutorial`}>
                先试一手 <span aria-hidden="true">→</span>
              </a>
              <a href={gamePath(featured)}>查看 {featured.name} 房间</a>
            </div>
            <small>随时练手，不计入战绩</small>
          </div>
          <a
            className="discovery-spotlight-art"
            href={`${gamePath(featured)}/tutorial`}
            aria-label={`试玩 ${featured.name}`}
          >
            <GameCover game={featured} />
            <span className="discovery-art-caption">
              <strong>{featured.name}</strong>
              <span>
                动手试试，看看合不合拍 <span aria-hidden="true">↗</span>
              </span>
            </span>
          </a>
        </section>
      )}
      <div className="catalog-section-heading">
        <div>
          <p className="eyebrow">精选桌游</p>
          <h2>全部游戏</h2>
        </div>
        <span>{games.length} 款可玩</span>
      </div>
      {!games.length && <p role="status">暂无可用游戏，请稍后重试。</p>}
      {!!games.length && (
        <div className="catalog-discovery">
          <label className="catalog-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
            <span className="visually-hidden">搜索游戏</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="今天想玩什么？"
            />
          </label>
          <div className="catalog-filters" role="group" aria-label="按游玩人数筛选">
            {(
              [
                ['all', '全部游戏'],
                ['two', '双人对战'],
                ['group', '多人聚会'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                className="secondary"
                key={value}
                aria-pressed={players === value && (value !== 'all' || !practiceOnly)}
                onClick={() => {
                  setPlayers(value);
                  if (value === 'all') setPracticeOnly(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="secondary"
              aria-pressed={practiceOnly}
              onClick={() => setPracticeOnly((value) => !value)}
            >
              可先试玩
            </button>
          </div>
        </div>
      )}
      <p className="discovery-result-count" role="status" aria-live="polite">
        {games.length > 0
          ? `共找到 ${visible.length} 款游戏${practiceOnly ? '（可先试玩）' : ''}`
          : ''}
      </p>
      {!!games.length && !visible.length && (
        <div className="discovery-empty">
          <h3>还没找到合适的游戏</h3>
          <p className="muted">换个关键词或筛选条件试试吧。</p>
          <button
            className="secondary"
            onClick={() => {
              setSearch('');
              setPlayers('all');
              setPracticeOnly(false);
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      <div className="game-catalog-grid">
        {visible.map((game) => (
          <a
            className="game-card"
            href={gamePath(game)}
            key={`${game.id}@${game.version}`}
            aria-label={`查看 ${game.name}`}
          >
            <div className="discovery-card-art">
              <GameCover game={game} />
              {clientTutorial(game.id, game.version) && (
                <span className="discovery-practice-tag">可练习</span>
              )}
            </div>
            <div className="game-card-info">
              <div className="game-card-heading">
                <GameArtwork
                  src={gameArt(game).iconUrl}
                  className="game-card-icon"
                  name={game.name}
                />
                <h3>{game.name}</h3>
              </div>
              <p className="game-card-desc">{gameDiscovery(game)?.firstMove ?? game.description}</p>
              <div className="game-card-footer">
                <span className="game-card-players">
                  {game.players.min}–{game.players.max} 人
                </span>
                <span className="game-card-action">
                  查看房间{' '}
                  <span className="game-card-arrow" aria-hidden="true">
                    →
                  </span>
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
