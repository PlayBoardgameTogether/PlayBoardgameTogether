import { defineConfig } from '@playwright/test';
import { packageProjects, webConfig } from './shared.js';

// The replay case mounts ReplayPage through Vite; standalone board cases share its viewport matrix.
export default defineConfig({
  ...webConfig('rummikub-package-ui.spec.ts', 5380, 'dev'),
  projects: packageProjects,
});
