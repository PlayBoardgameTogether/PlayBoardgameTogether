/** Public presentation metadata, separate from authoritative game state. */
export type PlayerNames = Readonly<Record<string, string>>;

/** Read-only historical presentation; never grants action or live audio access. */
export interface ReplayPresentation {
  id: number;
  animate: boolean;
  /** Reserve time for a developer-owned animation sequence (1–60000 ms). */
  hold: (durationMs: number) => void;
}

export function playerLabel(
  seatId: string, seats: readonly string[], viewingSeatId: string,
  names?: PlayerNames, fallback = '玩家',
): string {
  const name = names?.[seatId]?.trim();
  if (name) return name + (seatId === viewingSeatId ? '（你）' : '');
  return seatId === viewingSeatId ? '你' : `${fallback} ${seats.indexOf(seatId) + 1}`;
}
