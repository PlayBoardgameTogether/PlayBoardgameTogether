import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function path(email: string) {
  return resolve(
    '.data/e2e-registration-mail',
    `${createHash('sha256').update(email.toLowerCase()).digest('hex')}.txt`,
  );
}
// Private test-only inbox, never served over HTTP or enabled by production config.
export async function deliverRegistrationMail(email: string, code: string) {
  await mkdir(resolve('.data/e2e-registration-mail'), { recursive: true });
  await writeFile(path(email), code, { mode: 0o600 });
}
export async function readRegistrationCode(email: string) {
  return readFile(path(email), 'utf8');
}
