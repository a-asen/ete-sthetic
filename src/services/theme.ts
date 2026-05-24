// Theme persistence + DOM application. Kept tiny so main.tsx can call
// applyStoredTheme() synchronously before React mounts (no flash).

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'ete-sthetic.theme'

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

// ---- Accent colour --------------------------------------------------
// Optional user override of the theme's accent. Stored as #rrggbb (or
// null = use the theme default). Applied as inline custom properties on
// <html>, which beat the stylesheet's :root / [data-theme] values.

const ACCENT_KEY = 'ete-sthetic.accent'

export function readStoredAccent(): string | null {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  } catch {
    // ignore
  }
  return null
}

export function writeStoredAccent(hex: string | null) {
  try {
    if (hex) localStorage.setItem(ACCENT_KEY, hex)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    // not fatal
  }
}

export function applyAccent(hex: string | null) {
  const root = document.documentElement
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    root.style.setProperty('--color-accent', hex)
    root.style.setProperty(
      '--color-accent-soft',
      `rgba(${r}, ${g}, ${b}, 0.16)`,
    )
  } else {
    root.style.removeProperty('--color-accent')
    root.style.removeProperty('--color-accent-soft')
  }
}

export function applyStoredAccent(): string | null {
  const a = readStoredAccent()
  applyAccent(a)
  return a
}
