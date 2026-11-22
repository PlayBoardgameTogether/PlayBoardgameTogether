import { useState } from 'react';
import { PageFeedback } from '@boardgame/ui';
import { clientTutorial } from '../game-registry.js';
import { gamePath, useGameCatalog, type AvailableGame } from './game-catalog.js';
import { gameDiscovery } from './game-discovery.js';
import { gameArt } from './catalog-art.js';
import { GameArtwork } from './GameArtwork.js';
import { PixelSearchIcon } from '../ui/PixelIcons.js';

export function GameAvatar({ game }: { game: AvailableGame }) {
  const art = gameArt(game);
  return (
    <GameArtwork
      src={art.iconUrl ?? art.coverUrl}
      className={art.iconUrl ? 'game-cover game-avatar' : 'game-cover game-avatar game-avatar--cover'}
      name={game.name}
    />
  );
}

const STAGE_TONES = ['emerald', 'cobalt', 'amber', 'rose', 'violet'] as const;

function stageTone(gameId: string, index: number): (typeof STAGE_TONES)[number] {
  if (gameId.includes('azul')) return 'cobalt';
  if (gameId.includes('catan')) return 'amber';
  if (gameId.includes('uno')) return 'rose';
  if (gameId.includes('puerto') || gameId.includes('grid')) return 'violet';
  if (gameId.includes('splendor') || gameId.includes('color')) return 'emerald';
  return STAGE_TONES[index % STAGE_TONES.length]!;
}

export function GameCatalog() {
  const { games, error, retry } = useGameCatalog();
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<'all' | 'two' | 'group'>('all');
  const [practiceOnly, setPracticeOnly] = useState(false);
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null);
  if (error)
    return (
      <PageFeedback title="游戏加载失败" retry={retry}>
        {error}
      </PageFeedback>
    );
  if (!games) return <PageFeedback title="正在加载游戏…" loading />;
  const defaultFeatured =
    games.find((game) => game.id === 'color-match' && clientTutorial(game.id, game.version)) ??
    games.find((game) => clientTutorial(game.id, game.version)) ??
    games[0];
  const spotlightCandidates = games.slice(0, 6);
  const featured =
    (spotlightKey
      ? games.find((game) => `${game.id}@${game.version}` === spotlightKey)
      : undefined) ?? defaultFeatured;
  const featuredIndex = featured ? Math.max(0, games.indexOf(featured)) : 0;
  const featuredHasTutorial = featured ? !!clientTutorial(featured.id, featured.version) : false;
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
        <section
          className="discovery-spotlight"
          data-stage-tone={stageTone(featured.id, featuredIndex)}
          aria-label="先试一手"
        >
          <div className="discovery-spotlight-copy">
            <p className="eyebrow">
              {featuredHasTutorial ? '免登录单人练习' : `${featured.players.min}–${featured.players.max} 人桌游`}
            </p>
            <h2>来一局 {featured.name}</h2>
            <p>{gameDiscovery(featured)?.invitation ?? featured.description ?? `从 ${featured.name} 的第一手开始。`}</p>
            <div className="discovery-spotlight-actions">
              {featuredHasTutorial ? (
                <>
                  <a className="button-link" href={`${gamePath(featured)}/tutorial`}>
                    先试一手 <span aria-hidden="true">→</span>
                  </a>
                  <a href={gamePath(featured)}>查看 {featured.name} 房间</a>
                </>
              ) : (
                <>
                  <a className="button-link" href={gamePath(featured)}>
                    立即开桌 <span aria-hidden="true">→</span>
                  </a>
                  <a href={`${gamePath(featured)}/computer`}>对战电脑</a>
                </>
              )}
            </div>
            {spotlightCandidates.length > 1 && (
              <div className="c3-stage-switcher" role="group" aria-label="切换推荐桌游">
                {spotlightCandidates.map((item) => {
                  const key = `${item.id}@${item.version}`;
                  const active = `${featured.id}@${featured.version}` === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="secondary c3-stage-pill"
                      aria-pressed={active}
                      onClick={() => setSpotlightKey(key)}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            )}
            <small>{featuredHasTutorial ? '随时练手，不计入战绩' : '支持真人联机与 AI 补位'}</small>
          </div>
          <a
            className="discovery-spotlight-art"
            href={featuredHasTutorial ? `${gamePath(featured)}/tutorial` : gamePath(featured)}
            aria-label={featuredHasTutorial ? `试玩 ${featured.name}` : `进入 ${featured.name}`}
          >
            <img
              className="pixel-club-art"
              src="/platform-art/pixel-club.svg"
              alt=""
              width="640"
              height="400"
            />
            <div className="discovery-art-caption">
              <div className="pixel-featured-cover">
                <GameAvatar game={featured} />
              </div>
              <strong>{featured.name}</strong>
              <span>{featuredHasTutorial ? '从第一手开始，边玩边学' : `${featured.players.min}–${featured.players.max} 人 · 点击查看房间`}</span>
            </div>
          </a>
        </section>
      )}
      <div className="catalog-section-heading">
        <h2>全部游戏</h2>
        <p className="discovery-result-count" role="status" aria-live="polite">
          {games.length > 0 ? `${visible.length} 款游戏${practiceOnly ? ' · 可先试玩' : ''}` : ''}
        </p>
      </div>
      {!games.length && <p role="status">暂无可用游戏，请稍后重试。</p>}
      {!!games.length && (
        <div className="catalog-discovery">
          <label className="catalog-search">
            <PixelSearchIcon />
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
              <GameAvatar game={game} />
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
