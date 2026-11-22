import { defineConfig } from 'vitest/config';

// Explicit opt-in: the normal integration suite does not run the load baseline.
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/integration/performance-baseline.perf.ts'],
  },
});
