// Shared by room and match transport; never cache a completed authority read.
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= operation().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

export function reconnectBackoff(maximum = 15000) {
  let ceiling = 1000;
  return {
    next() {
      const delay = Math.floor(ceiling * (0.5 + Math.random() * 0.5));
      ceiling = Math.min(ceiling * 2, maximum);
      return delay;
    },
    reset() {
      ceiling = 1000;
    },
  };
}
