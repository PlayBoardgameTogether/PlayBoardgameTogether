import { viewSchema as azulViewSchema } from '@boardgame/azul/shared';
import { viewSchema as splendorViewSchema } from '@boardgame/splendor/shared';
import type { PlayerNames } from '@boardgame/game-sdk/presentation';
import type { ReactNode } from 'react';
import type { GameTutorial } from '@boardgame/game-sdk/tutorial';
import type { AssetResolverPort, PresentationAudioPort } from '@boardgame/game-sdk/assets';
import { PackageBoard } from './games/PackageBoard.js';
import { viewSchema as counterViewSchema } from '@boardgame/test-counter/shared';
import { viewSchema as colorViewSchema } from '@boardgame/color-match/shared';
import { viewSchema as gardenViewSchema } from '@boardgame/grid-garden/shared';

export type GameBoard = (view: unknown, busy: boolean, events: unknown[], onAction: (action: unknown) => void, assets?:AssetResolverPort, audio?: PresentationAudioPort, playerNames?: PlayerNames) => ReactNode;
export const clientGames = [
  {
    id: 'azul.base', version: '1.0.0', name: '花砖物语', defaultOptions: {}, finishBehavior: 'stay',
    boardAudio: true,
    load: async (): Promise<GameBoard> => {
      const { AzulBoard } = await import('@boardgame/azul/client');
      return (view, busy, events, onAction, _assets, audio, playerNames) => <AzulBoard view={azulViewSchema.parse(view)} busy={busy} events={events} onAction={onAction} audio={audio} playerNames={playerNames} />;
    },
  },
  {
    id: 'splendor.base', version: '1.0.0', name: '璀璨宝石', defaultOptions: {},
    load: async (): Promise<GameBoard> => {
      const { SplendorBoard } = await import('@boardgame/splendor/client');
      return (view, busy, events, onAction, assets, _audio, playerNames) => <SplendorBoard events={events} view={splendorViewSchema.parse(view)} busy={busy} onAction={onAction} assets={assets} playerNames={playerNames} />;
    },
  },
  {
    id: 'demo.counter-room', version: '1.0.0', name: '计数房间', defaultOptions: { targetScore: 3 },
    load: async (): Promise<GameBoard> => {
      return raw => {
        const view = counterViewSchema.parse(raw);
        return <section className="panel match-view"><h2>你的初始视图</h2>
          <div className="score-grid">{view.seats.map(seat => <div className="score" key={seat}>
            <span>{seat === view.viewingSeatId ? '我的座位' : '对手'}</span><strong>{view.scores[seat]}</strong>
          </div>)}</div>
          <p>你的私密提示：<strong>{view.myHint}</strong></p>
          <p className="lab-warning">计数房间仅用于正式身份验收，暂无玩法操作。</p>
        </section>;
      };
    },
  },
  {
    id: 'color-match', version: '1.0.0', name: 'Color Match', defaultOptions: {},
    load: async (): Promise<GameBoard> => {
      const { ColorBoard } = await import('@boardgame/color-match/client');
      return (view, busy, events, onAction, assets) => <ColorBoard view={colorViewSchema.parse(view)} busy={busy} events={events} onAction={onAction} assets={assets}/>;
    },
  },
  {
    id: 'grid-garden', version: '1.0.0', name: 'Grid Garden', defaultOptions: {},
    load: async (): Promise<GameBoard> => {
      const { GridGardenBoard } = await import('@boardgame/grid-garden/client');
      return (view, busy, events, onAction, assets) => <GridGardenBoard view={gardenViewSchema.parse(view)} busy={busy} onAction={onAction} assets={assets} events={events} />;
    },
  },
] as const;

export function clientGame(id: string, version: string) {
  return clientGames.find(game => game.id === id && game.version === version) ?? {
    id, version, name: id, defaultOptions: {}, finishBehavior: 'stay',
    preserveReplayDesktop: true,
    load: async (): Promise<GameBoard> => (view, busy, events, onAction) =>
      <PackageBoard id={id} version={version} view={view} busy={busy} events={events} onAction={onAction} />,
  };
}

// Optional, exact-version authoring. Games without an entry keep their existing rules page.
export const clientTutorials: Readonly<Record<string, () => Promise<GameTutorial>>> = {
  'azul.base@1.0.0': async () => {
    const { azulTutorial } = await import('@boardgame/azul/tutorial');
    return azulTutorial;
  },
  'splendor.base@1.0.0': async () => {
    const { splendorTutorial } = await import('@boardgame/splendor/tutorial');
    return splendorTutorial;
  },
  'color-match@1.0.0': async () => {
    const { colorMatchTutorial } = await import('@boardgame/color-match/client');
    return colorMatchTutorial;
  },
};

export function clientTutorial(id: string, version: string) {
  return clientTutorials[`${id}@${version}`];
}

export const assetPreviews:Record<string,()=>Promise<(assets:AssetResolverPort)=>ReactNode>>={
  'splendor.base':async()=>{const {SplendorAssetPreview}=await import('@boardgame/splendor/client');return assets=><SplendorAssetPreview assets={assets}/>;},
  'color-match':async()=>{const {ColorAssetPreview}=await import('@boardgame/color-match/client');return assets=><ColorAssetPreview assets={assets}/>;},
  'grid-garden':async()=>{const {GridGardenAssetPreview}=await import('@boardgame/grid-garden/client');return assets=><GridGardenAssetPreview assets={assets}/>;},
};
