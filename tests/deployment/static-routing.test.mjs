import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { after, before, test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const html = '<!doctype html><title>PlayBoard route fixture</title>';
let root;
let supervisor;
let port;

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

function get(path, method = 'GET') {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        accept({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('Fixture request timed out')));
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'playboard-static-routing-'));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'apps/api/dist'), { recursive: true });
  await mkdir(join(root, 'apps/web/dist/assets'), { recursive: true });
  for (const name of [
    'online-update.mjs',
    'update-command.mjs',
    'update-control.mjs',
    'update-backup.mjs',
  ]) {
    await cp(join(repository, 'scripts', name), join(root, 'scripts', name));
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '1.2.0' }));
  await writeFile(join(root, 'apps/web/dist/index.html'), html);
  await writeFile(join(root, 'apps/web/dist/assets/app.js'), 'window.routeFixture = true;');
  await writeFile(
    join(root, 'apps/web/dist/assets/icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await writeFile(join(root, 'outside.txt'), 'outside web root');
  // A local transport fixture exercises the actual supervisor, without a database,
  // production credentials, authentication claims, or GitHub update requests.
  await writeFile(
    join(root, 'apps/api/dist/main.js'),
    `
    import { createServer } from 'node:http';
    const server = createServer((req, res) => {
      res.writeHead(req.url === '/health/ready' ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ fixture: 'api', path: req.url, method: req.method }));
    });
    server.listen(Number(process.env.API_PORT), '127.0.0.1', () => process.send('update.ready'));
    process.on('message', message => {
      if (message === 'update.stop') server.close(() => process.disconnect());
    });
  `,
  );
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    });
  git(['init', '--initial-branch=main']);
  git([
    '-c',
    'user.name=Routing fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
  git([
    'remote',
    'add',
    'origin',
    'https://github.com/PlayBoardgameTogether/PlayBoardgameTogether.git',
  ]);
  const webPort = await reservePort();
  const apiPort = await reservePort();
  port = webPort.port;
  await Promise.all(
    [webPort.server, apiPort.server].map((server) => new Promise((done) => server.close(done))),
  );
  supervisor = spawn(process.execPath, ['scripts/online-update.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      UPDATE_ENABLED: 'false',
      UPDATE_BRANCH: 'main',
      UPDATE_HOST: '127.0.0.1',
      UPDATE_PORT: String(port),
      API_PORT: String(apiPort.port),
      UPDATE_STATE_DIR: join(root, 'state'),
      ASSET_STORAGE_DIR: join(root, 'private-assets'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Supervisor fixture startup timed out')),
      10000,
    );
    supervisor.stdout.on('data', (chunk) => {
      if (String(chunk).includes('serving port=')) {
        clearTimeout(timer);
        accept();
      }
    });
    supervisor.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    supervisor.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Supervisor exited: ${code}`));
    });
  });
});

after(async () => {
  if (supervisor && supervisor.exitCode === null) {
    const stopped = once(supervisor, 'exit');
    supervisor.kill('SIGTERM');
    await stopped;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test('versioned game pages return HTML on direct GET, refresh and HEAD', async () => {
  for (const path of [
    '/games/online.uno/1.2.0',
    '/games/online.uno-no-mercy/1.0.0',
    '/games/splendor.base/1.0.0',
    '/games/online.puerto-rico/1.1.1',
    '/games/online.uno/1.2.0?source=invite',
    '/games/online.uno/1.2.0/new',
    '/games/online.uno/1.2.0/computer',
    '/games/splendor.base/1.0.0/tutorial',
  ]) {
    for (const method of ['GET', 'GET', 'HEAD']) {
      const response = await get(path, method);
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.match(response.headers['content-type'], /^text\/html/);
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.body, method === 'HEAD' ? '' : html);
    }
  }
});

test('real assets retain their content type and immutable cache policy', async () => {
  const response = await get('/assets/app.js?v=1');
  assert.equal(response.status, 200);
  assert.equal(response.body, 'window.routeFixture = true;');
  assert.equal(response.headers['content-type'], 'text/javascript');
  assert.match(response.headers['cache-control'], /immutable/);
  assert.equal((await get('/assets/icon.svg')).headers['content-type'], 'image/svg+xml');
});

test('missing resources and malformed game versions never fall back to HTML', async () => {
  for (const path of [
    '/assets/missing.js',
    '/assets/missing.png',
    '/missing.css',
    '/missing.svg',
    '/games/online.uno/missing.js',
    '/games/online.uno/1.2.0/missing.png',
    '/games/online.uno/1.2.0.js',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.notEqual(response.body, html);
  }
  assert.equal((await get('/games/online.uno/1.2.0', 'POST')).status, 405);
});

test('decoded traversal, null bytes, backslashes and malformed escapes remain rejected', async () => {
  for (const path of ['/%2e%2e%2foutside.txt', '/%5coutside.txt', '/%00outside.txt', '/%zz']) {
    const response = await get(path);
    assert.equal(response.status, 400, path);
    assert.ok(!response.body.includes('outside web root'));
  }
});

test('API and health paths keep the proxy status and never serve the SPA', async () => {
  for (const path of [
    '/api/v1/private',
    '/api/v1/private.js',
    '/health/ready',
    '/health/missing.js',
  ]) {
    for (const method of ['GET', 'POST']) {
      const response = await get(path, method);
      assert.equal(response.status, path === '/health/ready' ? 200 : 401);
      assert.match(response.headers['content-type'], /^application\/json/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(response.body), { fixture: 'api', path, method });
    }
  }
});
