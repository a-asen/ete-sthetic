// Per-module enable flags. Users who don't use a module (e.g. tasks
// only, no calendar / contacts) can disable it so its switcher button
// hides and its background sync timers stop running (which falls out
// for free, since a disabled module isn't rendered → its useEffects
// don't mount → no timers).
//
// Storage is localStorage with one key per module so an individual
// flag can be flipped without re-encoding the whole set. The custom
// `MODULE_FLAGS_CHANGED_EVENT` lets multiple settings popovers stay
// in sync without prop-drilling (same pattern as the hints toggle).

export type ModuleName = 'home' | 'tasks' | 'calendar' | 'contacts'

// Every module, in the default switcher order. Used to enforce the "at
// least one module stays enabled" invariant and to seed/normalize the
// user's custom order below.
export const ALL_MODULES: readonly ModuleName[] = [
  'home',
  'tasks',
  'calendar',
  'contacts',
]

const KEY_PREFIX = 'ete-sthetic.modules.'
const KEY_SUFFIX = '.enabled'
const ORDER_KEY = 'ete-sthetic.modules.order'

export const MODULE_FLAGS_CHANGED_EVENT = 'ete-sthetic:module-flags-changed'

function keyFor(m: ModuleName): string {
  return `${KEY_PREFIX}${m}${KEY_SUFFIX}`
}

export function readModuleEnabled(m: ModuleName): boolean {
  try {
    const raw = localStorage.getItem(keyFor(m))
    // Default ON — only an explicit "false" disables. Keeps the flag
    // backwards-compatible with users who upgrade in-place.
    return raw !== 'false'
  } catch {
    return true
  }
}

export function setModuleEnabled(m: ModuleName, enabled: boolean): void {
  try {
    // At least one module must always stay enabled, or the user would be
    // left with no view to show. Disabling the last remaining enabled
    // module silently no-ops rather than throwing so a buggy caller can't
    // lock the user out. (Home is no longer special — it can be hidden as
    // long as something else is on.)
    if (!enabled && readModuleEnabled(m)) {
      const enabledCount = ALL_MODULES.filter(readModuleEnabled).length
      if (enabledCount <= 1) return
    }
    localStorage.setItem(keyFor(m), enabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent(MODULE_FLAGS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — drop silently; the flag just won't
    // persist this session.
  }
}

// User-customisable switcher order. Stored as a JSON array; always
// normalised to contain exactly the known modules (unknown entries
// dropped, missing ones appended in default order) so a stale/partial
// value can't hide a module. Drives the top-bar switcher AND the
// Ctrl/Cmd+Alt+1..4 shortcuts.
export function readModuleOrder(): ModuleName[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const known = new Set<string>(ALL_MODULES)
        const valid = parsed.filter(
          (m): m is ModuleName =>
            typeof m === 'string' && known.has(m),
        )
        const seen = new Set(valid)
        const missing = ALL_MODULES.filter((m) => !seen.has(m))
        return [...valid, ...missing]
      }
    }
  } catch {
    // fall through to default
  }
  return [...ALL_MODULES]
}

export function writeModuleOrder(order: ModuleName[]): void {
  try {
    const known = new Set<string>(ALL_MODULES)
    const valid = order.filter((m) => known.has(m))
    const seen = new Set(valid)
    const missing = ALL_MODULES.filter((m) => !seen.has(m))
    localStorage.setItem(ORDER_KEY, JSON.stringify([...valid, ...missing]))
    window.dispatchEvent(new CustomEvent(MODULE_FLAGS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — order just won't persist this session.
  }
}

// Move a module one slot up (-1) or down (+1) in the order and persist.
export function moveModule(m: ModuleName, dir: -1 | 1): void {
  const order = readModuleOrder()
  const i = order.indexOf(m)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  writeModuleOrder(next)
}
