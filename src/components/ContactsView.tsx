import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, ContactItem, VCard } from '../types'
import {
  createAddressBook,
  createContact,
  deleteCollection,
  deleteContact,
  listAddressBooks,
  listContactItems,
  logout,
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
import {
  registerSyncAllHandler,
  setModuleSyncFailed,
  setModuleSyncing,
} from '../services/syncStatus'
import { useInactiveOpacities } from '../hooks/useInactiveOpacities'
import { ContactCard, Avatar } from './contacts/ContactCard'
import { ContactEditor } from './contacts/ContactEditor'
import { ConfirmModal } from './ConfirmModal'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { ContactsSettingsPopover } from './ContactsSettingsPopover'
import { Hint } from './Hint'

type Mode = 'view' | 'edit' | 'create'
type ContactsFocusZone = 'books' | 'list' | 'detail'

const FOCUS_ZONE_KEY = 'ete-sthetic.contacts.focusZone'

function readFocusZone(): ContactsFocusZone {
  try {
    const raw = localStorage.getItem(FOCUS_ZONE_KEY)
    if (raw === 'books' || raw === 'list' || raw === 'detail') return raw
  } catch {
    /* ignore */
  }
  return 'list'
}

const ZOOM_MIN = 0.6
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const ZOOM_KEY: Record<ContactsFocusZone, string> = {
  books: 'ete-sthetic.contacts.zoom.books',
  list: 'ete-sthetic.contacts.zoom.list',
  detail: 'ete-sthetic.contacts.zoom.detail',
}

function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n * 100) / 100))
}

function readZoom(zone: ContactsFocusZone): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY[zone])
    if (raw == null) return 1
    return clampZoom(Number(raw))
  } catch {
    return 1
  }
}

function writeZoom(zone: ContactsFocusZone, value: number) {
  try {
    localStorage.setItem(ZOOM_KEY[zone], String(value))
  } catch {
    /* not fatal */
  }
}

const BOOKS_WIDTH_KEY = 'ete-sthetic.contacts.booksWidth'
const LIST_WIDTH_KEY = 'ete-sthetic.contacts.listWidth'
const BOOKS_MIN_WIDTH = 140
const BOOKS_MAX_WIDTH = 360
const BOOKS_DEFAULT_WIDTH = 208 // matches the legacy w-52
const LIST_MIN_WIDTH = 220
const LIST_MAX_WIDTH = 600
const LIST_DEFAULT_WIDTH = 320 // matches the legacy w-80

function readPaneWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return n
  } catch {
    return fallback
  }
}

function writePaneWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* not fatal */
  }
}

// Adaptive sync settings (all in minutes; 0 = off/manual). Mirrors the
// tasks module: the active book refreshes frequently, other books much
// less often, switching to a book kicks a delta sync only if its
// snapshot is older than the freshness window.
const CONTACTS_ACTIVE_SYNC_KEY = 'ete-sthetic.contacts.activeSyncMin'
const CONTACTS_BG_SYNC_KEY = 'ete-sthetic.contacts.bgSyncMin'
const CONTACTS_SWITCH_FRESH_KEY = 'ete-sthetic.contacts.switchFreshMin'
const CONTACTS_ACTIVE_SYNC_OPTIONS = [0, 1, 5, 15, 30, 60] as const
const CONTACTS_BG_SYNC_OPTIONS = [0, 30, 60, 240, 720, 1440] as const
const CONTACTS_SWITCH_FRESH_OPTIONS = [0, 15, 30, 60, 240] as const
const CONTACTS_DEFAULT_ACTIVE_SYNC_MIN = 5
const CONTACTS_DEFAULT_BG_SYNC_MIN = 240
const CONTACTS_DEFAULT_SWITCH_FRESH_MIN = 60

