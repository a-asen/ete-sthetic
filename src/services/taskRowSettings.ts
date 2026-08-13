// User preferences for what shows up on the task row beyond the title /
// due / priority cluster. Currently: completed-subtask count + total
// subtask count, each independently toggleable. When both are on the
// row renders "3/8"; when only one is on it renders "3" or "/8"; when
// both are off the counter hides entirely. Leaf tasks never show a
// counter regardless.
//
// Persisted in localStorage and broadcast via a custom event so any
// TaskTree currently mounted re-renders the moment the toggle flips
// in a settings popover.

export const TASK_ROW_SETTINGS_CHANGED_EVENT =
  'ete-sthetic:task-row-settings-changed'

const KEY_SHOW_COMPLETED = 'ete-sthetic.tasks.row.showCompletedCount'
const KEY_SHOW_TOTAL = 'ete-sthetic.tasks.row.showTotalCount'
// Whether each task row shows a second line previewing the task's
// description/notes (and location). Off by default to keep the list
// compact; opt-in for users who want details at a glance.
const KEY_SHOW_DETAILS = 'ete-sthetic.tasks.row.showDetails'
// Whether the sidebar list rows show a small "Xm ago" badge with the
// list's last successful sync time. Off by default — the global pill
// covers the at-a-glance case; this is for users who want per-list
// timing visible at all times.
const KEY_SIDEBAR_SYNC_AGE = 'ete-sthetic.sidebar.showSyncAge'
// Rows of context kept visible above and below the selected/moved task
// when the tree auto-scrolls to follow it (priority bump, Alt+arrow
// reparent, keyboard navigation, drag-to-list). The auto-scroll skips
// when the row is already at least this many rows from the viewport
// edge — so an in-view selection never jumps. Range clamped to
// [0, 6] inclusive.
const KEY_SCROLL_HEADROOM = 'ete-sthetic.tasks.scrollHeadroom'
const DEFAULT_HEADROOM = 2
export const SCROLL_HEADROOM_MIN = 0
export const SCROLL_HEADROOM_MAX = 6

// How many rows a single Ctrl+↑/↓ shifts the selected task within its
// sibling group under manual sort (a bulk version of the Alt+Shift+↑/↓
// single-step swap). Clamped to [2, 50]; below 2 it's just the single-step
// chord, and a very large step is equivalent to "move to end".
const KEY_REORDER_STEP = 'ete-sthetic.tasks.reorderStep'
const DEFAULT_REORDER_STEP = 5
export const REORDER_STEP_MIN = 2
export const REORDER_STEP_MAX = 50

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — drop silently.
  }
}

// Defaults: both on. Counters are quiet enough not to be annoying out
// of the box, and surfacing progress on the parent row is the whole
// point.
export function readShowCompletedSubtaskCount(): boolean {
  return readBool(KEY_SHOW_COMPLETED, true)
}

export function setShowCompletedSubtaskCount(v: boolean): void {
  writeBool(KEY_SHOW_COMPLETED, v)
}

export function readShowTotalSubtaskCount(): boolean {
  return readBool(KEY_SHOW_TOTAL, true)
}

export function setShowTotalSubtaskCount(v: boolean): void {
  writeBool(KEY_SHOW_TOTAL, v)
}

// Details preview line. Off by default — the list stays compact unless
// the user opts in.
export function readShowTaskDetails(): boolean {
  return readBool(KEY_SHOW_DETAILS, false)
}

export function setShowTaskDetails(v: boolean): void {
  writeBool(KEY_SHOW_DETAILS, v)
}

export function readScrollHeadroom(): number {
  try {
    const raw = localStorage.getItem(KEY_SCROLL_HEADROOM)
    if (raw == null) return DEFAULT_HEADROOM
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_HEADROOM
    return Math.max(
      SCROLL_HEADROOM_MIN,
      Math.min(SCROLL_HEADROOM_MAX, Math.floor(n)),
    )
  } catch {
    return DEFAULT_HEADROOM
  }
}

export function readShowSidebarSyncAge(): boolean {
  return readBool(KEY_SIDEBAR_SYNC_AGE, false)
}

export function setShowSidebarSyncAge(v: boolean): void {
  writeBool(KEY_SIDEBAR_SYNC_AGE, v)
}

export function setScrollHeadroom(n: number): void {
  try {
    const clamped = Math.max(
      SCROLL_HEADROOM_MIN,
      Math.min(SCROLL_HEADROOM_MAX, Math.floor(n)),
    )
    localStorage.setItem(KEY_SCROLL_HEADROOM, String(clamped))
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Non-fatal.
  }
}

export function readReorderStep(): number {
  try {
    const raw = localStorage.getItem(KEY_REORDER_STEP)
    if (raw == null) return DEFAULT_REORDER_STEP
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_REORDER_STEP
    return Math.max(REORDER_STEP_MIN, Math.min(REORDER_STEP_MAX, Math.floor(n)))
  } catch {
    return DEFAULT_REORDER_STEP
  }
}

export function setReorderStep(n: number): void {
  try {
    const clamped = Math.max(
      REORDER_STEP_MIN,
      Math.min(REORDER_STEP_MAX, Math.floor(n)),
    )
    localStorage.setItem(KEY_REORDER_STEP, String(clamped))
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Non-fatal.
  }
}
