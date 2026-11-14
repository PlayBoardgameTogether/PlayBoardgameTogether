import { defineConfig } from 'vitest/config';

// This opt-in suite requires real candidate and legacy ZIPs from the game repository.
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/integration/uno-public-results.compat.ts'],
  },
});
