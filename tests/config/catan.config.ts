import { defineConfig } from '@playwright/test';
import { base, packageProjects } from './shared.js';

export default defineConfig(base, {
  testMatch: 'catan-package-ui.spec.ts',
  projects: packageProjects,
});
