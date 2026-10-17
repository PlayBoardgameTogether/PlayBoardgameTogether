import { PageFeedback } from '@boardgame/ui';
import { useState } from 'react';
import { gamePath, useGameCatalog, type AvailableGame } from './game-catalog.js';
import { gameArt } from './catalog-art.js';
import { GameArtwork } from './GameArtwork.js';

export function GameCover({ game }: { game: AvailableGame }) {
  return <GameArtwork src={gameArt(game).coverUrl} className="game-cover" name={game.name} />;
}

export function GameCatalog() {
  const { games, error, retry } = useGameCatalog();
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<'all' | 'two' | 'group'>('all');
  if (error) return <PageFeedback title="游戏加载失败" retry={retry}>{error}</PageFeedback>;
  if (!games) return <PageFeedback title="正在加载游戏…" loading />;
  const search = query.trim().toLocaleLowerCase();
  const visibleGames = games.filter(game =>
    (!search || `${game.name} ${game.description}`.toLocaleLowerCase().includes(search)) &&
    (players === 'all' || (players === 'two'
      ? game.players.min <= 2 && game.players.max >= 2
      : game.players.max >= 3)),
  );
  return <section className="game-catalog" aria-label="选择游戏">
    <div className="catalog-discovery">
      <label className="catalog-search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <span className="visually-hidden">搜索游戏</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="今天想玩什么？" />
      </label>
      <div className="catalog-filters" role="group" aria-label="按游玩人数筛选">
        {([['all', '全部游戏'], ['two', '双人对战'], ['group', '多人聚会']] as const).map(([value, label]) =>
          <button type="button" className="secondary" key={value} aria-pressed={players === value} onClick={() => setPlayers(value)}>{label}</button>,
        )}
      </div>
    </div>
    <div className="catalog-section-heading"><h2>发现好游戏</h2><span role="status">{visibleGames.length} 款可玩</span></div>
    {!games.length && <p role="status">暂无可用游戏，请稍后再来。</p>}
    {!!games.length && !visibleGames.length && <div className="catalog-empty" role="status">
      <h3>还没找到合适的游戏</h3><p className="muted">换个关键词，或看看全部游戏。</p>
      <button className="secondary" onClick={() => { setQuery(''); setPlayers('all'); }}>清除筛选</button>
    </div>}
    <div className="game-catalog-grid">{visibleGames.map(game =>
      <a className="game-card" href={gamePath(game)} key={`${game.id}@${game.version}`} aria-label={`查看 ${game.name}`}>
        <GameCover game={game} />
        <div className="game-card-info">
          <div className="game-card-heading">
            <GameArtwork src={gameArt(game).iconUrl} className="game-card-icon" name={game.name} />
            <h3>{game.name}</h3>
          </div>
          <p className="game-card-desc">{game.description}</p>
          <div className="game-card-footer">
            <span className="game-card-players">{game.players.min}–{game.players.max} 人</span>
            <span className="game-card-action">查看房间 <span className="game-card-arrow" aria-hidden="true">→</span></span>
          </div>
        </div>
      </a>)}

    </div>
  </section>;
}
