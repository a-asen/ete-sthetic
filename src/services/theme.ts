// Theme persistence + DOM application. Kept tiny so main.tsx can call
// applyStoredTheme() synchronously before React mounts (no flash).

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'ete-stethic.theme'

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // localStorage unavailable; fall through.
  }
  return 'dark'
}

export function writeStoredTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // not fatal
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function applyStoredTheme(): Theme {
  const t = readStoredTheme()
  applyTheme(t)
  return t
}
