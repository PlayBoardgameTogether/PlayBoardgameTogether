import { defineConfig } from '@playwright/test';
import { base, browserProjects } from './tests/config/shared.js';

process.loadEnvFile('.env');

// Keep external candidate ZIPs out of the self-contained default browser suite.
export default defineConfig(base, {
  globalSetup: './tests/e2e/setup.ts',
  testMatch: '**/uno-public-results.compat.ts',
  use: { baseURL: 'http://127.0.0.1:5273' },
  projects: browserProjects(),
});
