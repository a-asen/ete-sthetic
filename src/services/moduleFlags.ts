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

export type ModuleName = 'tasks' | 'calendar' | 'contacts'

const KEY_PREFIX = 'ete-sthetic.modules.'
const KEY_SUFFIX = '.enabled'

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
    // Tasks can never be disabled — it's the home zone for the app and
    // would leave the user with nowhere to go if turned off alongside
    // any of the others. Silently no-op rather than throw so a buggy
    // caller can't lock the user out.
    if (m === 'tasks' && !enabled) return
    localStorage.setItem(keyFor(m), enabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent(MODULE_FLAGS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — drop silently; the flag just won't
    // persist this session.
  }
}
