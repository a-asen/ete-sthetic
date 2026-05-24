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
