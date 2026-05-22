import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, ContactItem, VCard } from '../types'
import {
  createAddressBook,
  createContact,
  deleteCollection,
  deleteContact,
  listAddressBooks,
  listContactItems,
  updateCollectionMeta,
  updateContact,
  type ContactSyncResult,
} from '../services/etebase'
import { emptyVCard } from '../services/vcard'
import {
  loadContactSnapshot,
  saveContactSnapshot,
} from '../services/contactsnapshot'
import { getContactMemory, patchContactMemory } from '../services/contactstore'
import { ContactCard, Avatar } from './contacts/ContactCard'
import { ContactEditor } from './contacts/ContactEditor'
import { ConfirmModal } from './ConfirmModal'
import { ContextMenu, type ContextMenuState } from './ContextMenu'

type Mode = 'view' | 'edit' | 'create'

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

// Merge an incremental sync delta into the existing contact list.
function mergeContacts(
  existing: ContactItem[],
  result: ContactSyncResult,
): ContactItem[] {
  const byUid = new Map(existing.map((c) => [c.itemUid, c]))
  for (const uid of result.removed) byUid.delete(uid)
  for (const it of result.items) byUid.set(it.itemUid, it)
  return [...byUid.values()]
}

function liveBooks(books: CollectionInfo[]): CollectionInfo[] {
  return books.filter((b) => !b.isDeleted)
}

function sortContacts(contacts: ContactItem[]): ContactItem[] {
  return [...contacts].sort((a, b) =>
    a.card.fn.localeCompare(b.card.fn, undefined, { sensitivity: 'base' }),
  )
}

function subtitleOf(card: VCard): string {
  return (
    card.org ||
    card.emails[0]?.value ||
    card.phones[0]?.value ||
    card.title ||
    ''
  )
}

