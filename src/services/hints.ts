// Discoverable usage hints. Two layers of opt-out:
//   - A global "Show usage hints" toggle (in each module's settings
//     popover) that hides every hint at once.
//   - A per-hint × that remembers itself, so a one-off tip the user has
//     read disappears even when hints are still globally on.
//
// The Hint component re-reads both bits whenever the HINTS_CHANGED_EVENT
// fires on `window`, so toggling the setting or dismissing a hint
// updates instantly across the app without prop-drilling state.

const HINTS_ENABLED_KEY = 'ete-stethic.hints.enabled'
const HINTS_DISMISSED_PREFIX = 'ete-stethic.hints.dismissed.'
export const HINTS_CHANGED_EVENT = 'ete-stethic:hints-changed'

export function readHintsEnabled(): boolean {
  try {
    // Default-on: only `'false'` disables hints. A missing key still
    // means the user hasn't opted out.
    return localStorage.getItem(HINTS_ENABLED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setHintsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(HINTS_ENABLED_KEY, String(enabled))
  } catch {
    /* not fatal */
  }
  window.dispatchEvent(new Event(HINTS_CHANGED_EVENT))
}

export function isHintDismissed(id: string): boolean {
  try {
    return localStorage.getItem(HINTS_DISMISSED_PREFIX + id) === 'true'
  } catch {
    return false
  }
}

export function dismissHint(id: string) {
  try {
    localStorage.setItem(HINTS_DISMISSED_PREFIX + id, 'true')
  } catch {
    /* not fatal */
  }
  window.dispatchEvent(new Event(HINTS_CHANGED_EVENT))
}

export function isHintVisible(id: string): boolean {
  return readHintsEnabled() && !isHintDismissed(id)
}
