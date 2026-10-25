import { defineConfig } from '@playwright/test';
import { base, desktop, mobile } from './shared.js';

export default defineConfig(base, {
  testMatch: 'gomoku-package-ui.spec.ts',
  projects: [
    desktop('desktop', 1100, 950),
    desktop('short-desktop', 1440, 720),
    mobile('mobile', 320, 740),
  ],
});
