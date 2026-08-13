import type { TaskItem, TaskSort, TaskSortSpec } from '../types'
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

// Ascending field comparator for a single key. "No value goes last" for
// priority/due/manual (an item without the value sinks to the bottom);
// this rule is independent of the primary axis's reverse flag — it's
// applied here and the caller only flips the *primary* result, never the
// empty-last decision. Returns 0 when both items tie on this field.
function fieldCmp(
  sort: TaskSort,
): (a: TaskItem, b: TaskItem) => number {
  switch (sort) {
    case 'priority':
      return (a, b) => {
        const ra = priorityRank(a.todo.priority)
        const rb = priorityRank(b.todo.priority)
        if (ra === -Infinity && rb === -Infinity) return 0
        if (ra === -Infinity) return 1 // priority=none last
        if (rb === -Infinity) return -1
        return rb - ra // higher priority first
      }
    case 'due':
      return (a, b) => {
        const ma = dueMs(a.todo.due)
        const mb = dueMs(b.todo.due)
        const aHas = Number.isFinite(ma)
        const bHas = Number.isFinite(mb)
        if (!aHas && !bHas) return 0
        if (!aHas) return 1 // no due date last
        if (!bHas) return -1
        return ma - mb // soonest first
      }
    case 'manual':
      return (a, b) => {
        const oa = a.todo.sortOrder
        const ob = b.todo.sortOrder
        const aHas = oa != null
        const bHas = ob != null
        if (!aHas && !bHas) return 0
        if (!aHas) return 1 // un-ordered last
        if (!bHas) return -1
        return oa - ob
      }
    case 'summary':
      return tieBySummary
    case 'created':
    default:
      return tieByCreated
  }
}

// The tiebreaker chain used when items compare equal on the primary axis:
// the user-chosen secondary field (if any), then created, then title — so
// the order is always fully determined and stable.
function makeTiebreak(
  then: TaskSort | undefined,
): (a: TaskItem, b: TaskItem) => number {
  const secondary = then && then !== 'created' ? fieldCmp(then) : undefined
  return (a, b) => {
    if (secondary) {
      const c = secondary(a, b)
      if (c !== 0) return c
    }
    return tieByCreated(a, b) || tieBySummary(a, b)
  }
}

// Build a comparator from a sort spec. Reverse flips the primary axis but
// keeps the "no value goes last" rule intact (an empty due date still
// belongs at the bottom even when sorting due-desc — otherwise reversing
// would put it at the top, which is never useful). When two items tie on
// the primary axis the configurable `then` secondary breaks the tie.
export function comparatorFor(
  sortSpec: TaskSortSpec | undefined,
): (a: TaskItem, b: TaskItem) => number {
  const spec = sortSpec ?? DEFAULT_TASK_SORT
  const sign = spec.reverse ? -1 : 1
  // A secondary equal to the primary axis is redundant — drop it so the
  // chain falls straight through to created/title.
  const tie = makeTiebreak(spec.then === spec.sort ? undefined : spec.then)
  const primary = fieldCmp(spec.sort)

  return (a, b) => {
    const c = primary(a, b)
    // Empty-last sentinels (±1 when exactly one side lacks the value) must
    // not be reversed; only a real ordering difference flips with `sign`.
    if (c !== 0) {
      if (spec.sort === 'priority') {
        const aNone = a.todo.priority === 0
        const bNone = b.todo.priority === 0
        if (aNone !== bNone) return aNone ? 1 : -1
      } else if (spec.sort === 'due') {
        const aNone = !Number.isFinite(dueMs(a.todo.due))
        const bNone = !Number.isFinite(dueMs(b.todo.due))
        if (aNone !== bNone) return aNone ? 1 : -1
      } else if (spec.sort === 'manual') {
        const aNone = a.todo.sortOrder == null
        const bNone = b.todo.sortOrder == null
        if (aNone !== bNone) return aNone ? 1 : -1
      }
      return c * sign
    }
    return tie(a, b)
  }
}

const SORT_KEY_PREFIX = 'ete-sthetic.taskSort.'

export function readTaskSort(uid: string): TaskSortSpec {
  try {
    const raw = localStorage.getItem(SORT_KEY_PREFIX + uid)
    if (!raw) return DEFAULT_TASK_SORT
    const parsed = JSON.parse(raw) as Partial<TaskSortSpec>
    const isSort = (v: unknown): v is TaskSort =>
      v === 'priority' ||
      v === 'due' ||
      v === 'created' ||
      v === 'summary' ||
      v === 'manual'
    const sort = isSort(parsed.sort) ? parsed.sort : DEFAULT_TASK_SORT.sort
    // 'manual' is not a meaningful secondary; fall back to the default.
    const then =
      isSort(parsed.then) && parsed.then !== 'manual'
        ? parsed.then
        : DEFAULT_TASK_SORT.then
    return { sort, reverse: parsed.reverse === true, then }
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
