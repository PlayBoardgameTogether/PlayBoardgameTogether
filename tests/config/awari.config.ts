import { defineConfig } from '@playwright/test';
import { base, desktop, mobile } from './shared.js';

export default defineConfig(base, {
  testMatch: 'awari-package-ui.spec.ts',
  projects: [
    desktop('desktop', 1440, 900),
    desktop('laptop', 1280, 720),
    mobile('mobile', 390, 844),
    mobile('narrow', 320, 640),
  ],
});
