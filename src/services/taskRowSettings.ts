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

// Legacy preference: what plain Enter did when committing a new task.
// Kept for migration only — the UI now uses the split highlight/focus
// model below. Values:
//   'commit' = add and stay put
//   'follow' = add, then select + scroll to the new task
//   'open'   = add, then open the new task in the detail panel
export type NewTaskEnterMode = 'commit' | 'follow' | 'open'
const KEY_ENTER_MODE = 'ete-sthetic.tasks.newTaskEnterMode'
const ENTER_MODES: NewTaskEnterMode[] = ['commit', 'follow', 'open']

export function readNewTaskEnterMode(): NewTaskEnterMode {
  try {
    const raw = localStorage.getItem(KEY_ENTER_MODE)
    if (raw && (ENTER_MODES as string[]).includes(raw)) {
      return raw as NewTaskEnterMode
    }
  } catch {
    // fall through
  }
  return 'commit'
}

export function setNewTaskEnterMode(v: NewTaskEnterMode): void {
  try {
    localStorage.setItem(KEY_ENTER_MODE, v)
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — drop silently.
  }
}

// LEGACY resolver kept for any external callers that still import it.
// Prefer resolveNewTaskEnterAction, which is absolute and matches the
// new navigation settings.
export function resolveEnterAction(
  mode: NewTaskEnterMode,
  ctrl: boolean,
  shift: boolean,
): NewTaskEnterMode {
  if (ctrl) return mode === 'open' ? 'follow' : 'open'
  if (shift) return mode === 'follow' ? 'open' : 'follow'
  return mode
}

// ---- New task navigation preferences (post-migration) ----
//
// Two independent axes replace the old single three-way Enter mode:
//
//   * Highlight — after creating, does the selection stay where it was or
//     jump to the newly created task? ('stay' | 'follow')
//   * Focus     — after creating, does keyboard focus stay in the task
//     pane or move to the detail panel? ('stay' | 'details')
//
// The actual chord table is resolved by resolveNewTaskEnterAction():
//
//   Plain Enter        → highlight = highlightPref, target = focusPref
//   Shift+Enter        → if followNewTaskOnShiftEnter is on,
//                          force highlight = 'follow' (target unchanged)
//                        otherwise same as plain Enter
//   Ctrl/Cmd+Enter     → force target = 'details' and highlight = 'follow'
//                        (opening the panel implies selecting the new task)
//
// Plain Enter NEVER moves the highlight by default (new invariant).

export type NewTaskHighlight = 'stay' | 'follow'
const KEY_NEW_TASK_HIGHLIGHT = 'ete-sthetic.tasks.newTaskHighlight'

export type NewTaskFocus = 'stay' | 'details'
const KEY_NEW_TASK_FOCUS = 'ete-sthetic.tasks.newTaskFocus'

export type NewTaskEnterAction = {
  highlight: NewTaskHighlight
  target: NewTaskFocus
}

// Whether Shift+Enter overrides the highlight preference and forces
// "follow the new task" when creating. Default true so the quick "commit
// and jump" path is one keystroke away.
const KEY_FOLLOW_ON_SHIFT_ENTER =
  'ete-sthetic.tasks.followNewTaskOnShiftEnter'

// After a stay-put commit, return keyboard focus to the quick-add / inline
// input so the user can keep typing. Default TRUE: currently a root commit
// via QuickAdd leaves focus in the quick-add row already, and re-focusing
// the same input is the least surprising continuation for rapid entry.
const KEY_AUTO_FOCUS_QUICK_ADD = 'ete-sthetic.tasks.autoFocusQuickAdd'

