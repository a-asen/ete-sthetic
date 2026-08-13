import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ContactHit,
  type EventHit,
  type MetaHit,
  type TaskHit,
  searchMeta,
} from '../services/metasearch'

type Scope = 'all' | 'task' | 'event' | 'contact'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'event', label: 'Events' },
  { key: 'contact', label: 'Contacts' },
]

function KindBadge({ kind }: { kind: MetaHit['kind'] }) {
  const label = kind === 'task' ? 'Task' : kind === 'event' ? 'Event' : 'Contact'
  return (
    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-faint">
      {label}
    </span>
  )
}

function primaryText(h: MetaHit): string {
  if (h.kind === 'task') return h.item.todo.summary || '(untitled)'
  if (h.kind === 'event') return h.item.event.summary || '(no title)'
  return h.item.card.fn || '(no name)'
}

function secondaryText(h: MetaHit): string {
  if (h.kind === 'task') {
    return h.item.todo.status === 'COMPLETED' ? 'done' : ''
  }
  if (h.kind === 'event') {
    const d = h.item.event.start
    return d ? d.toLocaleDateString() : ''
  }
  const c = h.item.card
  return c.org || c.emails[0]?.value || c.phones[0]?.value || ''
}

// Cross-module "meta search" (Ctrl/Cmd+K). Searches the in-memory stores of
// every opened module, groups by module, and hands a pick back so App can
// switch modules and reveal the item. Scope tabs (or Tab) narrow to one.
export function MetaSearchModal({
  onPick,
  onClose,
}: {
  onPick: (hit: MetaHit) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => searchMeta(query), [query])

  const groups = useMemo(() => {
    const all = [
      { key: 'task' as const, label: 'Tasks', hits: results.tasks as MetaHit[] },
      { key: 'event' as const, label: 'Events', hits: results.events as MetaHit[] },
      {
        key: 'contact' as const,
        label: 'Contacts',
        hits: results.contacts as MetaHit[],
      },
    ]
    return all.filter((g) => scope === 'all' || scope === g.key)
  }, [results, scope])

  // Flat list of the visible hits, in render order — drives ↑/↓/Enter.
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Tab') {
      // Cycle the scope tabs without leaving the input.
      e.preventDefault()
      const dir = e.shiftKey ? -1 : 1
      const i = SCOPES.findIndex((s) => s.key === scope)
      setScope(SCOPES[(i + dir + SCOPES.length) % SCOPES.length].key)
      setActive(0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = flat[active]
      if (hit) onPick(hit)
    }
  }

  let idx = -1 // running index assigned to rows for keyboard mapping

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search everything"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search tasks, events, and contacts…"
          className="border-b border-border bg-surface px-4 py-3 text-sm text-text outline-none placeholder:text-text-faint"
        />
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setScope(s.key)
                setActive(0)
                inputRef.current?.focus()
              }}
              className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                scope === s.key
                  ? 'bg-accent-soft text-text'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-text-faint">
            ↑↓ move · ↵ open · Tab scope · esc
          </span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {query.trim() === '' ? (
            <p className="px-4 py-6 text-center text-xs text-text-faint">
              Type to search across every module.
            </p>
          ) : flat.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-text-faint">
              No matches.
            </p>
          ) : (
            groups.map((g) =>
              g.hits.length === 0 ? null : (
                <div key={g.key}>
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                    {g.label}
                  </div>
                  {g.hits.map((hit) => {
                    idx += 1
                    const i = idx
                    return (
                      <button
                        key={`${hit.kind}:${hit.item.itemUid}:${i}`}
                        type="button"
                        data-idx={i}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => onPick(hit)}
                        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                          i === active ? 'bg-surface-2' : ''
                        }`}
                      >
                        <KindBadge kind={hit.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text">
                            {primaryText(hit)}
                          </span>
                          {secondaryText(hit) && (
                            <span className="block truncate text-[11px] text-text-faint">
                              {secondaryText(hit)}
                            </span>
                          )}
                        </span>
                        <span className="ml-2 max-w-[30%] shrink-0 truncate text-[10px] text-text-faint">
                          {hit.sourceName}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ),
            )
          )}
          {/* Hint when a module hasn't been opened this session (its store is
              empty), so results can't include it yet. */}
          {query.trim() !== '' &&
            (!results.warmed.tasks ||
              !results.warmed.events ||
              !results.warmed.contacts) && (
              <p className="border-t border-border px-3 py-1.5 text-[10px] text-text-faint">
                Not searched yet (open once to include):{' '}
                {[
                  !results.warmed.tasks && 'Tasks',
                  !results.warmed.events && 'Calendar',
                  !results.warmed.contacts && 'Contacts',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
        </div>
      </div>
    </div>
  )
}

export type { MetaHit, TaskHit, EventHit, ContactHit }
