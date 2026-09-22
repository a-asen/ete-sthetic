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

// Derive the "soft" tint used for large accent-washed surfaces
// (--color-accent-soft). Desaturated and slightly darkened relative to
// the raw accent so the tint stays close to neutral across accent
// choices — a saturated accent hue otherwise visibly re-tints big
// surfaces (~60 usages) and the whole app feels hypersensitive to the
// colour pick. Vivid accents keep living on --color-accent itself
// (buttons, rings, focus, the sync pill).
export function accentSoftFromHex(hex: string, alpha = 0.14): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }
  // Halve the saturation, ease lightness toward the neutral mid.
  s *= 0.5
  const lSoft = l * 0.85 + 0.075
  const q = lSoft < 0.5
    ? lSoft * (1 + s)
    : lSoft + s - lSoft * s
  const p = 2 * lSoft - q
  const channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const to255 = (t: number) => Math.round(channel(t) * 255)
  return `rgba(${to255(h + 1 / 3)}, ${to255(h)}, ${to255(h - 1 / 3)}, ${alpha})`
}

export function applyAccent(hex: string | null) {
  const root = document.documentElement
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    root.style.setProperty('--color-accent', hex)
    root.style.setProperty('--color-accent-soft', accentSoftFromHex(hex))
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
