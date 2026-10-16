import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readdir, lstat, copyFile, chmod, rename, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runUpdateCommand } from './update-command.mjs';

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Only regular files/directories are recoverable snapshots. Refuse links and
// devices rather than silently leaving live references in a completed backup.
async function snapshotAssets(source, destination) {
  if (!(await lstat(source)).isDirectory()) throw new Error('Invalid asset directory');
  await mkdir(destination, { mode: 0o700 });
  for (const name of await readdir(source)) {
    const from = join(source, name);
    const to = join(destination, name);
    const entry = await lstat(from);
    if (entry.isDirectory()) await snapshotAssets(from, to);
    else if (entry.isFile()) {
      await copyFile(from, to);
      await chmod(to, 0o600);
      if (await digest(from) !== await digest(to)) throw new Error('Asset backup verification failed');
    } else throw new Error('Unsupported asset entry');
  }
}

async function inventory(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) entries.push(...await inventory(path, relative));
    else entries.push({ path: relative, bytes: info.size, sha256: await digest(path) });
  }
  return entries;
}

export function migrationPolicy(changes, allow = undefined) {
  // Existing migration history is immutable, even when automatic migrations
  // are enabled. Git --no-renames gives additions, removals and modifications.
  const entries = changes.trim().split('\n').filter(Boolean);
  if (entries.some(entry => !entry.startsWith('A\t'))) {
    throw Object.assign(new Error('Existing migration history changed'), { reason: 'migration_changed' });
  }
  return entries.length === 0 || allow !== 'false';
}

export async function backupUpdate({ stateRoot, env, previous, candidate, command = runUpdateCommand }) {
  if (!env.DATABASE_URL || !env.ASSET_STORAGE_DIR) throw new Error('Backup configuration missing');
  const backups = resolve(stateRoot, 'backups');
  await mkdir(backups, { recursive: true, mode: 0o700 });
  await chmod(backups, 0o700);
  const assets = await realpath(env.ASSET_STORAGE_DIR);
  const backupRoot = await realpath(backups);
  if (backupRoot === assets || backupRoot.startsWith(assets + sep)) {
    throw new Error('Backup directory must be outside asset storage');
  }
  const directory = await mkdtemp(join(backups, '.partial-'));
  await chmod(directory, 0o700);
  // libpq accepts a connection URI in PGDATABASE. Keep credentials out of argv,
  // public logs and the supervisor's bounded command output.
  const options = { cwd: previous.path, env: { ...env, PGDATABASE: env.DATABASE_URL }, timeout: 600000 };
  const dump = join(directory, 'database.dump');
  await command('pg_dump', ['--format=custom', '--file', dump, '--no-password'], options);
  await chmod(dump, 0o600);
  const header = await readFileHeader(dump);
  if (header !== 'PGDMP') throw new Error('Invalid database backup');
  await command('pg_restore', ['--list', dump], options);
  await snapshotAssets(env.ASSET_STORAGE_DIR, join(directory, 'assets'));
  const configuration = Object.fromEntries([
    'DATABASE_URL', 'MODEL_CREDENTIALS_KEY', 'ASSET_STORAGE_DIR', 'WEB_ORIGIN', 'COOKIE_SECURE',
  ].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  await writeFile(join(directory, 'recovery-config.json'), JSON.stringify(configuration), { mode: 0o600 });
  await writeFile(join(directory, 'release.json'), JSON.stringify({
    createdAt: new Date().toISOString(), previous, candidate,
  }), { mode: 0o600 });
  const files = await inventory(directory);
  await writeFile(join(directory, 'COMPLETE.json'), JSON.stringify({ format: 1, files }), { mode: 0o600 });
  const completed = join(backups, `update-${directory.slice(directory.lastIndexOf('.partial-') + 9)}`);
  await rename(directory, completed);
  return completed;
}

async function readFileHeader(path) {
  // Stream only the signature; database archives can be many gigabytes.
  for await (const chunk of createReadStream(path, { start: 0, end: 4 })) return chunk.toString('ascii');
  return '';
}
