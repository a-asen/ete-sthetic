import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Priority, TaskNode } from '../types'
import { flattenVisible } from '../services/tree'

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
  inactive?: boolean
  onToggleComplete?: (node: TaskNode) => void
  // Enter cycles status (needs-action → in-progress → completed → …),
  // matching Ctrl+Enter. The checkbox click still uses onToggleComplete.
  onCycleStatus?: (node: TaskNode) => void
  pendingUids?: ReadonlySet<string>
  creatingParent?: string | null
  onAddChild?: (parent: TaskNode) => void
  onConfirmCreate?: (summary: string) => void
  onConfirmCreateAndOpen?: (summary: string) => void
  onCancelCreate?: () => void
  onRenameTask?: (node: TaskNode, newSummary: string) => void
  onDeleteRequest?: (node: TaskNode) => void
  onChangePriority?: (node: TaskNode, priority: Priority) => void
  // Right-click on a task row → caller opens a context menu at x,y.
  onRowContextMenu?: (node: TaskNode, x: number, y: number) => void
  // When set, task rows are draggable and carry their VTODO uid under
  // this mime type (a sidebar list can accept the drop to move it).
  taskDndMime?: string
  // Called when ArrowLeft is pressed on a top-level row that's already
  // collapsed (or a leaf with no parent). Lets the caller decide what
  // "leaving the tree to the left" means — typically focus the sidebar.
  onLeaveLeft?: () => void
  // uid → expiry timestamp (ms). Rows in this map fade out and show a
  // countdown until they're removed by the caller's grace timer.
  fadingExpires?: ReadonlyMap<string, number>
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
      if (value) onConfirm(value)
      else onCancel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (
      (e.ctrlKey || e.metaKey) &&
      e.key === 'ArrowRight' &&
      onConfirmAndOpen
    ) {
      // Commit this (sub)task and follow it into details. stopPropagation
      // so the global Ctrl+→ handler doesn't also fire (it would open the
      // *parent's* detail since selection is still the parent).
      e.preventDefault()
      e.stopPropagation()
      const value = inputRef.current?.value.trim() ?? ''
      if (value) onConfirmAndOpen(value)
      else onCancel()
    } else if (e.key === 'ArrowLeft') {
      // ArrowLeft on an empty input cancels (mirrors ArrowRight to start).
      // With any text in the field, this is a normal cursor move.
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
        placeholder={INPUT_PLACEHOLDER}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
        onKeyDown={handleKey}
        onBlur={handleBlur}
      />
    </li>
  )
}

const INDENT_PX = 20

