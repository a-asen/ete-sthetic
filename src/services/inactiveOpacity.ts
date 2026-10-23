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
// Tasks keeps the original hard-coded defaults (sidebar 30, middle 60,
// detail 70). Contacts defaults to 100 everywhere — its panes fit on one
// page, so fading them by default only made it harder to scan the books
// and list. The fade capability remains available in contacts settings.
// A custom event lets every mounted view re-render the moment the user
// changes a value in any settings popover, without prop-drilling.

export type InactiveZone = 'sidebar' | 'middle' | 'detail'

// Which module's fade preferences to read/write. The zones line up, but
// the defaults and stored values are independent.
export type InactiveScope = 'tasks' | 'contacts'

export const INACTIVE_OPACITY_CHANGED_EVENT =
  'ete-sthetic:inactive-opacity-changed'

export const INACTIVE_OPACITY_DEFAULTS: Readonly<
  Record<InactiveScope, Readonly<Record<InactiveZone, number>>>
> = {
  tasks: {
    sidebar: 30,
    middle: 60,
    detail: 70,
  },
  contacts: {
    sidebar: 100,
    middle: 100,
    detail: 100,
  },
}

export const INACTIVE_OPACITY_MIN = 20
export const INACTIVE_OPACITY_MAX = 100
export const INACTIVE_OPACITY_STEP = 10

const KEY_PREFIX = 'ete-sthetic.inactiveOpacity.'

// Tasks keeps the legacy unscoped keys so existing preferences survive the
// introduction of module scoping; contacts gets its own namespace.
function keyFor(scope: InactiveScope, z: InactiveZone): string {
  return scope === 'tasks'
    ? `${KEY_PREFIX}${z}`
    : `${KEY_PREFIX}${scope}.${z}`
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < INACTIVE_OPACITY_MIN) return INACTIVE_OPACITY_MIN
  if (n > INACTIVE_OPACITY_MAX) return INACTIVE_OPACITY_MAX
  return Math.round(n)
}

export function readInactiveOpacity(
  z: InactiveZone,
  scope: InactiveScope = 'tasks',
): number {
  try {
    const raw = localStorage.getItem(keyFor(scope, z))
    if (raw == null) return INACTIVE_OPACITY_DEFAULTS[scope][z]
    const n = Number(raw)
    if (!Number.isFinite(n)) return INACTIVE_OPACITY_DEFAULTS[scope][z]
    return clamp(n)
  } catch {
    return INACTIVE_OPACITY_DEFAULTS[scope][z]
  }
}

export function setInactiveOpacity(
  z: InactiveZone,
  pct: number,
  scope: InactiveScope = 'tasks',
): void {
  try {
    localStorage.setItem(keyFor(scope, z), String(clamp(pct)))
    window.dispatchEvent(new CustomEvent(INACTIVE_OPACITY_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — silently drop. The value will revert
    // to default next session, which is annoying but not broken.
  }
}

export function resetInactiveOpacity(
  z: InactiveZone,
  scope: InactiveScope = 'tasks',
): void {
  try {
    localStorage.removeItem(keyFor(scope, z))
    window.dispatchEvent(new CustomEvent(INACTIVE_OPACITY_CHANGED_EVENT))
  } catch {
    // ignore
  }
}
