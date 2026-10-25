import { webConfig } from './shared.js';

// Production-page fixtures share one preview server; select a file on the CLI for a subset.
export default webConfig(
  [
    'developers.spec.ts',
    'navigation-menu.spec.ts',
    'platform-shell.spec.ts',
    'theme.spec.ts',
    'mobile-discovery.spec.ts',
    'social-shell.spec.ts',
    'public-chat.spec.ts',
    'admin-console-ui.spec.ts',
    'admin-games-ui.spec.ts',
    'admin-updates-ui.spec.ts',
    'game-package-upload-ui.spec.ts',
  ],
  5374,
);
