import { fileURLToPath } from 'node:url';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

// Resolve paths from this file so configs never depend on their directory or shell cwd.
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const base = defineConfig({
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  outputDir: fileURLToPath(new URL('../../test-results/', import.meta.url)),
  workers: 1,
  use: { trace: 'retain-on-failure' },
});

export function desktop(name: string, width: number, height: number) {
  return { name, use: { viewport: { width, height } } };
}

export function mobile(name: string, width: number, height: number) {
  return { name, use: { viewport: { width, height }, isMobile: true, hasTouch: true } };
}

export function browserProjects(mobileWidth = 390) {
  return [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: mobileWidth, height: 844 } },
    },
  ];
}

export const packageProjects = [
  desktop('desktop', 1440, 950),
  desktop('laptop', 1280, 720),
  mobile('mobile', 390, 844),
  mobile('small-mobile', 320, 740),
];

// UI-only configs deliberately have no env-file loading or database globalSetup.
export function webConfig(
  testMatch: NonNullable<PlaywrightTestConfig['testMatch']>,
  port: number,
  mode: 'preview' | 'dev' = 'preview',
  mobileWidth = 390,
) {
  const origin = `http://127.0.0.1:${port}`;
  return defineConfig(base, {
    testMatch,
    use: { baseURL: origin },
    projects: browserProjects(mobileWidth),
    webServer: {
      command: `pnpm --filter @boardgame/web exec vite ${mode === 'preview' ? 'preview ' : ''}--host 127.0.0.1 --port ${port} --strictPort`,
      cwd: repositoryRoot,
      url: origin,
      reuseExistingServer: false,
    },
  });
}
