import { Buffer } from 'node:buffer';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { zipSync } from 'fflate';
import { awariFiles } from './awari-package.mjs';

const files = await awariFiles();
const descriptor = JSON.parse(files['game.json'].toString('utf8'));
const browser = await chromium.launch();
try {
  descriptor.presentation = {};
  for (const [kind, width, height] of [
    ['icon', 256, 256],
    ['cover', 960, 540],
  ]) {
    const svg = await readFile(
      new URL(`../game-packages/awari/art/${kind}.svg`, import.meta.url),
      'utf8',
    );
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    const png = await page.screenshot({ type: 'png' });
    if (png.length > 320 * 1024) throw new Error(`${kind} exceeds package artwork limit`);
    descriptor.presentation[kind] = `data:image/png;base64,${png.toString('base64')}`;
    await page.close();
  }
} finally {
  await browser.close();
}
files['game.json'] = Buffer.from(JSON.stringify(descriptor));
const output = new URL('../dist/game-packages/awari-1.0.0.zip', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
const bytes = zipSync(files, { mtime: new Date('2026-10-24T00:00:00Z'), level: 9 });
await writeFile(output, bytes);
console.log(`Awari ZIP: ${output.pathname} (${bytes.length} bytes)`);