export function ContactsView() {
  // Seeded synchronously from the process-lifetime cache so a module
  // switch and back is instant (no flash, no spinner).
  const [addressBooks, setAddressBooks] = useState<CollectionInfo[] | null>(
    () => getContactMemory().addressBooks,
  )
  const [contactsByBook, setContactsByBook] = useState<
    Map<string, ContactItem[]>
  >(() => new Map(getContactMemory().contactsByBook))
  const [stokenByBook, setStokenByBook] = useState<Map<string, string>>(
    () => new Map(getContactMemory().stokenByBook),
  )
  const [activeBook, setActiveBook] = useState<string | null>(
    () => getContactMemory().activeBook,
  )
  const [selectedUid, setSelectedUid] = useState<string | null>(
    () => getContactMemory().selectedContact,
  )
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<Mode>('view')
  const [editorSeed, setEditorSeed] = useState<VCard | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [savingContact, setSavingContact] = useState(false)
  const [deletingUid, setDeletingUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<Set<string>>(() => new Set())
  const [booksLoading, setBooksLoading] = useState(
    () => getContactMemory().addressBooks == null,
  )

  // Address-book inline editing.
  const [bookDraft, setBookDraft] = useState<
    { mode: 'create' } | { mode: 'rename'; uid: string } | null
  >(null)
  const [bookDraftText, setBookDraftText] = useState('')
  const [deletingBook, setDeletingBook] = useState<CollectionInfo | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  const cancelledRef = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Mirror state into the process-lifetime cache so a module switch and
  // back is instant (matches calstore / taskstore).
  useEffect(() => {
    patchContactMemory({
      addressBooks,
      contactsByBook,
      stokenByBook,
      activeBook,
      selectedContact: selectedUid,
      warmed: true,
    })
  }, [addressBooks, contactsByBook, stokenByBook, activeBook, selectedUid])

  // Persist the active book's contacts to disk (debounced) so a cold start
  // renders instantly from the snapshot before the network sync lands.
  useEffect(() => {
    if (!activeBook) return
    const contacts = contactsByBook.get(activeBook)
    if (!contacts) return
    const id = setTimeout(() => {
      void saveContactSnapshot({
        version: 1,
        uid: activeBook,
        contacts,
        stoken: stokenByBook.get(activeBook),
        lastSyncedAt: Date.now(),
      })
    }, 400)
    return () => clearTimeout(id)
  }, [activeBook, contactsByBook, stokenByBook])

  // Sync one address book — full when it has no stoken yet, incremental
  // otherwise.
  const syncBook = useCallback(async (uid: string) => {
    setSyncing((s) => new Set(s).add(uid))
    try {
      const fromStoken = getContactMemory().stokenByBook.get(uid) || undefined
      const result = await listContactItems(uid, { fromStoken })
      if (cancelledRef.current) return
      const existing = getContactMemory().contactsByBook.get(uid) ?? []
      const merged = fromStoken
        ? mergeContacts(existing, result)
        : result.items
      setContactsByBook((prev) => new Map(prev).set(uid, merged))
      if (result.stoken) {
        setStokenByBook((prev) => new Map(prev).set(uid, result.stoken))
      }
      // Auto-select the first contact (and drop a stale selection if the
      // user's pick was removed server-side). syncBook is always called
      // for the active book, so this only ever affects what's visible.
      setSelectedUid((prev) =>
        prev && merged.some((c) => c.itemUid === prev)
          ? prev
          : (sortContacts(merged)[0]?.itemUid ?? null),
      )
      setError(null)
    } catch (e) {
      if (!cancelledRef.current && !isAbort(e)) setError(message(e))
    } finally {
      if (!cancelledRef.current) {
        setSyncing((s) => {
          const n = new Set(s)
          n.delete(uid)
          return n
        })
      }
    }
  }, [])

  // First mount: seed instantly from the in-memory cache, then load the
  // address books from the network and sync the active one (disk snapshot
  // first for a cold start).
  // Network sync on mount. State was already seeded synchronously from
  // getContactMemory() via useState initializers, so this only fetches
  // deltas — no flash, no synchronous setState in the effect body.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let books: CollectionInfo[]
      try {
        books = await listAddressBooks()
      } catch (e) {
        if (!cancelled) {
          setError(message(e))
          setBooksLoading(false)
        }
        return
      }
      if (cancelled) return
      setAddressBooks(books)
      setBooksLoading(false)
      const live = liveBooks(books)
      const prev = getContactMemory().activeBook
      const active =
        prev && live.some((b) => b.uid === prev)
          ? prev
          : (live[0]?.uid ?? null)
      if (!active) return
      setActiveBook(active)
      if (!getContactMemory().contactsByBook.has(active)) {
        const snap = await loadContactSnapshot(active)
        if (cancelled) return
        if (snap) {
          setContactsByBook((p) => new Map(p).set(active, snap.contacts))
          if (snap.stoken) {
            setStokenByBook((p) => new Map(p).set(active, snap.stoken!))
          }
        }
      }
      await syncBook(active)
    })()
    return () => {
      cancelled = true
    }
  }, [syncBook])

  const activeContacts = activeBook ? contactsByBook.get(activeBook) : undefined

  const filtered = useMemo(() => {
    const all = sortContacts(activeContacts ?? [])
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((it) => {
      const c = it.card
      return (
        c.fn.toLowerCase().includes(q) ||
        c.org.toLowerCase().includes(q) ||
        c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
        c.phones.some((p) => p.value.toLowerCase().includes(q)) ||
        c.categories.some((cat) => cat.toLowerCase().includes(q))
      )
    })
  }, [activeContacts, search])

  const selectedItem = useMemo(
    () =>
      activeContacts?.find((c) => c.itemUid === selectedUid) ?? null,
    [activeContacts, selectedUid],
  )

  const selectBook = useCallback(
    (uid: string) => {
      if (uid === activeBook) return
      setActiveBook(uid)
      setSelectedUid(null)
      setMode('view')
      setSearch('')
      if (!contactsByBook.has(uid)) {
        void (async () => {
          const snap = await loadContactSnapshot(uid)
          if (cancelledRef.current) return
          if (snap) {
            setContactsByBook((p) => new Map(p).set(uid, snap.contacts))
            if (snap.stoken) {
              setStokenByBook((p) => new Map(p).set(uid, snap.stoken!))
            }
          }
          void syncBook(uid)
        })()
      } else {
        void syncBook(uid)
      }
    },
    [activeBook, contactsByBook, syncBook],
  )

  // ---- contact mutations ----

  const startCreate = useCallback(() => {
    if (!activeBook) return
    setEditorSeed(emptyVCard())
    setEditorKey((k) => k + 1)
    setMode('create')
  }, [activeBook])

  const startEdit = useCallback(() => {
    if (!selectedItem) return
    setEditorSeed(selectedItem.card)
    setEditorKey((k) => k + 1)
    setMode('edit')
  }, [selectedItem])

  const handleSaveContact = useCallback(
    async (card: VCard) => {
      if (!activeBook) return
      setSavingContact(true)
      setError(null)
      try {
        if (mode === 'create') {
          const created = await createContact(activeBook, card)
          if (cancelledRef.current) return
          setContactsByBook((prev) => {
            const next = new Map(prev)
            next.set(activeBook, [
              ...(next.get(activeBook) ?? []),
              created,
            ])
            return next
          })
          setSelectedUid(created.itemUid)
        } else if (selectedItem) {
          const updated = await updateContact(
            activeBook,
            selectedItem.itemUid,
            card,
          )
          if (cancelledRef.current) return
          setContactsByBook((prev) => {
            const next = new Map(prev)
            next.set(
              activeBook,
              (next.get(activeBook) ?? []).map((c) =>
                c.itemUid === updated.itemUid ? updated : c,
              ),
            )
            return next
          })
        }
        setMode('view')
      } catch (e) {
        if (!cancelledRef.current) setError(message(e))
      } finally {
        if (!cancelledRef.current) setSavingContact(false)
      }
    },
    [activeBook, mode, selectedItem],
  )

  const confirmDeleteContact = useCallback(async () => {
    const uid = deletingUid
    if (!uid || !activeBook) return
    setDeletingUid(null)
    setError(null)
    try {
      await deleteContact(activeBook, uid)
      if (cancelledRef.current) return
      setContactsByBook((prev) => {
        const next = new Map(prev)
        next.set(
          activeBook,
          (next.get(activeBook) ?? []).filter((c) => c.itemUid !== uid),
        )
        return next
      })
      if (selectedUid === uid) setSelectedUid(null)
    } catch (e) {
      if (!cancelledRef.current) setError(message(e))
    }
  }, [deletingUid, activeBook, selectedUid])

  // ---- address-book mutations ----

  const commitBookDraft = useCallback(async () => {
    const draft = bookDraft
    const name = bookDraftText.trim()
    setBookDraft(null)
    setBookDraftText('')
    if (!draft || !name) return
    try {
      if (draft.mode === 'create') {
        const book = await createAddressBook(name)
        if (cancelledRef.current) return
        setAddressBooks((prev) => [...(prev ?? []), book])
        selectBook(book.uid)
      } else {
        const updated = await updateCollectionMeta(draft.uid, { name })
        if (cancelledRef.current) return
        setAddressBooks((prev) =>
          (prev ?? []).map((b) => (b.uid === draft.uid ? updated : b)),
        )
      }
    } catch (e) {
      if (!cancelledRef.current) setError(message(e))
    }
  }, [bookDraft, bookDraftText, selectBook])

  const confirmDeleteBook = useCallback(async () => {
    const book = deletingBook
    if (!book) return
    setDeletingBook(null)
    try {
      await deleteCollection(book.uid)
      if (cancelledRef.current) return
      setAddressBooks((prev) => (prev ?? []).filter((b) => b.uid !== book.uid))
      if (activeBook === book.uid) {
        const remaining = liveBooks(
          (addressBooks ?? []).filter((b) => b.uid !== book.uid),
        )
        setActiveBook(remaining[0]?.uid ?? null)
        setSelectedUid(null)
      }
    } catch (e) {
      if (!cancelledRef.current) setError(message(e))
    }
  }, [deletingBook, activeBook, addressBooks])

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      const typing =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      if (e.key === 'Escape') {
        if (mode !== 'view') {
          setMode('view')
        } else if (search) {
          setSearch('')
        }
        return
      }
      if (typing || mode !== 'view') return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        startCreate()
        return
      }
      if (e.key === 'Enter' && selectedUid) {
        // Enter on the selected contact opens it for editing — matches
        // the user's "Enter opens the detail" mental model (the detail
        // pane is always visible, so "open" = enter edit mode).
        e.preventDefault()
        startEdit()
        return
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedUid
      ) {
        e.preventDefault()
        setDeletingUid(selectedUid)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (filtered.length === 0) return
        e.preventDefault()
        const idx = filtered.findIndex((c) => c.itemUid === selectedUid)
        const delta = e.key === 'ArrowDown' ? 1 : -1
        const next = Math.min(
          filtered.length - 1,
          Math.max(0, (idx < 0 ? 0 : idx) + delta),
        )
        setSelectedUid(filtered[next].itemUid)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, search, selectedUid, filtered, startCreate, startEdit])

  const books = addressBooks ? liveBooks(addressBooks) : []
  const deletingContact = deletingUid
    ? (activeContacts?.find((c) => c.itemUid === deletingUid) ?? null)
    : null

  return (
    <div className="flex h-screen bg-bg text-text">
      {/* ---- Address books ---- */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-faint">
            Address books
          </span>
          <button
            type="button"
            onClick={() => {
              setBookDraft({ mode: 'create' })
              setBookDraftText('')
            }}
            title="New address book"
            aria-label="New address book"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {booksLoading && books.length === 0 && (
            <p className="px-2 py-1 text-xs text-text-faint">Loading…</p>
          )}
          {books.map((b) =>
            bookDraft?.mode === 'rename' && bookDraft.uid === b.uid ? (
              <input
                key={b.uid}
                autoFocus
                value={bookDraftText}
                onChange={(e) => setBookDraftText(e.target.value)}
                onBlur={commitBookDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitBookDraft()
                  else if (e.key === 'Escape') {
                    setBookDraft(null)
                    setBookDraftText('')
                  }
                }}
                className="mb-0.5 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
              />
            ) : (
              <button
                key={b.uid}
                type="button"
                onClick={() => selectBook(b.uid)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      {
                        label: 'Rename',
                        onSelect: () => {
                          setBookDraft({ mode: 'rename', uid: b.uid })
                          setBookDraftText(b.name)
                        },
                      },
                      {
                        label: 'Delete',
                        danger: true,
                        onSelect: () => setDeletingBook(b),
                      },
                    ],
                  })
                }}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  b.uid === activeBook
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {syncing.has(b.uid) && (
                  <span className="text-[10px] text-text-faint">↻</span>
                )}
              </button>
            ),
          )}
          {bookDraft?.mode === 'create' && (
            <input
              autoFocus
              value={bookDraftText}
              placeholder="Address book name"
              onChange={(e) => setBookDraftText(e.target.value)}
              onBlur={commitBookDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitBookDraft()
                else if (e.key === 'Escape') {
                  setBookDraft(null)
                  setBookDraftText('')
                }
              }}
              className="mb-0.5 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-border-strong"
            />
          )}
          {!booksLoading && books.length === 0 && !bookDraft && (
            <p className="px-2 py-1 text-xs text-text-faint">
              No address books yet.
            </p>
          )}
        </div>
      </aside>

      {/* ---- Contact list ---- */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-3">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-border-strong"
          />
          <button
            type="button"
            onClick={() => activeBook && void syncBook(activeBook)}
            disabled={!activeBook || (!!activeBook && syncing.has(activeBook))}
            title="Sync this address book"
            aria-label="Sync"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-faint transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={startCreate}
            disabled={!activeBook}
            title="New contact (n)"
            aria-label="New contact"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            +
          </button>
        </div>
        <div className="border-b border-border px-3 pb-2 text-[11px] text-text-faint">
          {filtered.length} contact{filtered.length === 1 ? '' : 's'}
          {search && activeContacts ? ` of ${activeContacts.length}` : ''}
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.map((it) => (
            <li key={it.itemUid}>
              <button
                type="button"
                onClick={() => {
                  setSelectedUid(it.itemUid)
                  setMode('view')
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  it.itemUid === selectedUid && mode === 'view'
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface-2'
                }`}
              >
                <Avatar card={it.card} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">
                    {it.card.fn || '(no name)'}
                  </span>
                  {subtitleOf(it.card) && (
                    <span className="block truncate text-xs text-text-faint">
                      {subtitleOf(it.card)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {activeContacts && filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-text-faint">
              {search
                ? 'No contacts match your search.'
                : activeBook
                  ? 'No contacts yet — press + to add one.'
                  : 'Select an address book.'}
            </li>
          )}
          {!activeContacts && activeBook && (
            <li className="px-3 py-6 text-center text-xs text-text-faint">
              Loading contacts…
            </li>
          )}
        </ul>
      </div>

      {/* ---- Detail / editor ---- */}
      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        {error && (
          <div className="flex items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-text-muted">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 text-text-faint hover:text-text"
            >
              ×
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {(mode === 'edit' || mode === 'create') && editorSeed ? (
            <ContactEditor
              key={editorKey}
              initial={editorSeed}
              isNew={mode === 'create'}
              saving={savingContact}
              onSave={handleSaveContact}
              onCancel={() => setMode('view')}
            />
          ) : selectedItem ? (
            <ContactCard
              card={selectedItem.card}
              pending={false}
              onEdit={startEdit}
              onDelete={() => setDeletingUid(selectedItem.itemUid)}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-faint">
              Select a contact to view it, or press <kbd>n</kbd> for a new one.
            </div>
          )}
        </div>
      </section>

      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
      {deletingContact && (
        <ConfirmModal
          title="Delete contact?"
          body={`"${deletingContact.card.fn}" will be permanently removed from this address book.`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteContact}
          onCancel={() => setDeletingUid(null)}
        />
      )}
      {deletingBook && (
        <ConfirmModal
          title="Delete address book?"
          body={`"${deletingBook.name}" and all of its contacts will be removed.`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteBook}
          onCancel={() => setDeletingBook(null)}
        />
      )}
    </div>
  )
}
