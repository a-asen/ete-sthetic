// Global auto-sync cadence: every `autoSyncMin` minutes the app
// force-syncs every enabled module — mounted views through their
// registered sync-all handlers (so the visible list repaints),
// unmounted ones through the headless background syncs. The same
// interval doubles as the staleness threshold for a window-focus
// refresh, so coming back to the app never leaves a module showing
// data older than the cadence. 0 means "manual only".

const KEY = 'ete-sthetic.autoSyncMin'

export const AUTO_SYNC_CHANGED_EVENT = 'ete-sthetic:auto-sync-changed'

// 0 = off; the rest mirror the option grids the per-module sync
// settings use so the choices feel consistent across the app.
export const AUTO_SYNC_OPTIONS = [0, 15, 30, 60, 120, 240, 720, 1440] as const
export const DEFAULT_AUTO_SYNC_MIN = 60

export function readAutoSyncMin(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return (AUTO_SYNC_OPTIONS as readonly number[]).includes(v)
      ? v
      : DEFAULT_AUTO_SYNC_MIN
  } catch {
    return DEFAULT_AUTO_SYNC_MIN
  }
}

export function writeAutoSyncMin(n: number): void {
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    // not fatal
  }
  window.dispatchEvent(new CustomEvent(AUTO_SYNC_CHANGED_EVENT))
}

export function autoSyncLabel(min: number): string {
  if (min <= 0) return 'Off (manual only)'
  if (min < 60) return `${min} min`
  if (min % 60 === 0) return min === 60 ? '1 hour' : `${min / 60} hours`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}