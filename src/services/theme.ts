// Theme persistence + DOM application. Kept tiny so main.tsx can call
// applyStoredTheme() synchronously before React mounts (no flash).

// The concrete theme actually applied to the DOM.
export type Theme = 'dark' | 'light'
// The user's stored preference. 'system' tracks the OS light/dark setting
// live (see watchSystemTheme); the others pin a fixed theme.
export type ThemePref = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'ete-sthetic.theme'

export function readStoredThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage unavailable; fall through.
  }
  return 'dark'
}

export function writeStoredThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // not fatal
  }
}

// The OS's current light/dark setting. Defaults to dark when the query
// is unsupported (matches the app's historical default).
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  } catch {
    return 'dark'
  }
}

// Concrete theme for a preference — resolving 'system' against the OS.
export function resolveTheme(pref: ThemePref): Theme {
  return pref === 'system' ? systemTheme() : pref
}

// Effective theme currently in force (preference resolved). Kept for
// callers that just want "is it dark right now".
export function readStoredTheme(): Theme {
  return resolveTheme(readStoredThemePref())
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function applyStoredTheme(): Theme {
  const t = resolveTheme(readStoredThemePref())
  applyTheme(t)
  return t
}

// Re-apply the theme when the OS light/dark setting changes, but only
// while the stored preference is 'system'. Returns an unsubscribe.
// Called once at startup; lives for the app's lifetime.
export function watchSystemTheme(
  onChange?: (theme: Theme) => void,
): () => void {
  let mql: MediaQueryList
  try {
    mql = window.matchMedia('(prefers-color-scheme: light)')
  } catch {
    return () => {}
  }
  const handler = () => {
    if (readStoredThemePref() !== 'system') return
    const t = systemTheme()
    applyTheme(t)
    onChange?.(t)
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
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
