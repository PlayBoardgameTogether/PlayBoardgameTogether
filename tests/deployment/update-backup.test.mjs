import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { backupUpdate, migrationPolicy } from '../../scripts/update-backup.mjs';
import { applyPrepared } from '../../scripts/online-update.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'playboard-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = join(root, 'assets');
  await mkdir(join(assets, 'nested'), { recursive: true });
  await writeFile(join(assets, 'nested', 'image.bin'), Buffer.from([0, 255, 17]));
  const calls = [];
  const args = {
    stateRoot: join(root, 'updates'),
    env: { DATABASE_URL: 'postgresql://user:secret@localhost/db', ASSET_STORAGE_DIR: assets,
      MODEL_CREDENTIALS_KEY: 'private-key', UNRELATED_TOKEN: 'not-for-backup' },
    previous: { sha: 'old', path: root }, candidate: { sha: 'new', path: root },
    command: async (executable, argv, options) => {
      calls.push({ executable, argv, options });
      if (executable === 'pg_dump') await writeFile(argv[argv.indexOf('--file') + 1], 'PGDMPfixture');
      else assert.equal(executable, 'pg_restore');
      return '';
    },
  };
  return { root, args, calls };
}

test('completed backup has verified copies, manifest and private recovery settings', async t => {
  const { args, calls } = await fixture(t);
  const directory = await backupUpdate(args);
  assert.match(directory, /update-/);
  const manifest = JSON.parse(await readFile(join(directory, 'COMPLETE.json'), 'utf8'));
  assert.equal(manifest.format, 1);
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.deepEqual(await readFile(join(directory, 'assets/nested/image.bin')), Buffer.from([0, 255, 17]));
  const config = JSON.parse(await readFile(join(directory, 'recovery-config.json'), 'utf8'));
  assert.equal(config.MODEL_CREDENTIALS_KEY, 'private-key');
  assert.equal(config.UNRELATED_TOKEN, undefined);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, 'recovery-config.json'))).mode & 0o777, 0o600);
  assert.deepEqual(calls.map(call => call.executable), ['pg_dump', 'pg_restore']);
  assert.equal(calls[0].options.env.PGDATABASE, args.env.DATABASE_URL);
  assert.ok(!JSON.stringify(calls.map(call => call.argv)).includes('secret'));
});

for (const failure of ['dump', 'invalid archive', 'archive listing', 'assets', 'link']) {
  test(`${failure} failure never publishes a completed backup`, async t => {
    const { root, args } = await fixture(t);
    const command = args.command;
    args.command = async (executable, argv, options) => {
      if ((failure === 'dump' && executable === 'pg_dump') ||
          (failure === 'archive listing' && executable === 'pg_restore')) throw new Error('failure');
      await command(executable, argv, options);
      if (failure === 'invalid archive' && executable === 'pg_dump') {
        await writeFile(argv[argv.indexOf('--file') + 1], 'broken');
      }
    };
    if (failure === 'assets') await rm(args.env.ASSET_STORAGE_DIR, { recursive: true });
    if (failure === 'link') await symlink(root, join(args.env.ASSET_STORAGE_DIR, 'outside'));
    await assert.rejects(backupUpdate(args));
    assert.ok((await readdir(join(args.stateRoot, 'backups'))).every(name => name.startsWith('.partial-')));
  });
}

test('refuses recursive snapshots with backup storage inside assets', async t => {
  const { args, calls } = await fixture(t);
  args.stateRoot = join(args.env.ASSET_STORAGE_DIR, 'updates');
  await assert.rejects(backupUpdate(args), /outside asset storage/);
  assert.equal(calls.length, 0);
});

test('new migrations run by default, explicit opt-out waits and existing history cannot change', () => {
  const added = 'A\tapps/api/src/db/migrations/032_next.sql';
  assert.equal(migrationPolicy(added), true);
  assert.equal(migrationPolicy(added, 'true'), true);
  assert.equal(migrationPolicy(added, 'false'), false);
  assert.equal(migrationPolicy('', 'false'), true);
  for (const kind of ['M', 'D', 'R100', 'T']) {
    assert.throws(() => migrationPolicy(`${kind}\thistory.sql`, 'true'), { reason: 'migration_changed' });
  }
});

test('backup failure resumes old service without running database preparation or activating candidate', async () => {
  const events = [];
  const previous = { sha: 'old' };
  const deps = {
    drain: async () => true, current: () => previous,
    stop: async () => { events.push('stop'); },
    backup: async () => { events.push('backup'); throw new Error('backup failed'); },
    prepareDatabase: async () => { events.push('migrate'); },
    start: async release => { events.push(`start:${release.sha}`); },
    persist: async () => { events.push('persist'); }, activate: () => { events.push('activate'); },
    resume: () => { events.push('resume'); },
  };
  await assert.rejects(applyPrepared(deps, { sha: 'new' }), /backup failed/);
  assert.deepEqual(events, ['stop', 'backup', 'stop', 'start:old', 'resume']);
});

test('service stops before backup, then migrates, verifies and publishes in order', async () => {
  const events = [];
  const previous = { sha: 'old' };
  const candidate = { sha: 'new' };
  const deps = {
    drain: async () => true, current: () => previous,
    stop: async () => { events.push('stop'); },
    backup: async (old, next) => { assert.equal(old, previous); assert.equal(next, candidate); events.push('backup'); },
    prepareDatabase: async () => { events.push('migrate'); },
    start: async () => { events.push('ready'); }, persist: async () => { events.push('persist'); },
    activate: () => { events.push('activate'); }, resume: () => { events.push('resume'); },
  };
  assert.equal(await applyPrepared(deps, candidate), true);
  assert.deepEqual(events, ['stop', 'backup', 'migrate', 'ready', 'persist', 'activate', 'resume']);
});
