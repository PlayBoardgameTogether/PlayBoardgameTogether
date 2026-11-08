import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

async function regularFile(path) {
  const info = await lstat(path);
  requireCondition(info.isFile(), 'BACKUP_UNSUPPORTED_ENTRY');
  return info;
}

async function fileDigest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  await regularFile(path);
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function inventory(directory, prefix = '') {
  const files = [];
  for (const name of await readdir(directory)) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (relative === 'COMPLETE.json') continue;
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) files.push(...(await inventory(path, relative)));
    else {
      requireCondition(info.isFile(), 'BACKUP_UNSUPPORTED_ENTRY');
      files.push(relative);
    }
  }
  return files.sort();
}

// Read only: never loads recovery settings into process.env or connects to a DB.
// A completed directory must remain immutable while this check is running.
export async function verifyUpdateBackup(directory) {
  const root = resolve(directory);
  requireCondition((await lstat(root)).isDirectory(), 'BACKUP_INVALID_DIRECTORY');
  const marker = join(root, 'COMPLETE.json');
  requireCondition(
    (await regularFile(marker)).size <= 8 * 1024 * 1024,
    'BACKUP_MANIFEST_TOO_LARGE',
  );
  const manifest = JSON.parse(await readFile(marker, 'utf8'));
  requireCondition(
    manifest?.format === 1 && Array.isArray(manifest.files),
    'BACKUP_INVALID_MANIFEST',
  );
  const listed = new Map();
  for (const file of manifest.files) {
    requireCondition(
      file &&
        typeof file.path === 'string' &&
        file.path
          .split('/')
          .every(
            (part) =>
              part && part !== '.' && part !== '..' && !/[\\:]/.test(part) && !part.includes('\0'),
          ) &&
        file.path !== 'COMPLETE.json' &&
        !listed.has(file.path) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes >= 0 &&
        typeof file.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(file.sha256),
      'BACKUP_INVALID_MANIFEST',
    );
    listed.set(file.path, file);
  }
  for (const required of ['database.dump', 'release.json', 'recovery-config.json']) {
    requireCondition(listed.has(required), 'BACKUP_REQUIRED_FILE_MISSING');
  }
  requireCondition((await lstat(join(root, 'assets'))).isDirectory(), 'BACKUP_ASSETS_MISSING');
  const actual = await inventory(root);
  requireCondition(
    JSON.stringify(actual) === JSON.stringify([...listed.keys()].sort()),
    'BACKUP_FILE_SET_MISMATCH',
  );
  let bytes = 0;
  for (const path of actual) {
    const digest = await fileDigest(join(root, path));
    const expected = listed.get(path);
    requireCondition(
      digest.bytes === expected.bytes && digest.sha256 === expected.sha256,
      'BACKUP_DIGEST_MISMATCH',
    );
    bytes += digest.bytes;
  }
  const signature = createReadStream(join(root, 'database.dump'), { start: 0, end: 4 });
  let header = '';
  for await (const chunk of signature) header += chunk.toString('ascii');
  requireCondition(header === 'PGDMP', 'BACKUP_INVALID_ARCHIVE');
  const release = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
  requireCondition(
    /^[a-f0-9]{40}$/.test(release?.previous?.sha ?? '') &&
      /^[a-f0-9]{40}$/.test(release?.candidate?.sha ?? '') &&
      typeof release.createdAt === 'string' &&
      Number.isFinite(Date.parse(release.createdAt)),
    'BACKUP_INVALID_RELEASE',
  );
  return {
    format: 1,
    files: actual.length,
    bytes,
    createdAt: release.createdAt,
    previousSha: release.previous.sha,
    candidateSha: release.candidate.sha,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireCondition(
      process.argv.length === 3,
      'Usage: node scripts/verify-update-backup.mjs <completed-backup-directory>',
    );
    console.log(JSON.stringify(await verifyUpdateBackup(process.argv[2])));
  } catch (error) {
    // Filesystem/JSON errors can contain private paths or configuration values.
    console.error(
      error instanceof Error && /^(BACKUP_|Usage:)/.test(error.message)
        ? error.message
        : 'BACKUP_VERIFICATION_FAILED',
    );
    process.exitCode = 1;
  }
}