function migrateEnterModeIfNeeded(): void {
  // One-time migration from the old single three-way setting to the new
  // split settings. If the old key exists and neither new key has been
  // written yet, derive sensible defaults and drop the old key.
  const old = readNewTaskEnterMode()
  const hasHighlight = localStorage.getItem(KEY_NEW_TASK_HIGHLIGHT) !== null
  const hasFocus = localStorage.getItem(KEY_NEW_TASK_FOCUS) !== null
  if (hasHighlight || hasFocus) return
  // Plain Enter never moves selection in the new model, so the old 'follow'
  // preference migrates to highlight=stay with the Shift override still on.
  const highlight: NewTaskHighlight =
    old === 'follow' ? 'stay' : old === 'open' ? 'stay' : 'stay'
  const target: NewTaskFocus =
    old === 'open' ? 'details' : old === 'follow' ? 'stay' : 'stay'
  try {
    localStorage.setItem(KEY_NEW_TASK_HIGHLIGHT, highlight)
    localStorage.setItem(KEY_NEW_TASK_FOCUS, target)
    // Keep Shift+Enter as the follow override for users coming from the
    // old "follow" mode; users who picked "commit" also get the override on
    // so the behaviour is still reachable.
    localStorage.setItem(KEY_FOLLOW_ON_SHIFT_ENTER, 'true')
    localStorage.removeItem(KEY_ENTER_MODE)
  } catch {
    // Non-fatal — the next read will just fall back to defaults.
  }
}

export function readNewTaskHighlight(): NewTaskHighlight {
  migrateEnterModeIfNeeded()
  try {
    const raw = localStorage.getItem(KEY_NEW_TASK_HIGHLIGHT)
    if (raw === 'stay' || raw === 'follow') return raw
  } catch {
    // fall through
  }
  return 'stay'
}

export function setNewTaskHighlight(v: NewTaskHighlight): void {
  try {
    localStorage.setItem(KEY_NEW_TASK_HIGHLIGHT, v)
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Non-fatal.
  }
}

export function readNewTaskFocus(): NewTaskFocus {
  migrateEnterModeIfNeeded()
  try {
    const raw = localStorage.getItem(KEY_NEW_TASK_FOCUS)
    if (raw === 'stay' || raw === 'details') return raw
  } catch {
    // fall through
  }
  return 'stay'
}

export function setNewTaskFocus(v: NewTaskFocus): void {
  try {
    localStorage.setItem(KEY_NEW_TASK_FOCUS, v)
    window.dispatchEvent(new CustomEvent(TASK_ROW_SETTINGS_CHANGED_EVENT))
  } catch {
    // Non-fatal.
  }
}

export function readFollowNewTaskOnShiftEnter(): boolean {
  migrateEnterModeIfNeeded()
  return readBool(KEY_FOLLOW_ON_SHIFT_ENTER, true)
}

export function setFollowNewTaskOnShiftEnter(v: boolean): void {
  writeBool(KEY_FOLLOW_ON_SHIFT_ENTER, v)
}

// After a stay-put commit, should the quick-add / inline input re-receive
// focus so the user can keep typing? Default TRUE because that matches the
// current QuickAdd behaviour and is the most natural rapid-entry default.
export function readAutoFocusQuickAdd(): boolean {
  return readBool(KEY_AUTO_FOCUS_QUICK_ADD, true)
}

export function setAutoFocusQuickAdd(v: boolean): void {
  writeBool(KEY_AUTO_FOCUS_QUICK_ADD, v)
}

// Resolve what an Enter press should do in a new-task input from the
// current navigation settings plus held modifiers. This is the single
// source of truth for the create-input chord table.
export function resolveNewTaskEnterAction(
  ctrl: boolean,
  shift: boolean,
): NewTaskEnterAction {
  const highlightPref = readNewTaskHighlight()
  const targetPref = readNewTaskFocus()
  const followOnShift = readFollowNewTaskOnShiftEnter()

  if (ctrl) {
    // Opening details implies selecting the new task.
    return { highlight: 'follow', target: 'details' }
  }
  if (shift && followOnShift) {
    // Follow override: jump to the new task while keeping the target zone
    // preference (the default is "stay in task pane").
    return { highlight: 'follow', target: targetPref }
  }
  // Plain Enter (or Shift+Enter when the override is off) uses the prefs.
  return { highlight: highlightPref, target: targetPref }
}

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
