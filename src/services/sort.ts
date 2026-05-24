import type { TaskItem, TaskSortSpec } from '../types'
import { DEFAULT_TASK_SORT } from '../types'

// Priority normalisation: VTODO priority 0 = "none" — should always come
// LAST regardless of asc/desc. 1 is highest, 9 is lowest. We map them to a
// space where higher number = sorted-earlier so the comparator is simple
// and the priority=0 case never breaks the ordering.
function priorityRank(p: number): number {
  if (p === 0) return -Infinity
  return 10 - p
}

function tieByCreated(a: TaskItem, b: TaskItem): number {
  const at = a.todo.created ? Date.parse(a.todo.created) : NaN
  const bt = b.todo.created ? Date.parse(b.todo.created) : NaN
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
    return at - bt
  }
  return 0
}

function tieBySummary(a: TaskItem, b: TaskItem): number {
  return a.todo.summary.localeCompare(b.todo.summary, undefined, {
    sensitivity: 'base',
  })
}

// VTODO `due` looks like "20260520" (date) or "20260520T140000Z"
// (datetime). Parse to a sortable epoch ms.
function dueMs(due: string | undefined): number {
  if (!due) return NaN
  const m = due.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return NaN
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getTime()
}

// Build a comparator from a sort spec. Reverse flips the primary axis but
// keeps the "no value goes last" rule intact (an empty due date still
// belongs at the bottom even when sorting due-desc — otherwise reversing
// would put it at the top, which is never useful).
export function comparatorFor(
  sortSpec: TaskSortSpec | undefined,
): (a: TaskItem, b: TaskItem) => number {
  const spec = sortSpec ?? DEFAULT_TASK_SORT
  const sign = spec.reverse ? -1 : 1

  switch (spec.sort) {
    case 'priority':
      return (a, b) => {
        const ra = priorityRank(a.todo.priority)
        const rb = priorityRank(b.todo.priority)
        // priority=0 always last regardless of reverse.
        if (ra === -Infinity && rb !== -Infinity) return 1
        if (rb === -Infinity && ra !== -Infinity) return -1
        if (ra !== rb) return (rb - ra) * sign
        return tieByCreated(a, b) || tieBySummary(a, b)
      }
    case 'due':
      return (a, b) => {
        const ma = dueMs(a.todo.due)
        const mb = dueMs(b.todo.due)
        const aHas = Number.isFinite(ma)
        const bHas = Number.isFinite(mb)
        if (aHas && !bHas) return -1
        if (bHas && !aHas) return 1
        if (aHas && bHas && ma !== mb) return (ma - mb) * sign
        return tieByCreated(a, b) || tieBySummary(a, b)
      }
    case 'summary':
      return (a, b) => {
        const cmp = tieBySummary(a, b)
        if (cmp !== 0) return cmp * sign
        return tieByCreated(a, b)
      }
    case 'created':
    default:
      return (a, b) => {
        const cmp = tieByCreated(a, b)
        if (cmp !== 0) return cmp * sign
        return tieBySummary(a, b)
      }
  }
}

const SORT_KEY_PREFIX = 'ete-sthetic.taskSort.'

export function readTaskSort(uid: string): TaskSortSpec {
  try {
    const raw = localStorage.getItem(SORT_KEY_PREFIX + uid)
    if (!raw) return DEFAULT_TASK_SORT
    const parsed = JSON.parse(raw) as Partial<TaskSortSpec>
    const sort =
      parsed.sort === 'priority' ||
      parsed.sort === 'due' ||
      parsed.sort === 'created' ||
      parsed.sort === 'summary'
        ? parsed.sort
        : DEFAULT_TASK_SORT.sort
    return { sort, reverse: parsed.reverse === true }
  } catch {
    return DEFAULT_TASK_SORT
  }
}

export function writeTaskSort(uid: string, spec: TaskSortSpec) {
  try {
    localStorage.setItem(SORT_KEY_PREFIX + uid, JSON.stringify(spec))
  } catch {
    // not fatal
  }
}