function formatDue(due: string | undefined): string | null {
  if (!due) return null
  // ical.js gives date strings like "20260520" or "20260520T140000Z"
  const m = due.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return due
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`)
  if (Number.isNaN(date.getTime())) return due
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays > 1 && diffDays <= 7) return `in ${diffDays}d`
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  inactive = false,
  onToggleComplete,
  onCycleStatus,
  pendingUids,
  creatingParent,
  onAddChild,
  onConfirmCreate,
  onConfirmCreateAndOpen,
  onCancelCreate,
  onRenameTask,
  onDeleteRequest,
  onChangePriority,
  onRowContextMenu,
  taskDndMime,
  onLeaveLeft,
  fadingExpires,
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
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingUid && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingUid])

  // Tick to refresh the countdown on fading rows. Idle when nothing's fading.
  const fadingActive = !!fadingExpires && fadingExpires.size > 0
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!fadingActive) return
    const id = setInterval(() => setNowTick((t) => t + 1), 250)
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

  // When selection changes — or when the tree becomes the active zone
  // again after a trip through the sidebar / detail panel — focus the row
  // and scroll it into view so Enter lands on it. Skip if focus is in a
  // typing element so we don't disrupt inline editing or the create-task
  // input.
  useEffect(() => {
    if (inactive) return
    if (!selected) return
    const el = document.querySelector(
      `[data-task-uid="${CSS.escape(selected)}"]`,
    ) as HTMLElement | null
    if (!el) return
    const active = document.activeElement
    const isTypingTarget =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    if (!isTypingTarget) el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest' })
  }, [selected, inactive])

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
      // Ctrl/Cmd + ArrowUp/Down pages through the list (alias for
      // PageUp/PageDown). Handled here, before the generic modifier
      // bail-out below.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      ) {
        if (editingUid || document.querySelector('[role="dialog"]')) return
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
          e.preventDefault()
          const next = idx < 0 ? 0 : Math.min(visible.length - 1, idx + 1)
          setSelected(visible[next].todo.uid)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = idx <= 0 ? 0 : idx - 1
          setSelected(visible[prev].todo.uid)
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
          // Enter cycles status (same as Ctrl+Enter); fall back to the
          // binary toggle if no cycle handler was provided.
          if (onCycleStatus) {
            e.preventDefault()
            onCycleStatus(visible[idx])
          } else if (onToggleComplete) {
            e.preventDefault()
            onToggleComplete(visible[idx])
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
          if (idx < 0 || !onChangePriority) return
          e.preventDefault()
          const node = visible[idx]
          const next = phonePriority
            ? bumpPriorityPhone(node.todo.priority, 1)
            : bumpPriority(node.todo.priority, 1)
          if (next !== node.todo.priority) onChangePriority(node, next)
          break
        }
        case '-':
        case '_': {
          if (idx < 0 || !onChangePriority) return
          e.preventDefault()
          const node = visible[idx]
          const next = phonePriority
            ? bumpPriorityPhone(node.todo.priority, -1)
            : bumpPriority(node.todo.priority, -1)
          if (next !== node.todo.priority) onChangePriority(node, next)
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
    onDeleteRequest,
    onAddChild,
    onRenameTask,
    onChangePriority,
    onLeaveLeft,
    phonePriority,
    hoveredUid,
  ])

  function toggle(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const isCreatingRoot = creatingParent === null
  const isCreatingUnder = (uid: string) => creatingParent === uid
  const canCreate = !!onConfirmCreate && !!onCancelCreate

  if (roots.length === 0 && !isCreatingRoot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-faint">
        No tasks in this list.
      </div>
    )
  }

  return (
    <ul className="select-none py-2" role="tree">
      {isCreatingRoot && canCreate && (
        <InlineCreate
          depth={0}
          centered
          onConfirm={onConfirmCreate!}
          onCancel={onCancelCreate!}
          onConfirmAndOpen={onConfirmCreateAndOpen}
        />
      )}
      {visible.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expanded.has(node.todo.uid)
        const isSelected = selected === node.todo.uid
        const isDone = node.todo.status === 'COMPLETED'
        const isInProgress = node.todo.status === 'IN-PROCESS'
        const due = formatDue(node.todo.due)
        const pLabel = priorityLabel(node.todo.priority)
        const pTier = priorityTier(node.todo.priority)
        const expiresAt = fadingExpires?.get(node.todo.uid)
        const isFading = expiresAt != null
        const fadingRemainingS = isFading
          ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
          : 0

        const row = (
          <li
            key={node.itemUid}
            data-task-uid={node.todo.uid}
            role="treeitem"
            tabIndex={-1}
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            onClick={() => setSelected(node.todo.uid)}
            draggable={!!taskDndMime && editingUid !== node.todo.uid}
            onDragStart={
              taskDndMime
                ? (e) => {
                    e.dataTransfer.setData(taskDndMime, node.todo.uid)
                    e.dataTransfer.effectAllowed = 'move'
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
                ? 'opacity-10 transition-opacity duration-[5000ms] ease-linear'
                : 'transition-opacity'
            } ${
              isSelected
                ? 'bg-accent-soft'
                : pTier
                  ? `prio-wash-${pTier}`
                  : 'hover:bg-surface'
            }`}
            style={{ paddingLeft: 12 + node.depth * INDENT_PX }}
          >
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
              aria-checked={isDone ? true : isInProgress ? 'mixed' : false}
              aria-label={
                isDone
                  ? 'Mark not completed'
                  : isInProgress
                    ? 'In progress — mark completed'
                    : 'Mark completed'
              }
              disabled={!onToggleComplete || pendingUids?.has(node.itemUid)}
              onClick={(e) => {
                e.stopPropagation()
                onToggleComplete?.(node)
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

            {editingUid === node.todo.uid ? (
              <input
                ref={editInputRef}
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
                className="min-w-0 flex-1 bg-transparent text-text outline-none"
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (onRenameTask) setEditingUid(node.todo.uid)
                }}
                className={`min-w-0 flex-1 truncate ${
                  isDone ? 'text-text-faint line-through' : 'text-text'
                }`}
                title={node.todo.summary}
              >
                {node.todo.summary || (
                  <em className="text-text-faint">(untitled)</em>
                )}
              </span>
            )}

            {onAddChild && (
              <button
                type="button"
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

            {isFading && fadingRemainingS > 0 && (
              <span
                className="shrink-0 text-[10px] font-medium tabular-nums text-text-muted"
                title="Hiding soon"
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

            {pendingUids?.has(node.itemUid) && (
              <span
                className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted"
                title="Not yet synced"
              >
                saving…
              </span>
            )}

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
                {due}
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
