export type AdaptivePolling = ReturnType<typeof startAdaptivePolling>;

// A completed read schedules the next one: slow requests never overlap or leave
// interval ticks queued behind them. Explicit refreshes also reset idle backoff.
export function startAdaptivePolling(
  poll: () => Promise<boolean | undefined>,
  { maximum = 15000, visible = () => true }: { maximum?: number; visible?: () => boolean } = {},
) {
  const minimum = 5000;
  let delay = minimum;
  let timer: number | undefined;
  let running: Promise<void> | undefined;
  let queued = false;
  let disposed = false;
  const active = () => !disposed && visible() && document.visibilityState === 'visible';
  function clear() {
    window.clearTimeout(timer);
    timer = undefined;
  }
  function run(explicit: boolean): Promise<void> {
    clear();
    if (explicit) delay = minimum;
    if (!active()) return Promise.resolve();
    if (running) {
      queued ||= explicit;
      return running;
    }
    let continuePolling = true;
    running = (async () => {
      do {
        queued = false;
        try {
          const changed = await poll();
          continuePolling = changed !== undefined;
          delay = changed ? minimum : Math.min(maximum, delay * 2);
        } catch {
          // A temporary failure retries at the normal cadence. The caller owns
          // its UI error and authority/session cleanup.
          delay = minimum;
        }
      } while (queued && active() && continuePolling);
    })().finally(() => {
      running = undefined;
      // A refresh can arrive in the microtask between the loop finishing and
      // this cleanup. Keep that refresh immediate and include it in the wait.
      if (queued && active() && continuePolling) return run(true);
      if (active() && continuePolling) timer = window.setTimeout(() => void run(false), delay);
    });
    return running;
  }
  const refresh = () => run(true);
  const resume = () => {
    if (active()) void refresh();
    else clear();
  };
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  void refresh();
  return {
    refresh,
    stop() {
      disposed = true;
      queued = false;
      clear();
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    },
  };
}
