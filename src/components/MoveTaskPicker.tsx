import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo } from '../types'

interface Props {
  collections: CollectionInfo[]
  // The current collection uid — excluded from the list since "move to
  // the same list" is a no-op.
  excludeUid: string
  // Short summary of what's being moved, shown in the title for context.
  taskSummary: string
  descendantCount: number
  onCancel: () => void
  onPick: (destUid: string) => void
}

// Case-insensitive subsequence match. Cheap and good enough for typical
// 20–30 list counts; no need for a real fuzzy library here.
function matches(query: string, name: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  let i = 0
  for (const ch of n) {
    if (ch === q[i]) {
      i++
      if (i === q.length) return true
    }
  }
  return false
}

export function MoveTaskPicker({
  collections,
  excludeUid,
  taskSummary,
  descendantCount,
  onCancel,
  onPick,
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const prevIdxRef = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    return collections
      .filter((c) => c.uid !== excludeUid && c.isDeleted !== true)
      .filter((c) => matches(query, c.name))
  }, [collections, excludeUid, query])

  // Clamp during render rather than via an effect — keeps the lint rule
  // about setState-in-effect happy and avoids the extra render cycle.
  const clampedIdx = Math.max(0, Math.min(activeIdx, filtered.length - 1))

  // Window-level keyboard handling so navigation keeps working after the
  // user clicks off the app and back (focus often returns to the body,
  // not to the input). Also catches Tab so focus can't escape to the
  // scrollbar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const target = filtered[clampedIdx]
        if (target) onPick(target.uid)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(Math.min(filtered.length - 1, clampedIdx + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(Math.max(0, clampedIdx - 1))
        return
      }
      // Trap Tab so the user can't tab into the scrollbar / outside the
      // dialog; we always want the input to own typing focus.
      if (e.key === 'Tab') {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      // Any other key while focus is loose: pull it back into the input
      // so typing-into-the-filter starts working immediately. Skip
      // modifier-only events so Ctrl/Cmd shortcuts pass through.
      if (
        document.activeElement !== inputRef.current &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.length === 1
      ) {
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, clampedIdx, onCancel, onPick])

  // Keep one row of context visible beyond the highlight in the direction
  // of travel: scroll the *neighbor* (idx ± 1) into view rather than the
  // selection itself. That naturally leaves the highlighted row one slot
  // away from the edge until we reach the actual end of the list, where
  // the fallback scrolls the selection itself.
  useEffect(() => {
    const dir = clampedIdx >= prevIdxRef.current ? 1 : -1
    prevIdxRef.current = clampedIdx
    const root = listRef.current
    if (!root) return
    const neighbor = root.querySelector(
      `[data-pick-idx="${clampedIdx + dir}"]`,
    ) as HTMLElement | null
    const fallback = root.querySelector(
      `[data-pick-idx="${clampedIdx}"]`,
    ) as HTMLElement | null
    ;(neighbor ?? fallback)?.scrollIntoView({ block: 'nearest' })
  }, [clampedIdx, filtered.length])

  const summary =
    descendantCount > 0
      ? `${taskSummary || '(untitled)'} + ${descendantCount} subtask${
          descendantCount === 1 ? '' : 's'
        }`
      : taskSummary || '(untitled)'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move task to another list"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-24"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <h3 className="text-sm font-medium text-text">Move task</h3>
          <p className="mt-0.5 truncate text-[11px] text-text-muted" title={summary}>
            {summary}
          </p>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIdx(0)
          }}
          placeholder="Filter lists…"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong placeholder:text-text-faint"
        />
        <ul
          ref={listRef}
          className="mt-2 max-h-72 overflow-y-auto"
          role="listbox"
          aria-label="Destination lists"
        >
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-xs text-text-faint">
              No lists match.
            </li>
          )}
          {filtered.map((c, i) => {
            const active = i === clampedIdx
            return (
              <li key={c.uid} data-pick-idx={i}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => onPick(c.uid)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-accent-soft text-text ring-1 ring-accent/40'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: c.color || 'var(--color-border-strong)',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 flex justify-between text-[11px] text-text-faint">
          <span>↑↓ to navigate · Enter to move · Esc to cancel</span>
          <span>{filtered.length}</span>
        </p>
      </div>
    </div>
  )
}
