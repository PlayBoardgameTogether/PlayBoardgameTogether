import { defineConfig } from '@playwright/test';
import publicPreview from './playwright.developers.config.js';

// These production-shell checks do not provision or clear a database.
export default defineConfig({
  ...publicPreview,
  testMatch: ['developers.spec.ts', 'navigation-menu.spec.ts', 'platform-shell.spec.ts', 'theme.spec.ts', 'mobile-discovery.spec.ts'],
});