function readIntPref(
  key: string,
  options: readonly number[],
  fallback: number,
): number {
  try {
    const v = Number(localStorage.getItem(key))
    return options.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function writeIntPref(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    /* not fatal */
  }
}

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

interface ContactsViewProps {
  onLoggedOut: () => void
}

export function ContactsView({ onLoggedOut }: ContactsViewProps) {
  const inactiveOpacities = useInactiveOpacities()
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
  // Last successful sync time per book — drives the "Synced HH:MM"
  // stamp in the contact-list header.
  const [lastSyncedAt, setLastSyncedAt] = useState<Map<string, number>>(
    () => new Map(getContactMemory().lastSyncedAt),
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
  // Per-book sync errors. A book lingers in this map until its next
  // successful sync — that way the user can spot which books need a
  // retry without the failure scrolling off-screen behind the next
  // operation's transient `error`.
  const [errorByBook, setErrorByBook] = useState<Map<string, string>>(
    () => new Map(),
  )
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

  // Zone meta-navigation. Mirrors the tasks module: Ctrl+L / Ctrl+T /
  // Ctrl+E target the three zones, Ctrl+←/→ step between them, and the
  // out-of-focus panes fade. Persisted so a remount lands where the
  // user left off.
  const [focusZone, setFocusZone] = useState<ContactsFocusZone>(readFocusZone)
  useEffect(() => {
    try {
      localStorage.setItem(FOCUS_ZONE_KEY, focusZone)
    } catch {
      /* ignore */
    }
  }, [focusZone])

  // Per-zone zoom (independent factors per pane). Ctrl/Cmd +/-/0 from
  // within the focused zone steps / resets it; the settings popover
  // exposes the same controls as labelled +/-/reset rows. Each zone's
  // factor is persisted independently.
  const [zoom, setZoom] = useState<Record<ContactsFocusZone, number>>(() => ({
    books: readZoom('books'),
    list: readZoom('list'),
    detail: readZoom('detail'),
  }))
  const adjustZoom = useCallback(
    (zone: ContactsFocusZone, delta: number | 'reset') => {
      setZoom((cur) => {
        const next = delta === 'reset' ? 1 : clampZoom(cur[zone] + delta)
        if (next === cur[zone]) return cur
        writeZoom(zone, next)
        return { ...cur, [zone]: next }
      })
    },
    [],
  )

  // Settings popover toggle.
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  // Adaptive-sync cadence. Active book refreshes on a fast cadence,
  // other books on a slow one, and switching to a book triggers a
  // delta sync only if its snapshot is older than the freshness
  // window. All three are exposed in the contacts settings popover.
  const [activeSyncMin, setActiveSyncMinState] = useState(() =>
    readIntPref(
      CONTACTS_ACTIVE_SYNC_KEY,
      CONTACTS_ACTIVE_SYNC_OPTIONS,
      CONTACTS_DEFAULT_ACTIVE_SYNC_MIN,
    ),
  )
  const [bgSyncMin, setBgSyncMinState] = useState(() =>
    readIntPref(
      CONTACTS_BG_SYNC_KEY,
      CONTACTS_BG_SYNC_OPTIONS,
      CONTACTS_DEFAULT_BG_SYNC_MIN,
    ),
  )
  const [switchFreshMin, setSwitchFreshMinState] = useState(() =>
    readIntPref(
      CONTACTS_SWITCH_FRESH_KEY,
      CONTACTS_SWITCH_FRESH_OPTIONS,
      CONTACTS_DEFAULT_SWITCH_FRESH_MIN,
    ),
  )
  const setActiveSyncMin = useCallback((n: number) => {
    setActiveSyncMinState(n)
    writeIntPref(CONTACTS_ACTIVE_SYNC_KEY, n)
  }, [])
  const setBgSyncMin = useCallback((n: number) => {
    setBgSyncMinState(n)
    writeIntPref(CONTACTS_BG_SYNC_KEY, n)
  }, [])
  const setSwitchFreshMin = useCallback((n: number) => {
    setSwitchFreshMinState(n)
    writeIntPref(CONTACTS_SWITCH_FRESH_KEY, n)
  }, [])

  // Drag-to-resize widths for the two left panes. The detail pane fills
  // the remaining space; only books and list carry an explicit width.
  const [booksWidth, setBooksWidth] = useState<number>(() =>
    readPaneWidth(BOOKS_WIDTH_KEY, BOOKS_DEFAULT_WIDTH),
  )
  const [listWidth, setListWidth] = useState<number>(() =>
    readPaneWidth(LIST_WIDTH_KEY, LIST_DEFAULT_WIDTH),
  )
  const [isResizingBooks, setIsResizingBooks] = useState(false)
  const [isResizingList, setIsResizingList] = useState(false)

  const handleBooksResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = booksWidth
      let latest = startWidth
      setIsResizingBooks(true)
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          BOOKS_MIN_WIDTH,
          Math.min(BOOKS_MAX_WIDTH, startWidth + (ev.clientX - startX)),
        )
        latest = next
        setBooksWidth(next)
      }
      const onUp = () => {
        setIsResizingBooks(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        writePaneWidth(BOOKS_WIDTH_KEY, latest)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [booksWidth],
  )

  const handleListResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = listWidth
      let latest = startWidth
      setIsResizingList(true)
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          LIST_MIN_WIDTH,
          Math.min(LIST_MAX_WIDTH, startWidth + (ev.clientX - startX)),
        )
        latest = next
        setListWidth(next)
      }
      const onUp = () => {
        setIsResizingList(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        writePaneWidth(LIST_WIDTH_KEY, latest)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [listWidth],
  )

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
      lastSyncedAt,
      activeBook,
      selectedContact: selectedUid,
      warmed: true,
    })
  }, [
    addressBooks,
    contactsByBook,
    stokenByBook,
    lastSyncedAt,
    activeBook,
    selectedUid,
  ])

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
      setLastSyncedAt((prev) => new Map(prev).set(uid, Date.now()))
      setError(null)
      // Successful sync clears any previously-recorded failure for this
      // book — the warning icon disappears from its row.
      setErrorByBook((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Map(prev)
        next.delete(uid)
        return next
      })
    } catch (e) {
      if (!cancelledRef.current && !isAbort(e)) {
        const m = message(e)
        setError(m)
        setErrorByBook((prev) => new Map(prev).set(uid, m))
      }
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
          setLastSyncedAt((p) =>
            new Map(p).set(active, snap.lastSyncedAt),
          )
        }
      }
      await syncBook(active)
    })()
    return () => {
      cancelled = true
    }
  }, [syncBook])

  // Adaptive cadence: while a book is active, refresh it on the fast
  // interval. Disabled when 0 ("manual"). Same shape as the tasks
  // module's active-list refresher.
  useEffect(() => {
    if (!activeBook || activeSyncMin <= 0) return
    const ms = activeSyncMin * 60_000
    const id = setInterval(() => {
      if (cancelledRef.current) return
      const last = getContactMemory().lastSyncedAt.get(activeBook)
      if (last === undefined || Date.now() - last >= ms) {
        void syncBook(activeBook)
      }
    }, ms)
    return () => clearInterval(id)
  }, [activeBook, activeSyncMin, syncBook])

  // Adaptive cadence: every `bgSyncMin` minutes, refresh OTHER books
  // (everything except the active one) that haven't synced inside the
  // window. Disabled when 0.
  useEffect(() => {
    if (bgSyncMin <= 0 || !addressBooks) return
    const ms = bgSyncMin * 60_000
    const tick = () => {
      if (cancelledRef.current) return
      for (const b of liveBooks(addressBooks)) {
        if (b.uid === activeBook) continue
        const last = getContactMemory().lastSyncedAt.get(b.uid)
        if (last === undefined || Date.now() - last >= ms) {
          void syncBook(b.uid)
        }
      }
    }
    const id = setInterval(tick, ms)
    return () => clearInterval(id)
  }, [bgSyncMin, addressBooks, activeBook, syncBook])

  // Push contacts-module sync state into the global SyncStatusPill.
  useEffect(() => {
    setModuleSyncing('contacts', syncing.size > 0)
  }, [syncing])
  useEffect(() => {
    setModuleSyncFailed('contacts', errorByBook.size > 0)
  }, [errorByBook])
  // Sync-all handler: kick a syncBook for every live book. Failures
  // surface via errorByBook (above); we don't need to re-throw here.
  useEffect(() => {
    const syncAll = async () => {
      const live = addressBooks
        ? addressBooks.filter((b) => !b.isDeleted)
        : []
      await Promise.all(live.map((b) => syncBook(b.uid)))
    }
    return registerSyncAllHandler('contacts', syncAll)
  }, [addressBooks, syncBook])

  const activeContacts = activeBook ? contactsByBook.get(activeBook) : undefined

  const books = useMemo(
    () => (addressBooks ? liveBooks(addressBooks) : []),
    [addressBooks],
  )

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
      // Switching to a book kicks a delta sync only if it has nothing
      // cached or its snapshot is older than the freshness window. The
      // cold-cache snapshot path always syncs (we have no `lastSyncedAt`
      // until the snapshot is loaded). When `switchFreshMin === 0` the
      // user picked "Always" — every switch syncs.
      const freshMs = switchFreshMin * 60_000
      const isStale = (last: number | undefined) =>
        switchFreshMin === 0 ||
        last === undefined ||
        Date.now() - last >= freshMs
      if (!contactsByBook.has(uid)) {
        void (async () => {
          const snap = await loadContactSnapshot(uid)
          if (cancelledRef.current) return
          if (snap) {
            setContactsByBook((p) => new Map(p).set(uid, snap.contacts))
            if (snap.stoken) {
              setStokenByBook((p) => new Map(p).set(uid, snap.stoken!))
            }
            setLastSyncedAt((p) =>
              new Map(p).set(uid, snap.lastSyncedAt),
            )
            if (isStale(snap.lastSyncedAt)) void syncBook(uid)
          } else {
            // No snapshot at all — cold load.
            void syncBook(uid)
          }
        })()
      } else if (isStale(lastSyncedAt.get(uid))) {
        void syncBook(uid)
      }
    },
    [activeBook, contactsByBook, syncBook, switchFreshMin, lastSyncedAt],
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
      if (mode !== 'view') return
      if (document.querySelector('[role="dialog"]')) return

      // Ctrl/Cmd +/-/0 → zoom the currently-focused zone. Honored even
      // from inside text inputs (it's a global view control).
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          adjustZoom(focusZone, ZOOM_STEP)
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          adjustZoom(focusZone, -ZOOM_STEP)
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          adjustZoom(focusZone, 'reset')
          return
        }
      }

      // Ctrl/Cmd+N → new contact. Honored even from inside the search
      // field so the search filter doesn't have to be cleared first.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'n' || e.key === 'N')
      ) {
        e.preventDefault()
        startCreate()
        return
      }
      // Ctrl/Cmd+F → focus the contact-list search bar. Honored from any
      // zone (mirrors the tasks module's filter shortcut) and overrides
      // the browser's native find dialog.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'f' || e.key === 'F')
      ) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      // Zone meta-navigation. Ctrl+L / Ctrl+T / Ctrl+E jump straight to
      // a zone; Ctrl+←/→ step through them. Honored even from text
      // fields except Ctrl+←/→, which yield to native word-jump there.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault()
          setFocusZone('books')
          return
        }
        if (!e.shiftKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault()
          setFocusZone('list')
          return
        }
        if (e.key === 'e' || e.key === 'E') {
          e.preventDefault()
          setFocusZone('detail')
          return
        }
        if (!typing && e.key === 'ArrowRight') {
          e.preventDefault()
          setFocusZone((z) =>
            z === 'books' ? 'list' : z === 'list' ? 'detail' : z,
          )
          return
        }
        if (!typing && e.key === 'ArrowLeft') {
          e.preventDefault()
          setFocusZone((z) =>
            z === 'detail' ? 'list' : z === 'list' ? 'books' : z,
          )
          return
        }
      }
      if (typing) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
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
        // From the books zone, arrow keys page through address books
        // (mirrors the tasks sidebar). From the list zone (or anywhere
        // else by default), they walk the contact list.
        if (focusZone === 'books') {
          const list = books
          if (list.length === 0) return
          e.preventDefault()
          const idx = list.findIndex((c) => c.uid === activeBook)
          const delta = e.key === 'ArrowDown' ? 1 : -1
          const next = Math.min(
            list.length - 1,
            Math.max(0, (idx < 0 ? 0 : idx) + delta),
          )
          selectBook(list[next].uid)
          return
        }
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
  }, [
    mode,
    search,
    selectedUid,
    filtered,
    startCreate,
    startEdit,
    focusZone,
    adjustZoom,
    books,
    activeBook,
    selectBook,
  ])

  const deletingContact = deletingUid
    ? (activeContacts?.find((c) => c.itemUid === deletingUid) ?? null)
    : null

  return (
    <div className="flex h-screen bg-bg text-text">
      {/* ---- Address books ---- */}
      <aside
        onMouseDown={() => setFocusZone('books')}
        style={{
          width: booksWidth,
          zoom: zoom.books,
          opacity: focusZone === 'books' ? 1 : inactiveOpacities.sidebar,
        }}
        className={`relative flex shrink-0 flex-col border-r border-border bg-surface ${
          isResizingBooks
            ? 'select-none'
            : 'transition-opacity duration-300 ease-out'
        }`}
      >
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
              // Outer is a div+role rather than a <button> so the pencil
              // can be a real nested <button> (nested buttons are invalid
              // HTML). Enter / Space on the row activates it like a
              // button would.
              <div
                key={b.uid}
                role="button"
                tabIndex={0}
                onClick={() => selectBook(b.uid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectBook(b.uid)
                  }
                }}
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
                className={`group mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  b.uid === activeBook
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {syncing.has(b.uid) && (
                  <span className="text-[10px] text-text-faint">↻</span>
                )}
                {!syncing.has(b.uid) && errorByBook.has(b.uid) && (
                  // Click the warning to re-surface this book's failure
                  // in the main error banner (it can scroll behind newer
                  // ops otherwise). `stopPropagation` so the row's click
                  // doesn't fire underneath us.
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation()
                      const msg = errorByBook.get(b.uid)
                      if (msg) setError(`${b.name}: ${msg}`)
                    }}
                    aria-label={`Last sync of ${b.name} failed`}
                    title={errorByBook.get(b.uid)}
                    className="text-[11px] leading-none text-danger hover:text-danger/80"
                  >
                    ⚠
                  </button>
                )}
                {/* Hover-revealed rename affordance — the right-click
                    "Rename" item still exists; this just makes the
                    feature discoverable without right-clicking. */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setBookDraft({ mode: 'rename', uid: b.uid })
                    setBookDraftText(b.name)
                  }}
                  aria-label={`Rename ${b.name}`}
                  title="Rename"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-opacity hover:bg-bg/40 hover:text-text group-hover:opacity-100 focus:opacity-100"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M11 2l3 3-8 8-3.5.5.5-3.5 8-8z" />
                  </svg>
                </button>
              </div>
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
        {/* Drag handle: 1.5px wide accent strip on the right edge,
            visible on hover and while resizing. Stops the row's own
            onMouseDown→setFocusZone from firing during a drag. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize address books"
          onMouseDown={(e) => {
            e.stopPropagation()
            handleBooksResizeStart(e)
          }}
          className="group absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
        >
          <div
            className={`mx-auto h-full w-px transition-colors ${
              isResizingBooks
                ? 'bg-accent'
                : 'bg-transparent group-hover:bg-accent/40'
            }`}
          />
        </div>
      </aside>

      {/* ---- Contact list ---- */}
      <div
        onMouseDown={() => setFocusZone('list')}
        style={{
          width: listWidth,
          zoom: zoom.list,
          opacity: focusZone === 'list' ? 1 : inactiveOpacities.middle,
        }}
        className={`relative flex shrink-0 flex-col border-r border-border bg-surface ${
          isResizingList
            ? 'select-none'
            : 'transition-opacity duration-300 ease-out'
        }`}
      >
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
            title="New contact (Ctrl+N)"
            aria-label="New contact"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            +
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-label="Contacts settings"
              aria-expanded={settingsOpen}
              title="Settings"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
              </svg>
            </button>
            {settingsOpen && (
              <ContactsSettingsPopover
                booksZoomPct={Math.round(zoom.books * 100)}
                onBooksZoom={(d) => adjustZoom('books', d)}
                listZoomPct={Math.round(zoom.list * 100)}
                onListZoom={(d) => adjustZoom('list', d)}
                detailZoomPct={Math.round(zoom.detail * 100)}
                onDetailZoom={(d) => adjustZoom('detail', d)}
                activeSyncMin={activeSyncMin}
                activeSyncOptions={CONTACTS_ACTIVE_SYNC_OPTIONS}
                onSetActiveSync={setActiveSyncMin}
                bgSyncMin={bgSyncMin}
                bgSyncOptions={CONTACTS_BG_SYNC_OPTIONS}
                onSetBgSync={setBgSyncMin}
                switchFreshMin={switchFreshMin}
                switchFreshOptions={CONTACTS_SWITCH_FRESH_OPTIONS}
                onSetSwitchFresh={setSwitchFreshMin}
                onLogout={handleLogout}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
        <div className="border-b border-border px-3 pb-2 text-[11px] text-text-faint">
          {filtered.length} contact{filtered.length === 1 ? '' : 's'}
          {search && activeContacts ? ` of ${activeContacts.length}` : ''}
          {activeBook && (
            <>
              {' · '}
              {syncing.has(activeBook) ? (
                <span className="text-text-muted">Syncing…</span>
              ) : lastSyncedAt.has(activeBook) ? (
                <span title="Last successful sync">
                  Synced{' '}
                  {new Date(lastSyncedAt.get(activeBook)!).toLocaleTimeString(
                    [],
                    { hour: '2-digit', minute: '2-digit' },
                  )}
                </span>
              ) : (
                <span>Never synced</span>
              )}
            </>
          )}
          {(() => {
            // Global tally across all books: "N syncing" and "N failed"
            // suffixes so a stale background sync or a failure on a
            // non-active book is visible without having to click into
            // it. Each chip uses a colour that matches its severity.
            const syncingCount = syncing.size
            const failedCount = errorByBook.size
            const otherSyncing =
              activeBook && syncing.has(activeBook)
                ? syncingCount - 1
                : syncingCount
            return (
              <>
                {otherSyncing > 0 && (
                  <>
                    {' · '}
                    <span className="text-text-muted">
                      Syncing {otherSyncing} other{otherSyncing === 1 ? '' : 's'}…
                    </span>
                  </>
                )}
                {failedCount > 0 && (
                  <>
                    {' · '}
                    <span
                      className="text-danger"
                      title="Click a book's ⚠ icon for the failure message"
                    >
                      {failedCount} failed
                    </span>
                  </>
                )}
              </>
            )
          })()}
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
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                  it.itemUid === selectedUid && mode === 'view'
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface-2'
                }`}
              >
                <Avatar card={it.card} size={36} />
                {/* Up to three rows — name, then org/title, then a
                    compact email · phone line — using the list pane's
                    spare vertical/horizontal space instead of dropping
                    everything past the first chip. Lines are skipped
                    when their underlying field is empty, so a bare
                    contact (FN only) still renders as a compact row. */}
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block truncate text-sm text-text">
                    {it.card.fn || '(no name)'}
                  </span>
                  {(it.card.org || it.card.title) && (
                    <span className="block truncate text-xs text-text-muted">
                      {it.card.org || it.card.title}
                    </span>
                  )}
                  {(it.card.emails[0] || it.card.phones[0]) && (
                    <span className="block truncate text-[11px] text-text-faint">
                      {[
                        it.card.emails[0]?.value,
                        it.card.phones[0]?.value,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize contact list"
          onMouseDown={(e) => {
            e.stopPropagation()
            handleListResizeStart(e)
          }}
          className="group absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
        >
          <div
            className={`mx-auto h-full w-px transition-colors ${
              isResizingList
                ? 'bg-accent'
                : 'bg-transparent group-hover:bg-accent/40'
            }`}
          />
        </div>
      </div>

      {/* ---- Detail / editor ---- */}
      <section
        onMouseDown={() => setFocusZone('detail')}
        style={{
          zoom: zoom.detail,
          opacity: focusZone === 'detail' ? 1 : inactiveOpacities.detail,
        }}
        className="flex min-w-0 flex-1 flex-col bg-bg transition-opacity duration-300 ease-out"
      >
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
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-sm text-text-faint">
              <p>
                Select a contact to view it, or press{' '}
                <kbd>Ctrl</kbd>+<kbd>N</kbd> for a new one.
              </p>
              <Hint id="contacts.empty-detail-keyboard" variant="card">
                <kbd className="font-mono">/</kbd> to search ·{' '}
                <kbd className="font-mono">Ctrl</kbd>+
                <kbd className="font-mono">L</kbd>/
                <kbd className="font-mono">T</kbd>/
                <kbd className="font-mono">E</kbd> to switch zones.
              </Hint>
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
