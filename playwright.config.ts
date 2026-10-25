import { defineConfig } from '@playwright/test';
import { base, browserProjects } from './tests/config/shared.js';

process.loadEnvFile('.env');

// Real HTTP/WS flows use the isolated database preparation in pnpm test:e2e.
export default defineConfig(base, {
  globalSetup: './tests/e2e/setup.ts',
  use: { baseURL: 'http://127.0.0.1:5273' },
  projects: browserProjects(),
});
