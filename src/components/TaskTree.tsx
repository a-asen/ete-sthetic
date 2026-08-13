import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Priority, TaskNode } from '../types'
import { findParentAndSiblings, flattenVisible } from '../services/tree'
import { humanizeRrule } from '../services/rrule'
import {
  TASK_ROW_SETTINGS_CHANGED_EVENT,
  readReorderStep,
  readScrollHeadroom,
  readShowCompletedSubtaskCount,
  readShowTaskDetails,
  readShowTotalSubtaskCount,
} from '../services/taskRowSettings'

// Walk up from `el` to find the nearest scrolling ancestor. The task
// pane has overflow-y-auto on the wrapper that holds the tree; that's
// the one we want to drive. Falls back to document scrollingElement
// if no ancestor scrolls (unlikely but safe).
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur)
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur
    }
    cur = cur.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

// Scroll `el` into view while keeping `headroom` rows of context above
// and below the viewport edge. Already-comfortably-visible rows never
// jump — only rows within `headroom` of an edge (or off-screen) cause
// a scroll. Special-cases the top of the list: if the row is in the
// first `headroom` slots of the visible list, snap to the top so the
// list header isn't hidden behind the headroom band.
function scrollWithHeadroom(el: HTMLElement, headroom: number): void {
  const scroller = findScrollContainer(el)
  if (!scroller) {
    el.scrollIntoView({ block: 'nearest' })
    return
  }
  const rowH = el.offsetHeight || 32
  const scrollerRect = scroller.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  // Position of `el`'s top edge within the scroller's content box.
  const elTopInContent = elRect.top - scrollerRect.top + scroller.scrollTop
  const elBottomInContent = elTopInContent + elRect.height
  const viewTop = scroller.scrollTop
  const viewBottom = viewTop + scroller.clientHeight
  const padPx = Math.max(0, headroom) * rowH

  if (elTopInContent < viewTop + padPx) {
    // Above the headroom band — scroll up so `el` is `padPx` below the
    // top. Clamped to 0 so the top of the list doesn't get hidden.
    const next = Math.max(0, elTopInContent - padPx)
    if (next !== scroller.scrollTop) scroller.scrollTop = next
  } else if (elBottomInContent > viewBottom - padPx) {
    // Below the headroom band — scroll down so `el`'s bottom is
    // `padPx` above the visible floor.
    const next =
      elBottomInContent - scroller.clientHeight + padPx
    if (next !== scroller.scrollTop) scroller.scrollTop = next
  }
  // Otherwise the row is comfortably in the centre band — don't scroll.
}

function bumpPriority(current: Priority, delta: 1 | -1): Priority {
  // delta 1 = "more important" (toward 1). delta -1 = "less important".
  if (delta === 1) {
    // Starting from "none", the first bump is the *lowest* real
    // priority; subsequent bumps step toward highest.
    if (current === 0) return 9
    return Math.max(1, current - 1) as Priority
  }
  if (current === 0 || current === 9) return current
  return (current + 1) as Priority
}

// Phone-friendly version: snaps to the four RFC-recommended buckets
// (None/High/Medium/Low → 0/1/5/9) instead of stepping through every
// numeric value. Same direction semantics as bumpPriority.
function bumpPriorityPhone(current: Priority, delta: 1 | -1): Priority {
  const bucket: Priority =
    current === 0 ? 0 : current <= 4 ? 1 : current === 5 ? 5 : 9
  if (delta === 1) {
    // more important: None → Low → Medium → High (stays at High)
    if (bucket === 0) return 9
    if (bucket === 9) return 5
    if (bucket === 5) return 1
    return 1
  }
  // less important: High → Medium → Low → None
  if (bucket === 1) return 5
  if (bucket === 5) return 9
  if (bucket === 9) return 0
  return 0
}

