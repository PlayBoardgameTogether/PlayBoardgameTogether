import { defineConfig } from '@playwright/test';
import { desktop, mobile, webConfig } from './shared.js';

// Production UI fixtures only: this entry never prepares or clears a database.
export default defineConfig(webConfig('computer-help-ui.spec.ts', 5374), {
  use: { screenshot: 'only-on-failure' },
  projects: [
    desktop('desktop', 1440, 900),
    desktop('laptop', 1280, 800),
    mobile('mobile', 390, 844),
    mobile('small-mobile', 320, 740),
  ],
});
