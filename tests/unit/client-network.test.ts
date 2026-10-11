import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../../packages/client-sdk/src/index.js';
import { sessionFixture } from '../fixtures/session.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stalledFetch(body = false) {
  return vi.fn((_url: string, init: RequestInit) => {
    const wait = () =>
      new Promise<never>((_resolve, reject) => {
        if (init.signal?.aborted) reject(init.signal.reason);
        else
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    return body ? Promise.resolve({ status: 200, json: wait }) : wait();
  });
}

it.each([false, true])(
  'bounds session requests including a stalled response body (%s)',
  async (body) => {
    vi.useFakeTimers();
    const fetch = stalledFetch(body);
    vi.stubGlobal('fetch', fetch);
    const result = new ApiClient().me();
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('honors caller cancellation and removes its deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', stalledFetch());
  const controller = new AbortController();
  const result = new ApiClient().me(controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up cancellation listeners and timers after a successful request', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ ok: true, data: sessionFixture(), traceId: 'test' })),
  );
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await expect(new ApiClient().me(controller.signal)).resolves.toEqual(sessionFixture());
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('allows bounded binary upload validation beyond the ordinary request deadline', async () => {
  vi.useFakeTimers();
  const fetch = stalledFetch();
  vi.stubGlobal('fetch', fetch);
  const result = new ApiClient().reviewGamePackage(new Blob(['fixture']));
  const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(90000);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a signal already cancelled before reading a room', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', stalledFetch());
  const controller = new AbortController();
  controller.abort();
  await expect(new ApiClient().room('test-room', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(vi.getTimerCount()).toBe(0);
});
