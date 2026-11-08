import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyUpdateBackup } from '../../scripts/verify-update-backup.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'playboard-verify-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));
  const contents = {
    'database.dump': 'PGDMPfixture',
    'release.json': JSON.stringify({
      previous: { sha: 'a'.repeat(40) },
      candidate: { sha: 'b'.repeat(40) },
      createdAt: '2026-11-08T00:00:00Z',
    }),
    'recovery-config.json': JSON.stringify({
      DATABASE_URL: 'private-connection-string',
      MODEL_CREDENTIALS_KEY: 'private-key',
    }),
    'assets/image.bin': 'image',
  };
  const files = [];
  for (const [path, content] of Object.entries(contents)) {
    await writeFile(join(root, path), content);
    files.push({
      path,
      bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
  const marker = { format: 1, files };
  await writeFile(join(root, 'COMPLETE.json'), JSON.stringify(marker));
  return { root, marker };
}

test('verifies the full file inventory without returning recovery secrets', async (t) => {
  const { root } = await fixture(t);
  const result = await verifyUpdateBackup(root);
  assert.equal(result.files, 4);
  assert.equal(result.previousSha, 'a'.repeat(40));
  assert.equal(result.candidateSha, 'b'.repeat(40));
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('rejects changed bytes, missing files and unlisted files', async (t) => {
  for (const kind of ['changed', 'missing', 'unlisted']) {
    const { root } = await fixture(t);
    if (kind === 'changed') await writeFile(join(root, 'assets/image.bin'), 'other');
    if (kind === 'missing') await rm(join(root, 'assets/image.bin'));
    if (kind === 'unlisted') await writeFile(join(root, 'assets/extra.bin'), 'extra');
    await assert.rejects(verifyUpdateBackup(root), /BACKUP_(DIGEST_MISMATCH|FILE_SET_MISMATCH)/);
  }
});

test('rejects manifest traversal, duplicate paths and incomplete manifests', async (t) => {
  for (const kind of ['traversal', 'duplicate', 'incomplete']) {
    const { root, marker } = await fixture(t);
    if (kind === 'traversal') marker.files[0].path = '../database.dump';
    if (kind === 'duplicate') marker.files.push(marker.files[0]);
    if (kind === 'incomplete')
      marker.files = marker.files.filter((file) => file.path !== 'database.dump');
    await writeFile(join(root, 'COMPLETE.json'), JSON.stringify(marker));
    await assert.rejects(
      verifyUpdateBackup(root),
      /BACKUP_(INVALID_MANIFEST|REQUIRED_FILE_MISSING)/,
    );
  }
});

test('rejects linked assets and a linked completion marker', async (t) => {
  for (const entry of ['assets/image.bin', 'COMPLETE.json']) {
    const { root } = await fixture(t);
    const content = await readFile(join(root, entry));
    await writeFile(join(root, 'link-target'), content);
    await rm(join(root, entry));
    await symlink(join(root, 'link-target'), join(root, entry));
    await assert.rejects(verifyUpdateBackup(root), /BACKUP_UNSUPPORTED_ENTRY/);
  }
});
