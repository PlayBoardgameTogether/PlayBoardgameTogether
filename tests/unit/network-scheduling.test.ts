import { afterEach, expect, it, vi } from 'vitest';
import { reconnectBackoff, singleFlight } from '../../apps/web/src/network/scheduling.js';

afterEach(() => vi.restoreAllMocks());

it('shares an authority read in flight and reads again after completion', async () => {
  let finish!: (value: number) => void;
  const read = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const sync = singleFlight(read);
  const first = sync();
  const second = sync();
  expect(read).toHaveBeenCalledTimes(1);
  finish(2);
  expect(await Promise.all([first, second])).toEqual([2, 2]);
  const third = sync();
  expect(read).toHaveBeenCalledTimes(2);
  finish(3);
  expect(await third).toBe(3);
});

it('releases failed reads so a later request can recover', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(4);
  const sync = singleFlight(read);
  await expect(sync()).rejects.toThrow('offline');
  await expect(sync()).resolves.toBe(4);
});

it('backs off with jitter to a cap and resets only when explicitly acknowledged', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const retry = reconnectBackoff();
  expect(Array.from({ length: 7 }, () => retry.next())).toEqual([
    750, 1500, 3000, 6000, 11250, 11250, 11250,
  ]);
  retry.reset();
  expect(retry.next()).toBe(750);
});
