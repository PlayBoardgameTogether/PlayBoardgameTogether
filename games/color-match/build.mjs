import { copyFile } from 'node:fs/promises';
import { URL } from 'node:url';

await copyFile(
  new URL('./src/client/style.css', import.meta.url),
  new URL('./dist/client/style.css', import.meta.url),
);
