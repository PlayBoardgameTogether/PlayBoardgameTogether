import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { chromium } from '@playwright/test';
import { rummikubFiles } from './rummikub-package.mjs';

const files = await rummikubFiles();
const descriptor = JSON.parse(files['game.json'].toString('utf8'));
const browser = await chromium.launch();
try {
  descriptor.presentation = {};
  for (const [kind, source, width, height] of [
    ['icon', 'icon.svg', 256, 256],
    ['cover', 'cover.svg', 960, 540],
    ['background', 'cover.svg', 960, 540],
  ]) {
    const svg = await readFile(new URL(`../game-packages/rummikub/art/${source}`, import.meta.url), 'utf8');
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({ type: 'png' });
    if (png.length > 320 * 1024) throw new Error(`${kind} exceeds package artwork limit`);
    descriptor.presentation[kind] = `data:image/png;base64,${png.toString('base64')}`;
    await page.close();
  }
} finally { await browser.close(); }
files['game.json'] = Buffer.from(JSON.stringify(descriptor));
const output = new URL('../dist/game-packages/rummikub-1.0.3.zip', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
const bytes = zipSync(files, { mtime: new Date('2026-10-04T00:00:00Z'), level: 9 });
await writeFile(output, bytes);
console.log(`Rummikub ZIP: ${output.pathname} (${bytes.length} bytes; embedded artwork)`);
