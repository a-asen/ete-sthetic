import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, ContactItem } from '../../types'
import { Avatar } from './ContactCard'

interface Hit {
  bookUid: string
  bookName: string
  item: ContactItem
  score: number
}

const MAX_RESULTS = 200

// One-line secondary detail for a result row: org, else first email, else
// first phone. Empty when the card has none of those.
function subtitleOf(item: ContactItem): string {
  const c = item.card
  return (
    c.org ||
    c.emails.find((e) => e.value)?.value ||
    c.phones.find((p) => p.value)?.value ||
    ''
  )
}

// Cross-address-book contact search. Spans every book in `contactsByBook`
// (kicking a sync of all books on open so unloaded ones fill in), ranks
// name-prefix hits above other-field hits, and hands a pick back so the
// parent can switch books + select the contact.
export function ContactSearchModal({
  contactsByBook,
  books,
  onRequestSyncAll,
  onPick,
  onClose,
}: {
  contactsByBook: Map<string, ContactItem[]>
  books: CollectionInfo[]
  onRequestSyncAll: () => void
  onPick: (bookUid: string, itemUid: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Pull the other books into memory so the search really spans everything;
  // results re-rank as each book lands in `contactsByBook`.
  useEffect(() => {
    onRequestSyncAll()
  }, [onRequestSyncAll])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const bookName = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of books) m.set(b.uid, b.name)
    return m
  }, [books])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: Hit[] = []
    for (const [bookUid, items] of contactsByBook) {
      for (const item of items) {
        const c = item.card
        const fn = c.fn.toLowerCase()
        let score = 0
        if (fn.startsWith(q)) score = 3
        else if (fn.includes(q)) score = 2
        else if (
          c.nickname.toLowerCase().includes(q) ||
          c.org.toLowerCase().includes(q) ||
          c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
          c.phones.some((p) => p.value.toLowerCase().includes(q)) ||
          c.categories.some((cat) => cat.toLowerCase().includes(q))
        ) {
          score = 1
        }
        if (score > 0) {
          out.push({
            bookUid,
            bookName: bookName.get(bookUid) ?? '',
            item,
            score,
          })
        }
      }
    }
    out.sort(
      (a, b) =>
        b.score - a.score ||
        a.item.card.fn.localeCompare(b.item.card.fn, undefined, {
          sensitivity: 'base',
        }),
    )
    return out.slice(0, MAX_RESULTS)
  }, [query, contactsByBook, bookName])

  // Keep the highlighted row in view as the cursor moves.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, hits])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) onPick(hit.bookUid, hit.item.itemUid)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search all contacts"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0) // new query → highlight the top match
          }}
          onKeyDown={onKeyDown}
          placeholder="Search all address books…"
          className="border-b border-border bg-surface px-4 py-3 text-sm text-text outline-none placeholder:text-text-faint"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {query.trim() === '' ? (
            <p className="px-4 py-6 text-center text-xs text-text-faint">
              Type to search across every address book.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-text-faint">
              No matching contacts.
            </p>
          ) : (
            hits.map((hit, i) => {
              const sub = subtitleOf(hit.item)
              return (
                <button
                  key={`${hit.bookUid}:${hit.item.itemUid}`}
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(hit.bookUid, hit.item.itemUid)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                    i === active ? 'bg-surface-2' : ''
                  }`}
                >
                  <Avatar card={hit.item.card} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">
                      {hit.item.card.fn || '(no name)'}
                    </span>
                    {sub && (
                      <span className="block truncate text-[11px] text-text-faint">
                        {sub}
                      </span>
                    )}
                  </span>
                  <span className="ml-2 max-w-[35%] shrink-0 truncate text-[10px] text-text-faint">
                    {hit.bookName}
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-faint">
          ↑↓ navigate · ↵ open · esc close
          {hits.length >= MAX_RESULTS ? ` · first ${MAX_RESULTS} shown` : ''}
        </div>
      </div>
    </div>
  )
}
