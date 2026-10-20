import { fork } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, mkdir, writeFile, stat, open, unlink, realpath, rename, readdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createUpdateControl, updateStatusForClient } from './update-control.mjs';
import { buildRelease, runUpdateCommand } from './update-command.mjs';
import { backupUpdate, migrationPolicy } from './update-backup.mjs';
const { fetch, AbortSignal } = globalThis;

export function githubRemote(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(value);
  if (!match) throw new Error('origin must be a credential-free GitHub repository URL');
  return `https://github.com/${match[1]}.git`;
}

export function safeStaticPath(root, url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  const target = resolve(root, pathname === '/' ? './index.html' : `.${pathname}`);
  return target.startsWith(resolve(root) + sep) ? target : null;
}

export async function ensureReleaseEnvironment(path) {
  // Existing maintenance scripts use --env-file=.env even when every setting is
  // inherited. Supply an empty ignored file; never copy secrets into releases.
  try { await writeFile(resolve(path, '.env'), '# Configuration inherited from update supervisor.\n', { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export async function releaseVersion(path) {
  try {
    const { version } = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}

export async function applyPrepared(deps, candidate) {
  if (!await deps.drain()) return false;
  const previous = deps.current();
  try {
    await deps.stop();
    await deps.backup(previous, candidate);
    await deps.prepareDatabase(candidate);
    await deps.start(candidate);
    await deps.persist(candidate);
    deps.activate(candidate);
    return true;
  } catch (error) {
    try {
      await deps.stop();
      await deps.start(previous);
    } catch {
      throw Object.assign(new Error('Previous API could not be restored'), { reason: 'recovery_failed' });
    }
    throw error;
  } finally { deps.resume(); }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function main() {
  const stateRoot = resolve(process.env.UPDATE_STATE_DIR || resolve(root, '.data/updates'));
  await mkdir(stateRoot, { recursive: true });
  const lockPath = resolve(stateRoot, 'supervisor.lock');
  // Exclusive file prevents two supervisors from switching the same installation.
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  let server;
  let child;
  let closed = false;
  let switching = false;
  let busy = false;
  let timer;
  let updates;
  const env = { ...process.env, NODE_ENV: 'production', ENABLE_DEV_LAB: 'false',
    API_HOST: '127.0.0.1', ASSET_STORAGE_DIR: resolve(process.env.ASSET_STORAGE_DIR || resolve(root, '.data/assets')) };
  const apiPort = Number(env.API_PORT || 3001);
  const port = Number(env.UPDATE_PORT || 8080);
  const interval = Number(env.UPDATE_INTERVAL_MS || 300000);
  if (![port, apiPort].every(n => Number.isInteger(n) && n > 0 && n <= 65535) || port === apiPort ||
      !Number.isInteger(interval) || interval < 10000) {
    await lock.close(); await unlink(lockPath); throw new Error('Invalid update port/interval configuration');
  }
  const log = (event, sha) => console.log(`[online-update] ${event}${sha ? ` ${sha.slice(0, 12)}` : ''}`);
  function command(executable, args, cwd = root, timeout = 600000) {
    return runUpdateCommand(executable, args, { cwd, env, timeout });
  }
  async function stop() {
    const target = child;
    if (!target || target.exitCode !== null || target.signalCode !== null) return;
    await new Promise(done => {
      const timeoutId = setTimeout(() => target.kill(), 30000);
      target.once('exit', () => { clearTimeout(timeoutId); done(); });
      if (target.connected) target.send('update.stop'); else target.kill();
    });
    if (child === target) child = undefined;
  }
  async function start(release) {
    await stat(resolve(release.path, 'apps/web/dist/index.html'));
    child = fork(resolve(release.path, 'apps/api/dist/main.js'), [], {
      cwd: release.path, env: { ...env, BOARDGAME_UPDATE_SUPERVISED: 'true' },
      execArgv: ['--conditions=production'], windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const target = child;
    let listening = false;
    target.on('message', message => { if (message === 'update.ready') listening = true; });
    target.on('message', message => {
      if (target !== child || !updates || message?.type !== 'update.control' ||
          typeof message.id !== 'string' || !['status', 'check'].includes(message.action)) return;
      if (message.action === 'check' && (typeof message.requestId !== 'string' ||
          !/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(message.requestId))) return;
      const status = message.action === 'check'
        ? updates.check(message.requestId) : updates.snapshot();
      if (target.connected) target.send({ type: 'update.control.result', id: message.id,
        status: updateStatusForClient(status, message.statusVersion) }, () => {});
    });
    target.on('error', () => { log('API process error'); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (target.exitCode !== null || target.signalCode !== null) throw Object.assign(new Error('API exited during startup'), { reason: 'readiness' });
      try {
        const result = await fetch(`http://127.0.0.1:${apiPort}/health/ready`, { signal: AbortSignal.timeout(1000) });
        if (listening && result.ok) return;
      } catch { /* Wait for this child to bind and report database readiness. */ }
      await delay(300);
    }
    throw Object.assign(new Error('API readiness timeout'), { reason: 'readiness' });
  }
  async function drain() {
    if (!child?.connected) throw new Error('API update channel unavailable');
    switching = true;
    const target = child;
    const idle = await new Promise(done => {
      const timeoutId = setTimeout(() => finish(false), 35000);
      const listener = message => {
        if (message?.type === 'update.drained') finish(message.idle === true);
      };
      function finish(value) { clearTimeout(timeoutId); target.off('message', listener); done(value); }
      target.on('message', listener);
      target.send('update.drain', error => { if (error) finish(false); });
    });
    if (!idle) {
      switching = false;
      if (target.connected) target.send('update.resume');
      throw Object.assign(new Error('In-flight requests did not drain within the update deadline'), { reason: 'drain_timeout' });
    }
    return idle;
  }
  const statePath = resolve(stateRoot, 'current.json');
  let current;
  let pending;
  let blockedSha;
  const oldRoots = [];
  try {
    const remote = githubRemote(await command('git', ['remote', 'get-url', 'origin']));
    const branch = env.UPDATE_BRANCH || 'main';
    await command('git', ['check-ref-format', '--branch', branch]);
    current = { sha: await command('git', ['rev-parse', 'HEAD']), path: root };
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      if (!/^[a-f0-9]{40}$/.test(saved.sha)) throw new Error('Invalid saved release');
      const expected = resolve(stateRoot, 'releases', saved.sha);
      if (saved.path !== expected || await realpath(saved.path) !== await realpath(expected)) throw new Error('Invalid release path');
      current = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    oldRoots.push(root);
    try {
      for (const name of await readdir(resolve(stateRoot, 'releases'))) {
        if (/^[a-f0-9]{40}$/.test(name)) oldRoots.push(resolve(stateRoot, 'releases', name));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Check the private API port is free; never mistake another service for this child.
    const probe = createServer();
    await new Promise((accept, reject) => { probe.once('error', reject); probe.listen(apiPort, '127.0.0.1', accept); });
    await new Promise(done => probe.close(done));
    await start(current);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
    server = createServer(async (req, res) => {
      if (req.url?.startsWith('/api/') || req.url?.startsWith('/health/')) {
        if (switching || !child || child.exitCode !== null || child.signalCode !== null) {
          res.writeHead(503, { 'retry-after': '3', 'cache-control': 'no-store' }); res.end(); return;
        }
        const upstream = httpRequest({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, reply => {
          res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy());
        req.pipe(upstream); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const webRoot = resolve(current.path, 'apps/web/dist');
      let path = safeStaticPath(webRoot, req.url || '/');
      if (!path) { res.writeHead(400); res.end(); return; }
      try {
        let bytes;
        try { bytes = await readFile(path); } catch {
          if ((req.url || '').startsWith('/assets/')) {
            for (const previous of oldRoots) {
              try { bytes = await readFile(safeStaticPath(resolve(previous, 'apps/web/dist'), req.url)); break; } catch { /* Try retained assets. */ }
            }
          }
          if (!bytes) {
            if (extname(path)) { res.writeHead(404); res.end(); return; }
            path = resolve(webRoot, 'index.html'); bytes = await readFile(path);
          }
        }
        res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream',
          'cache-control': (req.url || '').startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { res.writeHead(404); res.end(); }
    });
    const tunnels = new Set();
    server.on('upgrade', (req, socket, head) => {
      if (switching || !child?.connected || !req.url?.startsWith('/api/')) { socket.destroy(); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: apiPort, path: req.url, headers: req.headers });
      upstream.on('upgrade', (reply, peer, data) => {
        tunnels.add(peer); peer.on('close', () => tunnels.delete(peer));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) peer.write(head); if (data.length) socket.write(data);
        peer.pipe(socket); socket.pipe(peer);
        peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy()); socket.on('close', () => peer.destroy());
      });
      upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy()); upstream.end();
    });
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, env.UPDATE_HOST || '127.0.0.1', accept); });
    log(`serving port=${port} branch=${branch}`, current.sha);
    const cache = resolve(stateRoot, 'repository.git');
    async function cycle() {
      if (closed || busy) return;
      busy = true;
      let stage = 'fetch';
      const setStage = value => {
        stage = value;
        updates.patch({ stage: value });
      };
      try {
        if (!child || child.exitCode !== null || child.signalCode !== null) {
          setStage('restart');
          await start(current); log('restarted current release', current.sha);
        }
        if (!pending) {
          setStage('fetch');
          try { await stat(cache); } catch { await command('git', ['clone', '--bare', remote, cache]); }
          await command('git', ['--git-dir', cache, 'fetch', remote, `+refs/heads/${branch}:refs/remotes/update/current`], root, 120000);
          const sha = await command('git', ['--git-dir', cache, 'rev-parse', 'refs/remotes/update/current']);
          updates.patch({ candidateSha: sha,
            ...(updates.snapshot().candidateSha !== sha ? { candidateVersion: null } : {}) });
          if (sha === current.sha) { updates.patch({ phase: 'current', stage: null, candidateSha: null, candidateVersion: null }); return; }
          if (sha === blockedSha) { updates.patch({ phase: 'maintenance' }); return; }
          setStage('history');
          try {
            await command('git', ['--git-dir', cache, 'merge-base', '--is-ancestor', current.sha, sha]);
          } catch (error) {
            if (error.exitCode === 1) error.reason = 'history_diverged';
            throw error;
          }
          setStage('checkout');
          const release = resolve(stateRoot, 'releases', sha);
          try { await stat(release); } catch { await command('git', ['--git-dir', cache, 'worktree', 'add', '--detach', release, sha]); }
          await ensureReleaseEnvironment(release);
          updates.patch({ candidateVersion: await releaseVersion(release) });
          log('preparing', sha);
          updates.patch({ phase: 'building' });
          await buildRelease(command, release, setStage);
          setStage('history');
          // Additive migration history can roll forward after a verified backup.
          const changed = await command('git', ['--git-dir', cache, 'diff', '--name-status', '--no-renames', current.sha, sha, '--', 'apps/api/src/db/migrations']);
          if (!migrationPolicy(changed, env.UPDATE_ALLOW_MIGRATIONS)) {
            blockedSha = sha;
            updates.patch({ phase: 'maintenance' });
            log('pending migrations: UPDATE_ALLOW_MIGRATIONS=false opts into manual maintenance', sha); return;
          }
          pending = { sha, path: release };
        }
        setStage('drain');
        updates.patch({ phase: 'waiting' });
        const applied = await applyPrepared({
          drain, current: () => current,
          stop: async () => { if (stage === 'drain') setStage('stop'); await stop(); },
          start: async release => { if (release === pending) setStage('start'); await start(release); },
          backup: async (previous, candidate) => {
            updates.patch({ phase: 'applying' });
            // Keep the existing failure schema while exposing backup as a
            // separate live stage; backup failures still use failure.stage=migrate.
            stage = 'migrate';
            updates.patch({ stage: 'backup' });
            log('backup started', candidate.sha);
            await backupUpdate({ stateRoot, env, previous, candidate });
            log('backup verified', candidate.sha);
          },
          prepareDatabase: async release => {
            updates.patch({ phase: 'applying' });
            setStage('migrate');
            await command('pnpm', ['db:migrate'], release);
            setStage('sync');
            await command('pnpm', ['games:sync'], release);
          },
          persist: async release => {
            setStage('persist');
            await writeFile(`${statePath}.tmp`, JSON.stringify(release));
            await rename(`${statePath}.tmp`, statePath);
          },
          activate: release => { oldRoots.unshift(current.path); current = release; },
          resume: () => { switching = false; if (child?.connected) child.send('update.resume'); },
        }, pending);
        if (applied) {
          log('updated', pending.sha); pending = undefined;
          updates.patch({ phase: 'updated', stage: null, currentSha: current.sha,
            currentVersion: await releaseVersion(current.path), candidateSha: null, candidateVersion: null });
        }
      } catch (error) {
        const reasons = new Set(['disk_full', 'permission', 'authentication', 'network', 'lockfile',
          'branch_missing', 'command_failed', 'command_missing', 'pnpm_unavailable', 'timeout',
          'history_diverged', 'drain_timeout', 'readiness', 'recovery_failed',
          'migration_changed', 'build_tool_missing', 'compilation']);
        const failure = {
          stage, reason: reasons.has(error?.reason) ? error.reason : 'unknown',
          exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : null,
          occurredAt: new Date().toISOString(),
        };
        updates.patch({ phase: 'failed', failure });
        log(`failed stage=${failure.stage} reason=${failure.reason} exit=${failure.exitCode ?? 'none'} at=${failure.occurredAt}`, pending?.sha);
      }
      finally { busy = false; }
    }
    updates = createUpdateControl({ enabled: env.UPDATE_ENABLED !== 'false', branch,
      currentSha: current.sha, currentVersion: await releaseVersion(current.path), checkIntervalMs: interval, run: cycle });
    if (env.UPDATE_ENABLED !== 'false') timer = setInterval(() => { updates.check(randomUUID()); }, interval);
    if (env.UPDATE_ENABLED !== 'false') updates.check(randomUUID());
    let stopping = false;
    async function shutdown() {
      if (stopping) return;
      stopping = true; closed = true; clearInterval(timer);
      // Finish the owned update task before touching its child or releasing lock.
      while (busy) await delay(100);
      for (const peer of tunnels) peer.destroy();
      server.close(); server.closeAllConnections(); await stop();
      await lock.close(); await unlink(lockPath);
      process.disconnect?.();
    }
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    process.on('message', message => { if (message === 'update.stop') void shutdown(); });
  } catch (error) {
    closed = true; clearInterval(timer); server?.close(); server?.closeAllConnections();
    await stop(); await lock.close(); await unlink(lockPath); throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('[online-update] startup failed; check built files, ports, GitHub origin and supervisor.lock'); process.exitCode = 1; });
}
