import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

// Explicit public-source allowlist. Never traverse the repository or publish API/game server files.
export const publicSdkFiles = [
  'packages/game-sdk/package.json',
  'packages/game-sdk/src/index.ts',
  'packages/game-sdk/src/assets.ts',
  'packages/game-sdk/src/multi-action.ts',
  'packages/game-sdk/src/tutorial.ts',
  'packages/game-sdk/src/presentation.ts',
  'packages/client-sdk/package.json',
  'packages/client-sdk/src/index.ts',
  'packages/client-sdk/src/assets.ts',
  'packages/protocol/package.json',
  'packages/protocol/src/index.ts',
  'packages/protocol/src/auth.ts',
  'packages/protocol/src/assets.ts',
  'packages/protocol/src/profile.ts',
  'packages/protocol/src/match-result.ts',
  'packages/protocol/src/badges.ts',
  'packages/protocol/src/official-ai.ts',
  'packages/protocol/src/coins.ts',
  'packages/protocol/src/social.ts',
  'packages/protocol/src/game-presentation.ts',
  'packages/protocol/src/game-submissions.ts',
  'packages/protocol/src/game-packages.ts',
  'packages/protocol/src/admin.ts',
] as const;
const guides = ['index', 'quickstart', 'game-sdk', 'client-sdk', 'api', 'realtime', 'add-game', 'game-packages', 'ai', 'online-update'];
const repository = new URL('../../', import.meta.url);

export async function developerResources() {
  const files = Object.fromEntries(await Promise.all(publicSdkFiles.map(async path => {
    const content = await readFile(new URL(path, repository), 'utf8');
    return [path, { sha256: createHash('sha256').update(content).digest('hex'), content }] as const;
  })));
  const resources = new Map<string, { content: string; type: string }>();
  resources.set('/developer-sdk/sdk-sources.json', {
    content: JSON.stringify({ formatVersion: 1, packages: ['@boardgame/game-sdk', '@boardgame/client-sdk', '@boardgame/protocol'], files }, null, 2),
    type: 'application/json; charset=utf-8',
  });
  for (const [path, file] of Object.entries(files)) {
    resources.set(`/developer-sdk/${path}`, { content: file.content, type: 'text/plain; charset=utf-8' });
  }
  const texts = await Promise.all(guides.map(async name => {
    const text = await readFile(new URL(`public/developer-docs/${name}.md`, import.meta.url), 'utf8');
    return `Source: /developer-docs/${name}.md\n\n${text.replace(/^\uFEFF/, '')}`;
  }));
  resources.set('/llms-full.txt', { content: texts.join('\n\n---\n\n'), type: 'text/plain; charset=utf-8' });
  return resources;
}

export function developerPublication(): Plugin {
  return {
    name: 'developer-publication',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!;
        const source = publicSdkFiles.some(file => path === `/developer-sdk/${file}`);
        if (path !== '/llms-full.txt' && path !== '/developer-sdk/sdk-sources.json' && !source) {
          next();
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          response.end();
          return;
        }
        void developerResources().then(resources => {
          const resource = resources.get(path)!;
          response.setHeader('Content-Type', resource.type);
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(request.method === 'HEAD' ? undefined : resource.content);
        }).catch(next);
      });
    },
    async generateBundle() {
      for (const [path, resource] of await developerResources()) {
        this.emitFile({ type: 'asset', fileName: path.slice(1), source: resource.content });
      }
    },
  };
}

