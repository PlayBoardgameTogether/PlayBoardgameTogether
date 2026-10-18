import { PageFeedback } from '@boardgame/ui';
import { clientTutorial } from '../game-registry.js';
import { GameArtwork } from './GameArtwork.js';
import { gameArt } from './catalog-art.js';
import { gameDiscovery } from './game-discovery.js';
import { GameRules } from './GameRules.js';
import { Lobby } from './Lobby.js';
import { RoomInviteForm } from './RoomInviteForm.js';
import { gamePath, useGameCatalog } from './game-catalog.js';

export function GameDetailPage({ id, version }: { id: string; version: string }) {
  const { games, error, retry } = useGameCatalog();
  if (error)
    return (
      <PageFeedback title="游戏加载失败" retry={retry}>
        {error}
      </PageFeedback>
    );
  if (!games) return <PageFeedback title="正在加载游戏…" loading />;
  const game = games.find((item) => item.id === id && item.version === version);
  if (!game)
    return (
      <PageFeedback title="游戏暂不可用">
        该游戏或版本未启用。<a href="/">返回游戏大厅</a>
      </PageFeedback>
    );
  const discovery = gameDiscovery(game);
  const tutorial = clientTutorial(id, version);
  return (
    <div className="game-room-page discovery-detail">
      <p>
        <a href="/">← 返回游戏大厅</a>
      </p>
      <section className="game-detail-banner">
        <GameArtwork
          src={gameArt(game).backgroundUrl}
          className="game-banner-background"
          name={game.name}
        />
        <div className="game-banner-content">
          <GameArtwork src={gameArt(game).iconUrl} className="game-detail-icon" name={game.name} />
          <div>
            <p className="eyebrow">
              {game.players.min}–{game.players.max} 人 · 在线桌游
            </p>
            <h1>{game.name}</h1>
            <p>{discovery?.hook ?? game.description}</p>
            <div className="discovery-detail-actions">
              <a className="button-link" href={`${gamePath(game)}/new`}>
                <span aria-hidden="true">＋</span> 创建房间
              </a>
              {tutorial && <a href={`${gamePath(game)}/tutorial`}>进入教程</a>}
            </div>
            <p className="discovery-detail-note">
              {tutorial
                ? '免登录即可体验单人练习，随时上手。'
                : '创建房间邀请好友，也可加入已有桌局。'}
            </p>
          </div>
        </div>
      </section>
      <section className="discovery-first-move" aria-label="玩法速览">
        <span className="eyebrow">第一手怎么玩</span>
        <p>{discovery?.firstMove ?? game.description}</p>
      </section>
      <section className="game-rooms-heading">
        <div>
          <h2>公开房间</h2>
          <p className="muted">找一张有空位的桌，和桌友一起玩。</p>
        </div>
      </section>
      <Lobby gameId={id} showHeading={false} />
      <div className="game-detail-support">
        <details className="game-invite-disclosure detail-support-card">
          <summary>
            <div className="detail-support-trigger">
              <span className="detail-support-icon detail-support-icon--invite" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 2l-2 2m-1-1l-3 3m2-2l-3 3m1-1l-2 2m0 0l-4-4a5.5 5.5 0 1 0-7.78 7.78l10.59 10.59a2 2 0 0 0 2.83 0l4.24-4.24a2 2 0 0 0 0-2.83L15 15" />
                </svg>
              </span>
              <div className="detail-support-meta">
                <span className="detail-support-title">使用邀请码加入私人房间</span>
                <span className="detail-support-desc">输入好友分享的邀请码快速入座</span>
              </div>
            </div>
            <span className="detail-support-chevron" aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </summary>
          <div className="detail-support-body">
            <RoomInviteForm embedded />
          </div>
        </details>
        <GameRules gameId={id} version={version} />
      </div>
    </div>
  );
}
