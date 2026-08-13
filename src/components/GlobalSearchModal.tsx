import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, TaskItem } from '../types'

interface SearchHit {
  itemUid: string
  collectionUid: string
  collectionName: string
  collectionColor: string | null
  summary: string
  priority: number
  status: string | null
  due: string | null
}

interface Props {
  // Per-list cached items. Keyed by collection uid — the modal scans
  // every list in this map. Lists not yet loaded simply don't
  // contribute hits; the modal calls `onRequestSyncAll` on open to
  // pre-warm them, and once they land they appear in subsequent
  // renders (the modal stays open and re-reads the map).
  itemsByCollection: Map<string, TaskItem[]>
  collections: CollectionInfo[]
  loadedUids: ReadonlySet<string>
  // Fire-and-forget: triggers a syncAll so all lists land in
  // itemsByCollection. The modal handles re-render via parent state
  // once items arrive — caller doesn't need to await this.
  onRequestSyncAll: () => void
  // Navigates to a result: switch to the destination list and select
  // the task. Caller closes the modal afterward.
  onPick: (collectionUid: string, taskUid: string) => void
  onClose: () => void
}

// Match a single task against a normalised query. Substring case-
// insensitive against the summary today; description / other fields
// can join later if the user actually wants them.
function matches(task: TaskItem, q: string): boolean {
  if (!q) return false
  const sum = (task.todo.summary || '').toLowerCase()
  return sum.includes(q)
}

// Cross-list search modal. Triggered from MainView with Ctrl+Shift+F.
// Surfaces every cached task across every loaded list with a flat
// result list — each row carries a small list-name badge so the user
// knows where the task lives. Picking a row switches to that list
// and selects the task; the existing per-list scroll-into-view and
// detail panel reflect the selection.
export function GlobalSearchModal({
  itemsByCollection,
  collections,
  loadedUids,
  onRequestSyncAll,
  onPick,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Trigger a background sync on mount so cold lists land in the
  // results within a few seconds even on a fresh app launch. The map
  // is read directly on each render, so newly-arrived lists appear
  // without any further wiring here.
  useEffect(() => {
    onRequestSyncAll()
  }, [onRequestSyncAll])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const hits: SearchHit[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: SearchHit[] = []
    // Build a lookup once so each hit row can carry the list's
    // display attributes without a per-row find().
    const colByUid = new Map<string, CollectionInfo>()
    for (const c of collections) colByUid.set(c.uid, c)
    for (const [colUid, items] of itemsByCollection) {
      const col = colByUid.get(colUid)
      // Tombstoned / unknown collections drop their hits — they can't
      // be navigated to anyway.
      if (!col || col.isDeleted) continue
      for (const it of items) {
        if (!matches(it, q)) continue
        out.push({
          itemUid: it.itemUid,
          collectionUid: colUid,
          collectionName: col.name,
          collectionColor: col.color ?? null,
          summary: it.todo.summary || '(untitled)',
          priority: it.todo.priority ?? 0,
          status: it.todo.status ?? null,
          due: it.todo.due ?? null,
        })
      }
    }
    // Highest-priority first, then alpha. Priority 0 (unset) sorts
    // last regardless of the rest — RFC 5545 lists 0 as "undefined".
    out.sort((a, b) => {
      const ap = a.priority === 0 ? 10 : a.priority
      const bp = b.priority === 0 ? 10 : b.priority
      if (ap !== bp) return ap - bp
      return a.summary.localeCompare(b.summary, undefined, {
        sensitivity: 'base',
      })
    })
    return out.slice(0, 200)
  }, [query, itemsByCollection, collections])

  // Reset the highlighted row whenever the query changes so the user's
  // first ↓ press starts from the top of the new result set. Uses the
  // "derived state via render" pattern instead of an effect so React
  // doesn't double-render on every keystroke.
  const [lastQuery, setLastQuery] = useState(query)
  if (lastQuery !== query) {
    setLastQuery(query)
    setActiveIndex(0)
  }

  // Keep the highlighted row in-frame as it moves.
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-hit-index="${activeIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const totalLists = collections.filter((c) => !c.isDeleted).length
  const unloadedCount = collections.filter(
    (c) => !c.isDeleted && !loadedUids.has(c.uid),
  ).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search all lists"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm"
    >
      <div className="flex max-h-[70vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60">
        <div className="border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const hit = hits[activeIndex]
                if (hit) onPick(hit.collectionUid, hit.itemUid)
              }
            }}
            placeholder="Search every list…"
            aria-label="Search across all lists"
            className="w-full bg-transparent px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-faint"
          />
        </div>
        <div className="flex items-center justify-between px-3 pt-1.5 text-[11px] text-text-faint">
          <span>
            {query.trim()
              ? `${hits.length} match${hits.length === 1 ? '' : 'es'}`
              : 'Type to search across every list'}
          </span>
          <span>
            {totalLists - unloadedCount} of {totalLists} lists loaded
            {unloadedCount > 0 && ' — syncing rest…'}
          </span>
        </div>
        <ul
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5"
        >
          {hits.map((hit, i) => {
            const active = i === activeIndex
            const swatch = hit.collectionColor || 'var(--color-accent)'
            const done = hit.status === 'COMPLETED'
            return (
              <li key={`${hit.collectionUid}:${hit.itemUid}`}>
                <button
                  type="button"
                  data-hit-index={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => onPick(hit.collectionUid, hit.itemUid)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-accent-soft text-text'
                      : 'text-text-muted hover:bg-surface-2'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: swatch }}
                    aria-hidden
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      done ? 'line-through' : ''
                    }`}
                  >
                    {hit.summary}
                  </span>
                  {hit.priority > 0 && (
                    <span
                      className="shrink-0 rounded bg-surface-2 px-1.5 text-[10px] tabular-nums text-text-faint"
                      title={`Priority ${hit.priority}`}
                    >
                      P{hit.priority}
                    </span>
                  )}
                  <span className="shrink-0 truncate rounded bg-surface-2 px-1.5 text-[10px] text-text-faint">
                    {hit.collectionName}
                  </span>
                </button>
              </li>
            )
          })}
          {query.trim() && hits.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-text-faint">
              No tasks match.
            </li>
          )}
        </ul>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-faint">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  )
}
