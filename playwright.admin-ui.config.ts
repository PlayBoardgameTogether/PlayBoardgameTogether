import { defineConfig } from '@playwright/test';
import preview from './playwright.developers.config.js';
export default defineConfig({
  ...preview,
  testMatch: ['admin-console-ui.spec.ts', 'admin-games-ui.spec.ts', 'admin-updates-ui.spec.ts'],
});