interface Props {
  roots: TaskNode[]
  selectedUid: string | null
  onSelectChange: (uid: string | null) => void
  // Multi-selection: the full set of selected VTODO uids (always includes
  // `selectedUid`, the cursor, when non-empty). Size ≤ 1 behaves as a plain
  // single selection. `anchorUid` is the fixed end of a Shift-range; range
  // extension is computed here (only the tree knows the flat visible order)
  // and reported via `onSelectRange`.
  selectedUids?: ReadonlySet<string>
  anchorUid?: string | null
  onSelectRange?: (uids: string[], cursor: string) => void
  // Ctrl/Cmd+click toggles a single uid in/out of the selection.
  onToggleSelect?: (uid: string) => void
  inactive?: boolean
  onToggleComplete?: (node: TaskNode) => void
  // Cycles status (needs-action → in-progress → completed → …). Used by
  // both Enter / Ctrl+Enter and the checkbox click; onToggleComplete is the
  // binary fallback when no cycle handler is wired.
  onCycleStatus?: (node: TaskNode) => void
  // Multi-select Enter: cycle every selected row to the same next status,
  // derived from the cursor. Falls back to onCycleStatus for a single row.
  onCycleStatusSelected?: (cursor: TaskNode, selected: TaskNode[]) => void
  pendingUids?: ReadonlySet<string>
  creatingParent?: string | null
  onAddChild?: (parent: TaskNode) => void
  onConfirmCreate?: (summary: string) => void
  onConfirmCreateAndOpen?: (summary: string) => void
  onCancelCreate?: () => void
  // Persistent quick-add row at the top of the list (root tasks).
  onQuickAdd?: (summary: string) => void
  onQuickAddAndOpen?: (summary: string) => void
  quickAddRef?: React.Ref<HTMLInputElement>
  onRenameTask?: (node: TaskNode, newSummary: string) => void
  onDeleteRequest?: (node: TaskNode) => void
  onChangePriority?: (node: TaskNode, priority: Priority) => void
  // Multi-select +/−: bump every selected row's priority in one batch.
  // Each entry carries that row's already-computed target priority.
  onChangePrioritySelected?: (
    updates: Array<{ node: TaskNode; priority: Priority }>,
  ) => void
  // Right-click on a task row → caller opens a context menu at x,y.
  onRowContextMenu?: (node: TaskNode, x: number, y: number) => void
  // When set, task rows are draggable and carry their VTODO uid under
  // this mime type (a sidebar list can accept the drop to move it).
  taskDndMime?: string
  // When true (active sort is 'manual'), rows also accept drops from
  // sibling rows to reposition: dropping a dragged task onto the
  // top/bottom half of a row places it before/after that row.
  manualReorder?: boolean
  onReorderDrop?: (
    draggedUid: string,
    targetUid: string,
    place: 'before' | 'after',
  ) => void
  // Drop a dragged task onto the middle band of a row → reparent it (and any
  // multi-selection it belongs to) as a child of that row. Works under any
  // sort, unlike onReorderDrop which is manual-sort sibling repositioning.
  onReparentDrop?: (draggedUid: string, targetUid: string) => void
  // Bulk sibling reorder: move the selected task `step` rows up (-1) or
  // down (+1) within its sibling group, clamped to the group ends. Only
  // wired under manual sort; when set, it takes over the Ctrl+↑/↓ chord
  // (which otherwise pages the selection). The step comes from settings.
  onReorderBySteps?: (direction: -1 | 1, step: number) => void
  // Called when ArrowLeft is pressed on a top-level row that's already
  // collapsed (or a leaf with no parent). Lets the caller decide what
  // "leaving the tree to the left" means — typically focus the sidebar.
  onLeaveLeft?: () => void
  // uid → removal timestamp (ms). Rows in this map are in the grace
  // window: they stay visible (solid) and show a countdown until removal.
  fadingExpires?: ReadonlyMap<string, number>
  // The subset of `fadingExpires` rows currently in their fade-out
  // animation (the tail of the grace window). Staggered down a branch so
  // a completed subtree clears bottom-up.
  activelyFading?: ReadonlySet<string>
  // Per-branch "show completed" peek. `branchDoneHidden` maps a uid to
  // the count of its completed descendants hidden by Hide-done; a row
  // with a positive count (or one already revealed) shows a control to
  // reveal that branch's completed tasks inline. `revealedBranches` is
  // the set currently revealed.
  branchDoneHidden?: ReadonlyMap<string, number>
  revealedBranches?: ReadonlySet<string>
  onToggleBranchReveal?: (uid: string) => void
  // When true, +/- snap between the four RFC priority buckets instead
  // of stepping one level at a time. Mirrors the detail panel's
  // phone-friendly dropdown.
  phonePriority?: boolean
}

// Map a typed digit to a priority value. In phone mode only 0–3 are
// meaningful (None/High/Medium/Low → 0/1/5/9, the RFC bucket reps);
// other digits return null and are ignored. Otherwise 0–9 map straight
// through to the RFC numeric priority.
function digitToPriority(key: string, phone: boolean): Priority | null {
  if (key < '0' || key > '9') return null
  const n = Number(key)
  if (phone) {
    if (n === 0) return 0
    if (n === 1) return 1
    if (n === 2) return 5
    if (n === 3) return 9
    return null
  }
  return n as Priority
}

// Priority tier for the row tint: null = untinted.
function priorityTier(p: number): 'high' | 'med' | 'low' | null {
  if (p === 0) return null
  if (p <= 4) return 'high'
  if (p === 5) return 'med'
  return 'low'
}

const INPUT_PLACEHOLDER = 'New task — Enter to add, Esc to cancel'

function InlineCreate({
  depth,
  centered = false,
  onConfirm,
  onCancel,
  onConfirmAndOpen,
}: {
  depth: number
  // Root creates render as a centred "compose" box in the task pane;
  // subtask creates stay inline at their indent.
  centered?: boolean
  onConfirm: (summary: string) => void
  onCancel: () => void
  // Ctrl/Cmd+→ while typing: commit this (sub)task and follow it into
  // the detail panel, instead of the global handler opening the parent.
  onConfirmAndOpen?: (summary: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = inputRef.current?.value.trim() ?? ''
      if (!value) {
        onCancel()
        return
      }
      // Ctrl/Cmd+Enter commits this (sub)task and follows it into details;
      // plain Enter just commits. stopPropagation on the chord so the
      // global Ctrl+Enter handler doesn't also fire (it would open the
      // *parent's* detail). Ctrl+←/→ are left to the browser as native
      // word-jump so they never create the task or destroy a draft.
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation()
        if (onConfirmAndOpen) onConfirmAndOpen(value)
        else onConfirm(value)
      } else {
        onConfirm(value)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
      // Bare ArrowLeft on an empty input cancels (mirrors ArrowRight to
      // start). With any text in the field, this is a normal cursor move.
      // Ctrl/Cmd+ArrowLeft is native word-jump and must never cancel.
      const input = e.currentTarget
      if (input.value.length === 0) {
        e.preventDefault()
        onCancel()
      }
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const value = e.target.value.trim()
    if (value) onConfirm(value)
    else onCancel()
  }

  if (centered) {
    return (
      <li className="px-3 py-6">
        <div className="mx-auto w-full max-w-md rounded-lg border border-accent/40 bg-surface-2 px-3 py-2 shadow-sm">
          <input
            ref={inputRef}
            type="text"
            spellCheck
            placeholder={INPUT_PLACEHOLDER}
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
            onKeyDown={handleKey}
            onBlur={handleBlur}
          />
        </div>
      </li>
    )
  }

  return (
    <li
      className="flex items-center gap-2 px-3 py-1.5"
      style={{ paddingLeft: 12 + depth * 20 }}
    >
      <span className="h-4 w-4 shrink-0" aria-hidden />
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 rounded-sm border border-border-strong"
      />
      <input
        ref={inputRef}
        type="text"
        spellCheck
        placeholder={INPUT_PLACEHOLDER}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
        onKeyDown={handleKey}
        onBlur={handleBlur}
      />
    </li>
  )
}

// Permanent compact "add task" row pinned at the top of the list. Unlike
// InlineCreate it doesn't auto-focus or cancel on blur — it's always
// present; Enter adds the task and clears the field so several can be
// entered in a row. Exposes its input via ref so `n` can focus it.
const QuickAdd = forwardRef<
  HTMLInputElement,
  {
    onConfirm: (summary: string) => void
    onConfirmAndOpen?: (summary: string) => void
  }
>(function QuickAdd({ onConfirm, onConfirmAndOpen }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [])

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = inputRef.current?.value.trim() ?? ''
      if (!value) return
      // Ctrl/Cmd+Enter commits and follows into details; plain Enter just
      // commits. stopPropagation on the chord so the global Ctrl+Enter
      // handler doesn't also fire. Ctrl+←/→ stay as native word-jump.
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation()
        if (onConfirmAndOpen) onConfirmAndOpen(value)
        else onConfirm(value)
      } else {
        onConfirm(value)
      }
      if (inputRef.current) inputRef.current.value = ''
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (inputRef.current) inputRef.current.value = ''
      inputRef.current?.blur()
    }
  }

  return (
    <li className="sticky top-0 z-10 bg-bg px-3 pb-1.5 pt-1">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-2 py-1 transition-colors focus-within:border-accent/50">
        <span aria-hidden className="shrink-0 text-text-faint">
          +
        </span>
        <input
          ref={inputRef}
          type="text"
          spellCheck
          placeholder="Add task — Enter to add"
          aria-label="Add task"
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          onKeyDown={handleKey}
        />
      </div>
    </li>
  )
})

