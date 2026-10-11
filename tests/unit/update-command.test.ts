import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRelease, runUpdateCommand } from '../../scripts/update-command.mjs';

describe('online update production build', () => {
  it('installs build tools even with production-only deployment configuration', async () => {
    const path = await mkdtemp(join(tmpdir(), 'boardgame-update-build-'));
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('boardgame-update-build-')) throw new Error('Unexpected cleanup target');
    const pnpm = process.env.npm_execpath || (process.env.PATH || '').split(delimiter)
      .flatMap(path => ['pnpm.mjs', 'pnpm.cjs'].map(name => join(path, 'node_modules/pnpm/bin', name))).find(path => existsSync(path));
    const env = { ...process.env, NODE_ENV: 'production', UPDATE_PNPM_CLI: pnpm };
    try {
      expect(pnpm).toMatch(/pnpm/i);
      await writeFile(join(path, 'pnpm-workspace.yaml'), 'production: true\nenableGlobalVirtualStore: false\npackageImportMethod: copy\nstoreDir: ./store\nnodeLinker: hoisted\n');
      await mkdir(join(path, 'build-tool'));
      await writeFile(join(path, 'build-tool/package.json'), JSON.stringify({ name: 'fixture-build-tool', version: '1.0.0', main: 'index.js' }));
      await writeFile(join(path, 'build-tool/index.js'), 'module.exports = true;');
      await writeFile(join(path, 'package.json'), JSON.stringify({
        name: 'update-fixture', private: true, scripts: { build: 'node -e "require(\'fixture-build-tool\')"' },
        devDependencies: { 'fixture-build-tool': 'file:./build-tool' },
      }));
      await promisify(execFile)(process.execPath, [pnpm!, 'install', '--lockfile-only', '--prod=false', '--ignore-scripts'], { cwd: path, env })
        .catch(error => { throw new Error(`Fixture lockfile: ${error.stdout}`); });
      await buildRelease((executable: string, args: string[], cwd: string) => runUpdateCommand(executable, args, { cwd, env, timeout: 30000 }), path);
      await access(join(path, 'node_modules/fixture-build-tool/index.js'));
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }, 60000);

  it('classifies stderr without returning secrets or command arguments', async () => {
    const result = runUpdateCommand(process.execPath, ['-e', 'process.stderr.write("ENOSPC password=secret");process.exit(1)'], { cwd: process.cwd(), env: process.env });
    await expect(result).rejects.toMatchObject({ reason: 'disk_full', exitCode: 1 });
    await result.catch((error: Error) => expect(JSON.stringify(error) + error.message).not.toContain('secret'));
  });

  it('reports and terminates timed out commands', async () => {
    await expect(runUpdateCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(), env: process.env, timeout: 200,
    })).rejects.toMatchObject({ reason: 'timeout' });
  }, 15000);
  it.each([
    ['Applied migration changed: 015_game_presentations.sql', 'migration_changed'],
    ['error TS2307: Cannot find module xyz', 'build_tool_missing'],
    ['error TS2322: Type string is not assignable', 'compilation'],
    ['fatal: Authentication failed', 'authentication'],
    ['fatal: Could not resolve host: github.com', 'network'],
  ])('classifies %s at the real process boundary', async (message, reason) => {
    await expect(runUpdateCommand(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(message)});process.exit(1)`], {
      cwd: process.cwd(), env: process.env,
    })).rejects.toMatchObject({ reason, exitCode: 1 });
  });
});
