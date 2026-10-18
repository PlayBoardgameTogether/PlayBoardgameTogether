// Shared by room and match transport; share only an in-flight authority read.
export function singleFlight<T, Args extends unknown[]>(
  operation: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  let pending: Promise<T> | undefined;
  return (...args) => {
    pending ??= operation(...args).finally(() => {
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
