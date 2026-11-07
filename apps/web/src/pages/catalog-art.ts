import type { AvailableGame } from './game-catalog.js';

// Presentation only: these defaults do not select rules, assets or game behavior.
const builtInArt: Record<string, string> = {
  'azul.base': 'azul',
  'color-match': 'color-match',
  'grid-garden': 'grid-garden',
  'splendor.base': 'splendor',
  'demo.counter-room': 'counter',
};

// Game-owned art is imported with its reviewed repository snapshot. Vite emits
// content-hashed URLs, so a new catalog illustration cannot replace a cached one.
const pixelAvatars: Partial<Record<string, string>> = {
  'color-match': new URL('../../../../games/color-match/art/icon.png', import.meta.url).href,
  'grid-garden': new URL('../../../../games/grid-garden/art/icon.png', import.meta.url).href,
  'splendor.base': new URL('../../../../games/splendor/art/icon.png', import.meta.url).href,
  'azul.base': new URL('../../../../games/azul/art/icon.png', import.meta.url).href,
};

const catalogArtRoot = '/game-art/catalog-20261107';

// Reviewed gallery art for the exact versions that predate the new artwork.
// Later online versions can ship their own icon and background with the package.
const galleryScenes: Record<string, string> = {
  'azul.base@1.0.0': 'azul',
  'color-match@1.0.0': 'color-match',
  'grid-garden@1.0.0': 'grid-garden',
  'splendor.base@1.0.0': 'splendor',
  'demo.counter-room@1.0.0': 'counter',
  'online.awari@1.0.0': 'awari',
  'online.catan@1.0.1': 'catan',
  'online.gomoku@1.0.3': 'gomoku',
  'online.puerto-rico@1.1.1': 'puerto-rico',
  'online.rummikub@1.0.3': 'rummikub',
  'online.uno@1.2.0': 'uno',
  'online.uno-no-mercy@1.0.0': 'uno-no-mercy',
};

const galleryAvatars = new Set([
  'counter',
  'awari',
  'catan',
  'gomoku',
  'rummikub',
  'uno',
  'uno-no-mercy',
]);

export function defaultGameArt(id: string, version: string) {
  const art = builtInArt[id];
  const gallery = galleryScenes[`${id}@${version}`];
  return {
    iconUrl:
      gallery && galleryAvatars.has(gallery)
        ? `${catalogArtRoot}/${gallery}-avatar.webp`
        : (pixelAvatars[id] ?? (art ? `/game-art/${art}-icon.svg` : null)),
    coverUrl: art ? `/game-art/${art}.svg` : null,
    backgroundUrl: gallery ? `${catalogArtRoot}/${gallery}-scene.webp` : art ? `/game-art/${art}.svg` : null,
  };
}

export function gameArt(game: AvailableGame) {
  const defaults = defaultGameArt(game.id, game.version);
  const { presentation } = game;
  // Revision zero is the package default. A saved presentation takes priority.
  if (!presentation?.revision && galleryScenes[`${game.id}@${game.version}`]) {
    return {
      iconUrl: defaults.iconUrl ?? presentation?.iconUrl ?? null,
      coverUrl: presentation?.coverUrl ?? defaults.coverUrl,
      backgroundUrl: defaults.backgroundUrl,
    };
  }
  return {
    iconUrl: presentation?.iconUrl ?? defaults.iconUrl,
    coverUrl: presentation?.coverUrl ?? defaults.coverUrl,
    backgroundUrl: presentation?.backgroundUrl ?? defaults.backgroundUrl,
  };
}
