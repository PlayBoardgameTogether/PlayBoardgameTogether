import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAdaptivePolling } from '../../apps/web/src/network/polling.js';

let document: EventTarget & { visibilityState: string };
let window: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('backs idle overview reads off to 15 seconds and immediately refreshes after focus', async () => {
  const read = vi.fn().mockResolvedValue(false).mockResolvedValueOnce(true);
  const polling = startAdaptivePolling(read);
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(6); // 0, 5, 15, 30, 45, 60 seconds.
  read.mockResolvedValueOnce(true);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(8);
  polling.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('limits idle chat delay to 10 seconds and pauses hidden pages until visible again', async () => {
  const read = vi.fn().mockResolvedValue(false);
  const polling = startAdaptivePolling(read, { maximum: 10000 });
  await vi.advanceTimersByTimeAsync(30000);
  expect(read).toHaveBeenCalledTimes(4);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(4);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(5);
  polling.stop();
});

it('coalesces a focus burst into one pending refresh without overlapping reads', async () => {
  const release = Promise.withResolvers<boolean>();
  const read = vi.fn().mockResolvedValue(false).mockReturnValueOnce(release.promise);
  const polling = startAdaptivePolling(read);
  for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(30000);
  expect(read).toHaveBeenCalledTimes(1);
  release.resolve(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  polling.stop();
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(2);
});

it('retries errors at the normal interval and does not resume a disposed in-flight poll', async () => {
  const release = Promise.withResolvers<boolean>();
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValue(release.promise);
  const polling = startAdaptivePolling(read);
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(2);
  polling.stop();
  release.resolve(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a refresh arriving between completion and scheduler cleanup', async () => {
  const release = Promise.withResolvers<boolean>();
  const read = vi.fn().mockResolvedValue(false).mockReturnValueOnce(release.promise);
  const polling = startAdaptivePolling(read);
  release.resolve(false);
  queueMicrotask(() => void polling.refresh());
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  polling.stop();
  expect(vi.getTimerCount()).toBe(0);
});
