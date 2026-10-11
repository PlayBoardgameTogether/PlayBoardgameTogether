import { readFile } from 'node:fs/promises';

// Inline browser fixtures must expand the same imports as the production CSS entry.
export async function platformStyles(
  url = new URL('../../apps/web/src/styles/index.css', import.meta.url),
): Promise<string> {
  const css = await readFile(url, 'utf8');
  const imports = [...css.matchAll(/@import\s+'([^']+)';/g)];
  let result = css;
  for (const match of imports)
    result = result.replace(match[0], await platformStyles(new URL(match[1], url)));
  return result;
}
