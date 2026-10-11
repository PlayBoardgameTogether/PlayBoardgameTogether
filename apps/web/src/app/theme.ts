export type ThemePreference = 'system' | 'light' | 'dark';

export const themeStorageKey = 'boardgame.theme';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(themeStorageKey);
    return saved ? parseThemePreference(saved) : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(preference: ThemePreference): void {
  const theme = preference === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', theme === 'light' ? '#faf7f2' : '#141210',
  );
}

// Keep React initialization aligned with the small first-paint script in index.html.
applyTheme(readThemePreference());
