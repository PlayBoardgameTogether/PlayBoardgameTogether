import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

export async function awariFiles() {
  const base = new URL('../game-packages/awari/', import.meta.url);
  return {
    'game.json': Buffer.from(await readFile(new URL('game.json', base))),
    'server.js': Buffer.from(await readFile(new URL('server.txt', base))),
    'client.html': Buffer.from(await readFile(new URL('client.html', base))),
  };
}
