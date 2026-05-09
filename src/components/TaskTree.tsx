import { useMemo, useState } from 'react'
import type { TaskNode } from '../types'
import { flattenVisible } from '../services/tree'

interface Props {
  roots: TaskNode[]
  onToggleComplete?: (node: TaskNode) => void
  pendingUids?: ReadonlySet<string>
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

export function TaskTree({ roots, onToggleComplete, pendingUids }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Default: expand all roots one level
    const initial = new Set<string>()
    for (const r of roots) initial.add(r.todo.uid)
    return initial
  })
  const [selected, setSelected] = useState<string | null>(null)

  const visible = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])

  function toggle(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  if (roots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-faint">
        No tasks in this list.
      </div>
    )
  }

  return (
    <ul className="select-none py-2" role="tree">
      {visible.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expanded.has(node.todo.uid)
        const isSelected = selected === node.todo.uid
        const isDone = node.todo.status === 'COMPLETED'
        const due = formatDue(node.todo.due)
        const pLabel = priorityLabel(node.todo.priority)

        return (
          <li
            key={node.itemUid}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            onClick={() => setSelected(node.todo.uid)}
            className={`group flex cursor-default items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
              isSelected
                ? 'bg-accent-soft'
                : 'hover:bg-surface'
            }`}
            style={{ paddingLeft: 12 + node.depth * INDENT_PX }}
          >
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
              aria-checked={isDone}
              aria-label={isDone ? 'Mark not completed' : 'Mark completed'}
              disabled={!onToggleComplete || pendingUids?.has(node.itemUid)}
              onClick={(e) => {
                e.stopPropagation()
                onToggleComplete?.(node)
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isDone
                  ? 'border-accent bg-accent text-bg hover:opacity-90'
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
            </button>

            <span
              className={`min-w-0 flex-1 truncate ${
                isDone ? 'text-text-faint line-through' : 'text-text'
              }`}
              title={node.todo.summary}
            >
              {node.todo.summary || (
                <em className="text-text-faint">(untitled)</em>
              )}
            </span>

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
      })}
    </ul>
  )
}
