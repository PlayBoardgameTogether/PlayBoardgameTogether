import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../platform.js';
import type { GamePresentation } from '@boardgame/protocol';

const catalogSchema = z.array(z.object({
  id: z.string(), version: z.string(), name: z.string(), description: z.string(),
  players: z.object({ min: z.number().int(), max: z.number().int() }),
  developmentOnly: z.boolean(),
  supportsScriptAi: z.boolean().optional(),
}));
export type AvailableGame = z.infer<typeof catalogSchema>[number] & { presentation?: GamePresentation };
export const gamePath = (game: Pick<AvailableGame, 'id' | 'version'>) =>
  `/games/${encodeURIComponent(game.id)}/${encodeURIComponent(game.version)}`;

export async function loadGames() {
  const [raw, presentations] = await Promise.all([api.games<unknown>(), api.gamePresentations()]);
  return catalogSchema.parse(raw).filter(game => !game.developmentOnly).map(game => {
    const presentation = presentations.find(item => item.gameId === game.id && item.version === game.version);
    return { ...game, ...(presentation ? { presentation } : {}) };
  });
}

export function useGameCatalog() {
  const [games, setGames] = useState<AvailableGame[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setGames(undefined); setError('');
    void loadGames().then(items => { if (!disposed) setGames(items); })
      .catch(() => { if (!disposed) setError('无法加载游戏，请检查连接后重试。'); });
    return () => { disposed = true; };
  }, [attempt]);
  return { games, error, retry: () => setAttempt(value => value + 1) };
}
