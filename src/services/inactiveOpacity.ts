// User-configurable opacity for inactive (out-of-focus) zones. Three
// values cover the three-pane layouts shared by every module:
//   - `sidebar` — the leftmost zone (tasks lists / address books /
//     calendar list)
//   - `middle`  — the centre zone (task tree / contact list /
//     calendar grid)
//   - `detail`  — the rightmost zone (detail panel / contact card /
//     event composer)
//
// Stored as integers 20–100 so localStorage stays human-readable.
// Defaults match the previous hard-coded class strings (sidebar 30,
// middle 60, detail 70). A custom event lets every mounted view
// re-render the moment the user drags a slider in any settings
// popover, without prop-drilling.

export type InactiveZone = 'sidebar' | 'middle' | 'detail'

export const INACTIVE_OPACITY_CHANGED_EVENT =
  'ete-sthetic:inactive-opacity-changed'

export const INACTIVE_OPACITY_DEFAULTS: Readonly<Record<InactiveZone, number>> =
  {
    sidebar: 30,
    middle: 60,
    detail: 70,
  }

export const INACTIVE_OPACITY_MIN = 20
export const INACTIVE_OPACITY_MAX = 100
export const INACTIVE_OPACITY_STEP = 10

const KEY_PREFIX = 'ete-sthetic.inactiveOpacity.'

function keyFor(z: InactiveZone): string {
  return `${KEY_PREFIX}${z}`
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < INACTIVE_OPACITY_MIN) return INACTIVE_OPACITY_MIN
  if (n > INACTIVE_OPACITY_MAX) return INACTIVE_OPACITY_MAX
  return Math.round(n)
}

export function readInactiveOpacity(z: InactiveZone): number {
  try {
    const raw = localStorage.getItem(keyFor(z))
    if (raw == null) return INACTIVE_OPACITY_DEFAULTS[z]
    const n = Number(raw)
    if (!Number.isFinite(n)) return INACTIVE_OPACITY_DEFAULTS[z]
    return clamp(n)
  } catch {
    return INACTIVE_OPACITY_DEFAULTS[z]
  }
}

export function setInactiveOpacity(z: InactiveZone, pct: number): void {
  try {
    localStorage.setItem(keyFor(z), String(clamp(pct)))
    window.dispatchEvent(new CustomEvent(INACTIVE_OPACITY_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — silently drop. The value will revert
    // to default next session, which is annoying but not broken.
  }
}

export function resetInactiveOpacity(z: InactiveZone): void {
  try {
    localStorage.removeItem(keyFor(z))
    window.dispatchEvent(new CustomEvent(INACTIVE_OPACITY_CHANGED_EVENT))
  } catch {
    // ignore
  }
}