const INDENT_PX = 20

// A due value renders as a date label plus, when the value carries a
// non-midnight time component, a separate `time` unit so date and time read
// apart at a glance (e.g. `31 May · 12:00`).
type DueParts = { label: string; time: string | null }

function formatDue(due: string | undefined): DueParts | null {
  if (!due) return null
  // ical.js writes the compact iCal form ("20260520", "20260520T140000Z"),
  // but legacy / imported items may carry the hyphenated ISO form
  // ("2026-05-20", "2026-05-20T12:00:00"). Accept both shapes.
  const m = due.match(
    /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2})(?::?\d{2})?)?/,
  )
  if (!m) return { label: due, time: null }
  const [, yyyy, mm, dd, hh, min] = m
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`)
  if (Number.isNaN(date.getTime())) return { label: due, time: null }

  // Treat exactly midnight as an all-day / date-only value.
  const time = hh != null && !(hh === '00' && min === '00') ? `${hh}:${min}` : null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )
  let label: string
  if (diffDays === 0) label = 'today'
  else if (diffDays === 1) label = 'tomorrow'
  else if (diffDays === -1) label = 'yesterday'
  else if (diffDays > 1 && diffDays <= 7) label = `in ${diffDays}d`
  else if (diffDays < -1 && diffDays >= -7) label = `${Math.abs(diffDays)}d ago`
  else
    label = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  return { label, time }
}

function priorityLabel(p: number): string | null {
  if (p === 0) return null
  if (p <= 4) return 'high'
  if (p === 5) return 'med'
  return 'low'
}

function priorityClasses(p: number): string {
  if (p === 0) return ''
  if (p <= 4) return 'text-danger/80 border-danger/30 bg-danger/5'
  if (p === 5) return 'text-text-muted border-border-strong bg-surface-2'
  return 'text-text-faint border-border bg-surface-2'
}

export function TaskTree({
  roots,
  selectedUid,
  onSelectChange,
  selectedUids,
  anchorUid,
  onSelectRange,
  onToggleSelect,
  inactive = false,
  onToggleComplete,
  onCycleStatus,
  onCycleStatusSelected,
  pendingUids,
  creatingParent,
  onAddChild,
  onConfirmCreate,
  onConfirmCreateAndOpen,
  onCancelCreate,
  onQuickAdd,
  onQuickAddAndOpen,
  quickAddRef,
  onRenameTask,
  onDeleteRequest,
  onChangePriority,
  onChangePrioritySelected,
  onRowContextMenu,
  taskDndMime,
  manualReorder = false,
  onReorderDrop,
  onReparentDrop,
  onReorderBySteps,
  onLeaveLeft,
  fadingExpires,
  activelyFading,
  branchDoneHidden,
  revealedBranches,
  onToggleBranchReveal,
  phonePriority = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Default: expand all roots one level
    const initial = new Set<string>()
    for (const r of roots) initial.add(r.todo.uid)
    return initial
  })
  const selected = selectedUid
  const setSelected = onSelectChange
  const [editingUid, setEditingUid] = useState<string | null>(null)
  // Row the mouse is currently over — target for the 0–9 priority keys
  // (falls back to the keyboard selection when nothing is hovered).
  const [hoveredUid, setHoveredUid] = useState<string | null>(null)
  // Active drag-to-reposition target: which row, and whether the drop
  // lands above or below it. Drives the insertion-line indicator.
  const [dropHint, setDropHint] = useState<{
    uid: string
    place: 'before' | 'after' | 'child'
  } | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  // Settings: "show completed subtask count" / "show total subtask count"
  // on parent rows. Re-read on the broadcast event so a toggle in the
  // settings popover takes effect without remount.
  const [showCompletedSub, setShowCompletedSub] = useState(
    readShowCompletedSubtaskCount,
  )
  const [showTotalSub, setShowTotalSub] = useState(
    readShowTotalSubtaskCount,
  )
  const [showDetails, setShowDetails] = useState(readShowTaskDetails)
  // Rows of context kept around the selected/moved row when the tree
  // auto-scrolls. Stored in a ref because every scroll path reads it
  // synchronously inside an effect — using state here would force a
  // re-render on every flip and a stale closure during a fast move.
  const headroomRef = useRef(readScrollHeadroom())
  useEffect(() => {
    const refresh = () => {
      setShowCompletedSub(readShowCompletedSubtaskCount())
      setShowTotalSub(readShowTotalSubtaskCount())
      setShowDetails(readShowTaskDetails())
      headroomRef.current = readScrollHeadroom()
    }
    window.addEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
  }, [])
  // Recursive descendant counts (completed + total) per uid. Skips
  // leaves (no children → no entry in the map → no counter painted).
  // Recomputed whenever the tree shape changes; one walk per render
  // pass at most.
  const subtaskCounts = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>()
    const walk = (n: TaskNode): { done: number; total: number } => {
      let done = 0
      let total = 0
      for (const c of n.children) {
        total += 1
        if (c.todo.status === 'COMPLETED') done += 1
        const inner = walk(c)
        done += inner.done
        total += inner.total
      }
      if (n.children.length > 0) map.set(n.todo.uid, { done, total })
      return { done, total }
    }
    for (const r of roots) walk(r)
    return map
  }, [roots])

  useEffect(() => {
    if (editingUid && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingUid])

  // Clear the reposition indicator if a drag ends anywhere (dropped off a
  // row, or cancelled) — onDragLeave alone misses those exits.
  useEffect(() => {
    const clear = () => setDropHint(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  // Ticked clock for the grace-window countdown. Idle when nothing's
  // counting down; holding it in state keeps render pure (no Date.now()).
  const fadingActive = !!fadingExpires && fadingExpires.size > 0
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!fadingActive) return
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [fadingActive])

  // Auto-expand the parent we're creating under so its new child input is visible.
  useEffect(() => {
    if (creatingParent && creatingParent !== null) {
      setExpanded((prev) => {
        if (prev.has(creatingParent)) return prev
        const next = new Set(prev)
        next.add(creatingParent)
        return next
      })
    }
  }, [creatingParent])

  const visible = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])

  // Keep the selected task visible by FOLLOWING it. If the selection drops
  // out of `visible` (typical cause: reparented into a collapsed branch via
  // Alt+→ / Alt+arrow / move-pick / drag), expand its collapsed ancestors
  // so it comes back into view — rather than bumping the selection up to
  // the hidden parent, which made "where did my task go?" the default.
  // Manual collapses are handled in `toggle` (it re-selects the collapsed
  // node), so this won't fight the user closing a branch. If the selected
  // uid isn't anywhere in `roots` (filtered out by hide-completed /
  // search), there are no ancestors to expand and we leave it alone.
  useEffect(() => {
    if (!selected) return
    const visibleUids = new Set(visible.map((n) => n.todo.uid))
    if (visibleUids.has(selected)) return
    const ancestors: string[] = []
    let cursor = selected
    // Cycle guard: buildTree already breaks cycles, but be defensive.
    for (let i = 0; i < 64; i++) {
      const loc = findParentAndSiblings(roots, cursor)
      if (!loc || !loc.parent) break
      ancestors.push(loc.parent.todo.uid)
      cursor = loc.parent.todo.uid
    }
    if (ancestors.length === 0) return
    setExpanded((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const a of ancestors)
        if (!next.has(a)) {
          next.add(a)
          changed = true
        }
      return changed ? next : prev
    })
  }, [selected, visible, roots])

  // Index of the selected row in the currently rendered flat list.
  // Watching this lets the scroll-into-view effect also fire when the
  // row's *position* changes (priority bump, Alt+arrow reparent, drag-
  // and-drop) — not just when the selected uid itself changes. Without
  // this the highlight tracks the right row but the viewport stays put.
  const selectedIndex = useMemo(() => {
    if (!selected) return -1
    return visible.findIndex((n) => n.todo.uid === selected)
  }, [selected, visible])

  // When selection changes — or when the tree becomes the active zone
  // again after a trip through the sidebar / detail panel — focus the row
  // and scroll it into view so Enter lands on it. Also fires when the
  // selected row's position changes within the visible list (so a
  // priority bump that reorders the row keeps it on screen). Skip if
  // focus is in a typing element so we don't disrupt inline editing or
  // the create-task input.
  useEffect(() => {
    if (inactive) return
    if (!selected) return
    if (selectedIndex < 0) return
    const el = document.querySelector(
      `[data-task-uid="${CSS.escape(selected)}"]`,
    ) as HTMLElement | null
    if (!el) return
    const active = document.activeElement
    const isTypingTarget =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    if (!isTypingTarget) el.focus({ preventScroll: true })
    scrollWithHeadroom(el, headroomRef.current)
  }, [selected, selectedIndex, inactive])

  // Single keyboard handler for the tree: arrows, Enter, Del/Backspace.
  // Skipped while typing in any input/textarea or while a modal is open.
  useEffect(() => {
    if (inactive) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return
      // Ctrl/Cmd+A on the selected row starts inline rename — an alias
      // for F2. Handled here (not MainView) so it stays an event-handler
      // setState, and only when the tree is the active zone.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'a' || e.key === 'A')
      ) {
        if (editingUid || document.querySelector('[role="dialog"]')) return
        if (selected && onRenameTask) {
          e.preventDefault()
          setEditingUid(selected)
        }
        return
      }
      // Ctrl/Cmd + ArrowUp/Down. Under manual sort (and with a selection),
      // this is a *bulk sibling reorder* — shift the selected task N rows
      // within its group in one keystroke, clamped to the group ends. Under
      // any other sort it falls back to paging the selection (alias for
      // PageUp/PageDown). Handled here, before the generic modifier
      // bail-out below.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      ) {
        if (editingUid || document.querySelector('[role="dialog"]')) return
        if (!e.shiftKey && manualReorder && selected && onReorderBySteps) {
          e.preventDefault()
          onReorderBySteps(e.key === 'ArrowUp' ? -1 : 1, readReorderStep())
          return
        }
        if (visible.length === 0) return
        e.preventDefault()
        const cur = selected
          ? visible.findIndex((n) => n.todo.uid === selected)
          : -1
        const PAGE = 10
        const next =
          e.key === 'ArrowDown'
            ? cur < 0
              ? 0
              : Math.min(visible.length - 1, cur + PAGE)
            : cur <= 0
              ? 0
              : Math.max(0, cur - PAGE)
        setSelected(visible[next].todo.uid)
        return
      }
      // Modifier-key chords are handled by MainView (Ctrl+Enter to enter
      // details, Ctrl+F for filter, etc.). The tree owns plain keys only,
      // so bail out before we treat Ctrl+Enter as "toggle done".
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (editingUid) return
      if (document.querySelector('[role="dialog"]')) return
      // Empty list: still let ArrowLeft escape back to the sidebar so the
      // user isn't stranded on a list with no tasks. Other keys (Down/Up,
      // Enter, etc.) have nothing to act on so we drop them.
      if (visible.length === 0) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onLeaveLeft?.()
        }
        return
      }

      const idx = selected
        ? visible.findIndex((n) => n.todo.uid === selected)
        : -1

      // Extend the multi-selection so it spans from the anchor row to
      // `cursorIdx` over the visible flat list, with `cursorIdx` becoming
      // the new cursor. Falls back to the cursor as anchor when the stored
      // anchor has scrolled out of `visible` (e.g. its branch collapsed).
      const extendSelection = (cursorIdx: number) => {
        if (!onSelectRange) return
        const a = anchorUid ?? selected
        const anchorIdx = a
          ? visible.findIndex((n) => n.todo.uid === a)
          : -1
        const base = anchorIdx < 0 ? cursorIdx : anchorIdx
        const lo = Math.min(base, cursorIdx)
        const hi = Math.max(base, cursorIdx)
        onSelectRange(
          visible.slice(lo, hi + 1).map((n) => n.todo.uid),
          visible[cursorIdx].todo.uid,
        )
      }

      // Bump priority by one step. With a multi-selection that includes the
      // cursor, every selected row moves together (each by its own current
      // priority); otherwise just the cursor row, mirroring Enter's
      // single-vs-group split above.
      const bump = (delta: 1 | -1) => {
        if (idx < 0 || !onChangePriority) return
        e.preventDefault()
        const cursorNode = visible[idx]
        const nextFor = (n: TaskNode) =>
          phonePriority
            ? bumpPriorityPhone(n.todo.priority, delta)
            : bumpPriority(n.todo.priority, delta)
        const multi =
          onChangePrioritySelected &&
          selectedUids &&
          selectedUids.size > 1 &&
          selectedUids.has(cursorNode.todo.uid)
        if (multi) {
          const updates = visible
            .filter((n) => selectedUids.has(n.todo.uid))
            .map((n) => ({ node: n, priority: nextFor(n) }))
            .filter((u) => u.priority !== u.node.todo.priority)
          if (updates.length > 0) onChangePrioritySelected(updates)
        } else {
          const next = nextFor(cursorNode)
          if (next !== cursorNode.todo.priority) {
            onChangePriority(cursorNode, next)
          }
        }
      }

      // 0–9 set priority directly on the hovered row (or the selected
      // row when nothing is hovered).
      const typedPriority = digitToPriority(e.key, !!phonePriority)
      if (typedPriority !== null && onChangePriority) {
        const targetUid = hoveredUid ?? selected
        const node = targetUid
          ? visible.find((n) => n.todo.uid === targetUid)
          : undefined
        if (node) {
          e.preventDefault()
          if (node.todo.priority !== typedPriority) {
            onChangePriority(node, typedPriority)
          }
          return
        }
      }

      switch (e.key) {
        case 'ArrowDown': {
          // Shift+↓ extends the multi-selection from the anchor to the new
          // cursor over the visible flat order. Plain ↓ moves the single
          // selection. (Manual-sort reorder moved to Alt+Shift+↓, owned by
          // MainView's window handler.)
          e.preventDefault()
          const next = idx < 0 ? 0 : Math.min(visible.length - 1, idx + 1)
          if (e.shiftKey && onSelectRange) {
            extendSelection(next)
          } else {
            setSelected(visible[next].todo.uid)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = idx <= 0 ? 0 : idx - 1
          if (e.shiftKey && onSelectRange) {
            extendSelection(prev)
          } else {
            setSelected(visible[prev].todo.uid)
          }
          break
        }
        case 'ArrowLeft': {
          if (idx < 0) return
          e.preventDefault()
          const node = visible[idx]
          if (node.children.length > 0 && expanded.has(node.todo.uid)) {
            setExpanded((p) => {
              const next = new Set(p)
              next.delete(node.todo.uid)
              return next
            })
          } else if (node.todo.parentUid) {
            setSelected(node.todo.parentUid)
          } else {
            // Already at the leftmost (top-level, collapsed-or-leaf) — let
            // the caller decide what "out the left" means. MainView wires
            // this to switching focus to the sidebar.
            onLeaveLeft?.()
          }
          break
        }
        case 'ArrowRight': {
          if (idx < 0) return
          e.preventDefault()
          const node = visible[idx]
          // Collapsed parent: expand. Leaf or already-expanded: open the
          // subtask input under this row (the parent gets auto-expanded by
          // the create-input effect so the input is visible).
          if (node.children.length > 0 && !expanded.has(node.todo.uid)) {
            setExpanded((p) => {
              const next = new Set(p)
              next.add(node.todo.uid)
              return next
            })
          } else if (onAddChild) {
            onAddChild(node)
          }
          break
        }
        case 'Home': {
          e.preventDefault()
          setSelected(visible[0].todo.uid)
          break
        }
        case 'End': {
          e.preventDefault()
          setSelected(visible[visible.length - 1].todo.uid)
          break
        }
        case 'PageDown': {
          e.preventDefault()
          const PAGE = 10
          const next = idx < 0 ? 0 : Math.min(visible.length - 1, idx + PAGE)
          setSelected(visible[next].todo.uid)
          break
        }
        case 'PageUp': {
          e.preventDefault()
          const PAGE = 10
          const next = idx <= 0 ? 0 : Math.max(0, idx - PAGE)
          setSelected(visible[next].todo.uid)
          break
        }
        case 'Enter': {
          // Buttons / links handle their own Enter via synthetic click; only
          // toggle the selection when focus is on the row (or on body).
          if (
            target instanceof HTMLButtonElement ||
            target instanceof HTMLAnchorElement
          )
            return
          if (idx < 0) return
          // With a multi-selection that includes the cursor, Enter cycles
          // the whole group in lockstep. Otherwise it cycles just the cursor
          // row (same as Ctrl+Enter), falling back to the binary toggle.
          const cursorNode = visible[idx]
          const multi =
            onCycleStatusSelected &&
            selectedUids &&
            selectedUids.size > 1 &&
            selectedUids.has(cursorNode.todo.uid)
          if (multi) {
            e.preventDefault()
            const chosen = visible.filter((n) => selectedUids.has(n.todo.uid))
            onCycleStatusSelected(cursorNode, chosen)
          } else if (onCycleStatus) {
            e.preventDefault()
            onCycleStatus(cursorNode)
          } else if (onToggleComplete) {
            e.preventDefault()
            onToggleComplete(cursorNode)
          }
          break
        }
        case 'F2': {
          if (idx < 0 || !onRenameTask) return
          e.preventDefault()
          setEditingUid(visible[idx].todo.uid)
          break
        }
        case '+':
        case '=': {
          bump(1)
          break
        }
        case '-':
        case '_': {
          bump(-1)
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (idx < 0 || !onDeleteRequest) return
          e.preventDefault()
          onDeleteRequest(visible[idx])
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    inactive,
    visible,
    selected,
    setSelected,
    editingUid,
    expanded,
    onToggleComplete,
    onCycleStatus,
    onCycleStatusSelected,
    selectedUids,
    onDeleteRequest,
    onAddChild,
    onRenameTask,
    onChangePriority,
    onChangePrioritySelected,
    onLeaveLeft,
    phonePriority,
    hoveredUid,
    anchorUid,
    onSelectRange,
    manualReorder,
    onReorderBySteps,
  ])

  function toggle(uid: string) {
    const collapsing = expanded.has(uid)
    // When collapsing a branch that contains the selection, move the
    // selection onto the branch root so it stays visible — otherwise the
    // reveal effect above would immediately re-expand to chase it.
    if (collapsing && selected && selected !== uid) {
      let cursor = selected
      for (let i = 0; i < 64; i++) {
        const loc = findParentAndSiblings(roots, cursor)
        if (!loc || !loc.parent) break
        if (loc.parent.todo.uid === uid) {
          setSelected(uid)
          break
        }
        cursor = loc.parent.todo.uid
      }
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const isCreatingUnder = (uid: string) => creatingParent === uid
  const canCreate = !!onConfirmCreate && !!onCancelCreate

  return (
    <ul className="select-none py-2" role="tree">
      {onQuickAdd && (
        <QuickAdd
          ref={quickAddRef}
          onConfirm={onQuickAdd}
          onConfirmAndOpen={onQuickAddAndOpen}
        />
      )}
      {visible.map((node, i) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expanded.has(node.todo.uid)
        const isSelected = selected === node.todo.uid
        // Selected but not the cursor — part of a multi-selection. Shares
        // the cursor's highlight + left accent edge so the range reads as one
        // strong block; the cursor stands out via its full border overlay.
        const isInSelection =
          !isSelected && (selectedUids?.has(node.todo.uid) ?? false)
        // Roving tabindex: the selected row is the tree's single Tab stop
        // (or the first row when nothing is selected) so the Tab focus
        // ring and the selection highlight are always the same element,
        // and Tab leaves the tree as a whole rather than walking rows.
        const isTabStop = isSelected || (selected == null && i === 0)
        const isDone = node.todo.status === 'COMPLETED'
        const isInProgress = node.todo.status === 'IN-PROCESS'
        const due = formatDue(node.todo.due)
        const pLabel = priorityLabel(node.todo.priority)
        const pTier = priorityTier(node.todo.priority)
        const expiresAt = fadingExpires?.get(node.todo.uid)
        // Kept = in the grace window (solid, counting down). Fading = in
        // the tail-end fade-out animation just before removal.
        const isKept = expiresAt != null
        const isFading = activelyFading?.has(node.todo.uid) ?? false
        const fadingRemainingS = isKept
          ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000))
          : 0
        const hiddenDone = branchDoneHidden?.get(node.todo.uid) ?? 0
        const isRevealed = revealedBranches?.has(node.todo.uid) ?? false
        const canRevealBranch =
          !!onToggleBranchReveal && (hiddenDone > 0 || isRevealed)

        const row = (
          <li
            key={node.itemUid}
            data-task-uid={node.todo.uid}
            role="treeitem"
            tabIndex={isTabStop ? 0 : -1}
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            onClick={(e) => {
              if (e.shiftKey && onSelectRange) {
                // Shift-click: range from the anchor to the clicked row.
                const a = anchorUid ?? selected
                const anchorIdx = a
                  ? visible.findIndex((n) => n.todo.uid === a)
                  : -1
                const clickedIdx = visible.findIndex(
                  (n) => n.todo.uid === node.todo.uid,
                )
                const base = anchorIdx < 0 ? clickedIdx : anchorIdx
                const lo = Math.min(base, clickedIdx)
                const hi = Math.max(base, clickedIdx)
                onSelectRange(
                  visible.slice(lo, hi + 1).map((n) => n.todo.uid),
                  node.todo.uid,
                )
              } else if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
                onToggleSelect(node.todo.uid)
              } else {
                setSelected(node.todo.uid)
              }
            }}
            draggable={!!taskDndMime && editingUid !== node.todo.uid}
            onDragStart={
              taskDndMime
                ? (e) => {
                    e.dataTransfer.setData(taskDndMime, node.todo.uid)
                    e.dataTransfer.effectAllowed = 'move'
                  }
                : undefined
            }
            onDragOver={
              taskDndMime &&
              (onReparentDrop || (manualReorder && onReorderDrop))
                ? (e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const h = rect.height
                    let place: 'before' | 'after' | 'child'
                    if (manualReorder && onReorderDrop && onReparentDrop) {
                      // Three bands: top/bottom quarter reorder, middle reparent.
                      place =
                        y < h * 0.25
                          ? 'before'
                          : y > h * 0.75
                            ? 'after'
                            : 'child'
                    } else if (manualReorder && onReorderDrop) {
                      // Reorder only — top/bottom halves, no reparent band.
                      place = y < h / 2 ? 'before' : 'after'
                    } else {
                      // Reparent only (non-manual sort) — whole row.
                      place = 'child'
                    }
                    setDropHint((cur) =>
                      cur?.uid === node.todo.uid && cur.place === place
                        ? cur
                        : { uid: node.todo.uid, place },
                    )
                  }
                : undefined
            }
            onDragLeave={
              taskDndMime &&
              (onReparentDrop || (manualReorder && onReorderDrop))
                ? (e) => {
                    // Ignore leave events fired when crossing onto a child
                    // element of the same row.
                    if (
                      e.currentTarget.contains(e.relatedTarget as Node | null)
                    )
                      return
                    setDropHint((cur) =>
                      cur?.uid === node.todo.uid ? null : cur,
                    )
                  }
                : undefined
            }
            onDrop={
              taskDndMime &&
              (onReparentDrop || (manualReorder && onReorderDrop))
                ? (e) => {
                    const dragged = e.dataTransfer.getData(taskDndMime)
                    const hint = dropHint
                    setDropHint(null)
                    if (!dragged || dragged === node.todo.uid) return
                    e.preventDefault()
                    e.stopPropagation()
                    const place: 'before' | 'after' | 'child' =
                      hint?.uid === node.todo.uid
                        ? hint.place
                        : onReparentDrop
                          ? 'child'
                          : 'after'
                    if (place === 'child') {
                      onReparentDrop?.(dragged, node.todo.uid)
                    } else {
                      onReorderDrop?.(dragged, node.todo.uid, place)
                    }
                  }
                : undefined
            }
            onContextMenu={
              onRowContextMenu
                ? (e) => {
                    e.preventDefault()
                    setSelected(node.todo.uid)
                    onRowContextMenu(node, e.clientX, e.clientY)
                  }
                : undefined
            }
            onMouseEnter={() => setHoveredUid(node.todo.uid)}
            onMouseLeave={() =>
              setHoveredUid((cur) =>
                cur === node.todo.uid ? null : cur,
              )
            }
            className={`group relative flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-none ${
              isFading
                ? 'opacity-10 transition-opacity duration-[1400ms] ease-linear'
                : 'transition-opacity duration-300'
            } ${
              isSelected
                ? 'bg-accent-soft'
                : isInSelection
                  ? 'bg-accent-soft'
                  : pTier
                    ? `prio-wash-${pTier}`
                    : 'hover:bg-surface'
            }`}
            style={{ paddingLeft: 12 + node.depth * INDENT_PX }}
          >
            {dropHint?.uid === node.todo.uid &&
              (dropHint.place === 'child' ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-sm border-2 border-accent bg-accent-soft/40"
                />
              ) : (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${
                    dropHint.place === 'before' ? 'top-0' : 'bottom-0'
                  }`}
                />
              ))}
            {isInProgress && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent"
                title="In progress"
              />
            )}
            {pTier && (
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-0 left-0 prio-bar-${pTier}`}
              />
            )}
            {isSelected && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 border border-[var(--color-text)]"
              />
            )}
            {(isSelected || isInSelection) && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-accent"
              />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (hasChildren) toggle(node.todo.uid)
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint transition-colors ${
                hasChildren
                  ? 'hover:bg-surface-2 hover:text-text-muted'
                  : 'invisible'
              }`}
              tabIndex={-1}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-3 w-3 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>

            <button
              type="button"
              role="checkbox"
              tabIndex={-1}
              aria-checked={isDone ? true : isInProgress ? 'mixed' : false}
              aria-label={
                isDone
                  ? 'Completed — cycle status'
                  : isInProgress
                    ? 'In progress — cycle status'
                    : 'Not started — cycle status'
              }
              disabled={
                (!onCycleStatus && !onToggleComplete) ||
                pendingUids?.has(node.itemUid)
              }
              onClick={(e) => {
                e.stopPropagation()
                // Clicking the box cycles status (needs-action → in-progress
                // → completed → …), matching what Enter does, rather than a
                // plain complete toggle. Falls back to the binary toggle if
                // no cycle handler was wired.
                if (onCycleStatus) onCycleStatus(node)
                else onToggleComplete?.(node)
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isDone
                  ? 'border-accent bg-accent text-bg hover:opacity-90'
                  : isInProgress
                    ? 'border-accent bg-accent-soft text-accent hover:border-accent'
                    : 'border-border-strong bg-transparent hover:border-text-muted'
              }`}
            >
              {isDone && (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              )}
              {!isDone && isInProgress && (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M4 8h8" />
                </svg>
              )}
            </button>

            <div className="flex min-w-0 flex-1 flex-col">
              {editingUid === node.todo.uid ? (
                <input
                  ref={editInputRef}
                  spellCheck
                  defaultValue={node.todo.summary}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const v = e.currentTarget.value.trim()
                      setEditingUid(null)
                      if (v && v !== node.todo.summary) {
                        onRenameTask?.(node, v)
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingUid(null)
                    }
                  }}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim()
                    setEditingUid(null)
                    if (v && v !== node.todo.summary) {
                      onRenameTask?.(node, v)
                    }
                  }}
                  className="w-full bg-transparent text-text outline-none"
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (onRenameTask) setEditingUid(node.todo.uid)
                  }}
                  className={`truncate ${
                    isDone ? 'text-text-faint line-through' : 'text-text'
                  }`}
                  title={node.todo.summary}
                >
                  {node.todo.summary || (
                    <em className="text-text-faint">(untitled)</em>
                  )}
                </span>
              )}
              {showDetails &&
                (() => {
                  // One-line preview of the task's notes (else location),
                  // shown only when the "Show task details" toggle is on.
                  const detail = (
                    node.todo.description ||
                    node.todo.location ||
                    ''
                  )
                    .replace(/\s+/g, ' ')
                    .trim()
                  if (!detail) return null
                  return (
                    <span
                      className="truncate text-[11px] text-text-faint"
                      title={detail}
                    >
                      {detail}
                    </span>
                  )
                })()}
            </div>

            {onAddChild && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddChild(node)
                }}
                title="Add subtask"
                aria-label="Add subtask"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-text-muted group-hover:opacity-100 focus:opacity-100"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M8 3.5v9M3.5 8h9" />
                </svg>
              </button>
            )}

            {canRevealBranch && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  // Revealing only helps if the branch is expanded — make
                  // sure it is so the completed subtasks actually show.
                  if (!isRevealed) {
                    setExpanded((prev) => {
                      if (prev.has(node.todo.uid)) return prev
                      const next = new Set(prev)
                      next.add(node.todo.uid)
                      return next
                    })
                  }
                  onToggleBranchReveal!(node.todo.uid)
                }}
                aria-pressed={isRevealed}
                title={
                  isRevealed
                    ? 'Hide completed subtasks'
                    : `Show ${hiddenDone} completed subtask${
                        hiddenDone === 1 ? '' : 's'
                      }`
                }
                className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  isRevealed
                    ? 'bg-accent-soft text-text'
                    : 'text-text-faint hover:bg-surface-2 hover:text-text-muted'
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
                {!isRevealed && hiddenDone}
              </button>
            )}

            {isKept && fadingRemainingS > 0 && (
              <span
                className="shrink-0 text-[10px] font-medium tabular-nums text-text-muted"
                title="Hiding soon — toggle to keep"
              >
                {fadingRemainingS}s
              </span>
            )}

            {node.todo.broken && (
              <span
                className="shrink-0 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger"
                title="Couldn't parse this item's iCal — open to view/fix the raw content"
              >
                ⚠ unreadable
              </span>
            )}

            {node.duplicateUid && (
              <span
                className="shrink-0 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger"
                title={`Another item shares this VTODO UID (${node.todo.uid}). Both are kept, but their nesting is a best-effort guess — give one a fresh UID to resolve.`}
              >
                ⚠ dup id
              </span>
            )}

            {node.todo.recurring && node.todo.rrule && (
              <span
                className="shrink-0 text-[11px] leading-none text-text-faint"
                title={`Repeats — ${humanizeRrule(node.todo.rrule)}`}
                aria-label="Repeating task"
              >
                ⟳
              </span>
            )}

            {pendingUids?.has(node.itemUid) && (
              <span
                className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted"
                title="Not yet synced"
              >
                saving…
              </span>
            )}

            {(() => {
              if (!showCompletedSub && !showTotalSub) return null
              const c = subtaskCounts.get(node.todo.uid)
              if (!c) return null
              const text = showCompletedSub
                ? showTotalSub
                  ? `${c.done}/${c.total}`
                  : `${c.done}`
                : `/${c.total}`
              return (
                <span
                  className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-faint"
                  title={`${c.done} of ${c.total} subtasks complete`}
                >
                  {text}
                </span>
              )
            })()}

            {pLabel && (
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${priorityClasses(
                  node.todo.priority,
                )}`}
              >
                {pLabel}
              </span>
            )}

            {due && (
              <span className="shrink-0 text-xs tabular-nums text-text-muted">
                {due.label}
                {due.time && (
                  <span className="text-text-faint"> · {due.time}</span>
                )}
              </span>
            )}
          </li>
        )

        if (isCreatingUnder(node.todo.uid) && canCreate) {
          return (
            <Fragment key={node.itemUid}>
              {row}
              <InlineCreate
                depth={node.depth + 1}
                onConfirm={onConfirmCreate!}
                onCancel={onCancelCreate!}
                onConfirmAndOpen={onConfirmCreateAndOpen}
              />
            </Fragment>
          )
        }
        return row
      })}
    </ul>
  )
}
