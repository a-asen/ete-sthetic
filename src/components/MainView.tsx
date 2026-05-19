import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createCollection,
  createTask,
  deleteCollection,
  deleteTasks,
  listCollections,
  listTaskItems,
  logout,
  moveTasksToCollection,
  updateTaskRaw,
  toggleComplete,
  updateCollectionMeta,
  updateTask,
} from '../services/etebase'
import {
  applyFilter,
  buildTree,
  collectDescendantItemUids,
  countTasks,
  findNodeByUid,
  getAncestorChain,
} from '../services/tree'
import { parseVTodo, updateVTodo, type VTodoPatch } from '../services/vtodo'
import {
  type CollectionSnapshot,
  deleteSnapshot,
  listSnapshotUids,
  loadSnapshot,
  saveSnapshot,
} from '../services/snapshots'
import {
  DEFAULT_TASK_SORT,
  type CollectionInfo,
  type Priority,
  type TaskItem,
  type TaskNode,
  type TaskSort,
  type TaskSortSpec,
} from '../types'
import { ConfirmModal } from './ConfirmModal'
import { DetailPanel } from './DetailPanel'
import { EditModeIndicator } from './EditModeIndicator'
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from './ContextMenu'
import {
  DEFAULT_FILTER,
  FilterPopover,
  isFilterActive,
  type FilterSpec,
} from './FilterPopover'
import { KeybindingsModal } from './KeybindingsModal'
import { MoveTaskPicker } from './MoveTaskPicker'
import { SortPopover, type SortOption } from './SortPopover'
import { TaskTree } from './TaskTree'
import { readTaskSort, writeTaskSort } from '../services/sort'
import {
  applyAccent,
  applyTheme,
  readStoredAccent,
  readStoredTheme,
  writeStoredAccent,
  writeStoredTheme,
  type Theme,
} from '../services/theme'

interface Props {
  onLoggedOut: () => void
}

const HIDE_COMPLETED_KEY = 'ete-stethic.hideCompleted'
const DETAIL_PINNED_KEY = 'ete-stethic.detailPanelPinned'
const SHOW_DELETED_LISTS_KEY = 'ete-stethic.showDeletedLists'
const SIDEBAR_SORT_KEY = 'ete-stethic.sidebarSort'
const PHONE_PRIORITY_KEY = 'ete-stethic.phoneFriendlyPriority'

type SidebarSort = 'name' | 'open' | 'total'

interface SidebarSortSpec {
  sort: SidebarSort
  reverse: boolean
}

const DEFAULT_SIDEBAR_SORT: SidebarSortSpec = { sort: 'name', reverse: false }

// Curated swatches for list colours — muted to fit the theme.
const LIST_COLORS = [
  '#d96f6f',
  '#d99a4e',
  '#d9c84e',
  '#6fb86f',
  '#4ea7a7',
  '#5e8fd9',
  '#9a7fd9',
  '#c97fb8',
  '#8a8f99',
]

// Curated accent presets (the default mint first).
const ACCENT_PRESETS = [
  '#2f8a6c',
  '#3b82f6',
  '#8b5cf6',
  '#e0699f',
  '#e07a3f',
  '#d9b23a',
  '#10b981',
  '#ef4444',
]

// Single source of truth for sidebar ordering — used both for rendering
// and for picking the default-selected list, so "the list we land on" is
// always the one shown first.
function sortCollections(
  list: CollectionInfo[],
  spec: SidebarSortSpec,
  itemsByUid: Map<string, TaskItem[]>,
): CollectionInfo[] {
  const byName = (a: CollectionInfo, b: CollectionInfo) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const sign = spec.reverse ? -1 : 1
  if (spec.sort === 'name') {
    return [...list].sort((a, b) => byName(a, b) * sign)
  }
  const count = (uid: string) => {
    const items = itemsByUid.get(uid)
    if (!items) return 0
    const c = countTasks(items)
    return spec.sort === 'open' ? c.open : c.total
  }
  return [...list].sort((a, b) => {
    const diff = count(b.uid) - count(a.uid)
    if (diff !== 0) return diff * sign
    return byName(a, b)
  })
}

const TASK_SORT_OPTIONS: Array<SortOption<TaskSort>> = [
  {
    value: 'priority',
    label: 'Priority',
    hint: 'High → low. priority=none always last.',
  },
  {
    value: 'due',
    label: 'Due date',
    hint: 'Soonest first. Tasks without a due date last.',
  },
  { value: 'created', label: 'Created date', hint: 'Oldest first by default.' },
  {
    value: 'summary',
    label: 'Title (A–Z)',
    hint: 'Alphabetical, case-insensitive.',
  },
]

const SIDEBAR_SORT_OPTIONS: Array<SortOption<SidebarSort>> = [
  {
    value: 'name',
    label: 'Name (A–Z)',
    hint: 'Alphabetical, case-insensitive.',
  },
  {
    value: 'open',
    label: 'Open count',
    hint: 'Most-open first. Lists still loading sort as zero.',
  },
  {
    value: 'total',
    label: 'Total count',
    hint: 'Largest first. Counts everything, completed or not.',
  },
]

function readSidebarSort(): SidebarSortSpec {
  try {
    const raw = localStorage.getItem(SIDEBAR_SORT_KEY)
    if (!raw) return DEFAULT_SIDEBAR_SORT
    const parsed = JSON.parse(raw) as Partial<SidebarSortSpec>
    const sort =
      parsed.sort === 'name' ||
      parsed.sort === 'open' ||
      parsed.sort === 'total'
        ? parsed.sort
        : DEFAULT_SIDEBAR_SORT.sort
    return { sort, reverse: parsed.reverse === true }
  } catch {
    return DEFAULT_SIDEBAR_SORT
  }
}

function writeSidebarSort(v: SidebarSortSpec) {
  try {
    localStorage.setItem(SIDEBAR_SORT_KEY, JSON.stringify(v))
  } catch {
    // not fatal
  }
}
const SIDEBAR_FOCUSED_WIDTH_KEY = 'ete-stethic.sidebarFocusedWidth'
const SIDEBAR_COLLAPSED_WIDTH_KEY = 'ete-stethic.sidebarCollapsedWidth'
// Sidebar resize bounds. Min keeps the colored dot + open-count visible;
// max stops the user shoving it past half the typical window.
const SIDEBAR_MIN_WIDTH = 32
const SIDEBAR_MAX_WIDTH = 480
// Above this width the sidebar renders list names (full row). Below, it
// renders dots + counts only (strip). Picked so the default collapsed
// width (48 px) is clearly under and the default focused width (208 px)
// is clearly over.
const SIDEBAR_FULL_THRESHOLD = 120
const PREFETCH_CONCURRENCY = 4
const HIDE_GRACE_MS = 5000

// Drag-and-drop: a task row carries its VTODO uid under this mime so a
// sidebar list row can accept the drop and move the subtree.
const TASK_DND_MIME = 'application/x-ete-task-uid'

interface MovePayload {
  itemUids: string[]
  rootVtodoUid: string
  summary: string
  descendantCount: number
}

function readHideCompleted(): boolean {
  try {
    return localStorage.getItem(HIDE_COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHideCompleted(value: boolean) {
  try {
    localStorage.setItem(HIDE_COMPLETED_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage unavailable; not fatal.
  }
}

function readDetailPinned(): boolean {
  try {
    return localStorage.getItem(DETAIL_PINNED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeDetailPinned(value: boolean) {
  try {
    localStorage.setItem(DETAIL_PINNED_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage unavailable; not fatal.
  }
}

function readShowDeletedLists(): boolean {
  try {
    return localStorage.getItem(SHOW_DELETED_LISTS_KEY) === 'true'
  } catch {
    return false
  }
}

function writeShowDeletedLists(value: boolean) {
  try {
    localStorage.setItem(SHOW_DELETED_LISTS_KEY, value ? 'true' : 'false')
  } catch {
    // not fatal
  }
}

function readPhonePriority(): boolean {
  try {
    return localStorage.getItem(PHONE_PRIORITY_KEY) === 'true'
  } catch {
    return false
  }
}

function writePhonePriority(value: boolean) {
  try {
    localStorage.setItem(PHONE_PRIORITY_KEY, value ? 'true' : 'false')
  } catch {
    // not fatal
  }
}

function readSidebarWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, n))
  } catch {
    return fallback
  }
}

function writeSidebarWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)))
  } catch {
    // not fatal
  }
}

// Per-zone zoom. Each focus zone (sidebar / tasks / details) keeps its
// own factor so the user can size the list, the task pane and the detail
// panel independently. Applied via the CSS `zoom` property (supported in
// the WebKit/WebView2 runtimes Tauri uses).
type ZoomZone = 'sidebar' | 'tasks' | 'details'
const ZOOM_MIN = 0.6
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const ZOOM_KEY: Record<ZoomZone, string> = {
  sidebar: 'ete-stethic.zoom.sidebar',
  tasks: 'ete-stethic.zoom.tasks',
  details: 'ete-stethic.zoom.details',
}

function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n * 100) / 100))
}

function readZoom(zone: ZoomZone): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY[zone])
    if (raw == null) return 1
    return clampZoom(Number(raw))
  } catch {
    return 1
  }
}

function writeZoom(zone: ZoomZone, value: number) {
  try {
    localStorage.setItem(ZOOM_KEY[zone], String(value))
  } catch {
    // not fatal
  }
}

export function MainView({ onLoggedOut }: Props) {
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)
  const [activeUid, setActiveUid] = useState<string | null>(null)

  // Bumped to force the collections-load effect to re-run after a
  // create/rename/delete. Also tracks the pending-list operation so the
  // sidebar can disable inputs and show errors.
  const [collectionsRefreshKey, setCollectionsRefreshKey] = useState(0)
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingListUid, setRenamingListUid] = useState<string | null>(null)
  const [renameListName, setRenameListName] = useState('')
  const [deletingList, setDeletingList] = useState<CollectionInfo | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  // Optimistic placeholders for lists being created (temp uid) and the
  // set of list uids in a create/delete round-trip — both drive a
  // "syncing" badge in the sidebar until the server confirms.
  const [pendingLists, setPendingLists] = useState<CollectionInfo[]>([])
  const [listSyncUids, setListSyncUids] = useState<Set<string>>(
    () => new Set(),
  )
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const newListRef = useRef<HTMLInputElement>(null)
  const renameListRef = useRef<HTMLInputElement>(null)
  // Guards against the create-list input firing twice (Enter then the
  // unmount blur), which was creating duplicate lists.
  const creatingListBusyRef = useRef(false)
  // Type-to-search buffer for the sidebar list view.
  const listTypeaheadRef = useRef<{ buf: string; time: number }>({
    buf: '',
    time: 0,
  })

  const [itemsByUid, setItemsByUid] = useState<Map<string, TaskItem[]>>(
    () => new Map(),
  )
  // Latest itemsByUid, readable from the (deps-stable) collections-load
  // effect without making it re-run on every item change.
  const itemsByUidRef = useRef(itemsByUid)
  useEffect(() => {
    itemsByUidRef.current = itemsByUid
  }, [itemsByUid])
  const [errorByUid, setErrorByUid] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [loadingUids, setLoadingUids] = useState<Set<string>>(() => new Set())
  // Uids that have been *fully* loaded (success path completed). Distinct
  // from itemsByUid which gets primed to [] as soon as a fetch starts.
  // Used to gate the background prefetch so it doesn't fight the active
  // load for CPU. Populated from disk snapshots on mount so cached lists
  // are instantly considered loaded.
  const [loadedUids, setLoadedUids] = useState<Set<string>>(() => new Set())
  // Per-collection sync token (Etebase stoken). Persisted alongside the
  // items so re-opens fetch only the delta.
  const [stokenByUid, setStokenByUid] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [hydrated, setHydrated] = useState(false)

  const [filter, setFilterState] = useState<FilterSpec>(() => ({
    ...DEFAULT_FILTER,
    hideCompleted: readHideCompleted(),
  }))
  const setFilter = useCallback((next: FilterSpec) => {
    setFilterState(next)
    writeHideCompleted(next.hideCompleted)
  }, [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterFocusKey, setFilterFocusKey] = useState(0)

  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pendingItemUids, setPendingItemUids] = useState<Set<string>>(
    () => new Set(),
  )
  const [creating, setCreating] = useState<{ parentUid: string | null } | null>(
    null,
  )
  const [confirmDelete, setConfirmDelete] = useState<{
    node: TaskNode
    descendantCount: number
  } | null>(null)
  // Move-task picker state. itemUids covers the selected node + its
  // whole subtree (parent moves take their children with them).
  const [moving, setMoving] = useState<MovePayload | null>(null)
  const [dragOverListUid, setDragOverListUid] = useState<string | null>(null)
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(null)
  const [focusZone, setFocusZone] = useState<'tasks' | 'sidebar' | 'details'>(
    'tasks',
  )
  const [showKeybindings, setShowKeybindings] = useState(false)
  // Per-collection sync progress (items received from the server so far on
  // the in-flight pull). Cleared when the sync finishes/aborts/errors. The
  // header shows the active uid's entry as "Syncing… N items".
  const [syncProgress, setSyncProgress] = useState<
    Map<string, { count: number; startedAt: number }>
  >(() => new Map())
  const [detailPinned, setDetailPinnedState] = useState<boolean>(() =>
    readDetailPinned(),
  )
  const toggleDetailPinned = useCallback(() => {
    setDetailPinnedState((cur) => {
      const next = !cur
      writeDetailPinned(next)
      return next
    })
  }, [])
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme())
  const toggleTheme = useCallback(() => {
    setThemeState((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark'
      writeStoredTheme(next)
      applyTheme(next)
      return next
    })
  }, [])
  const [accent, setAccentState] = useState<string | null>(() =>
    readStoredAccent(),
  )
  const setAccent = useCallback((hex: string | null) => {
    setAccentState(hex)
    writeStoredAccent(hex)
    applyAccent(hex)
  }, [])
  const [accentOpen, setAccentOpen] = useState(false)
  const [accentHex, setAccentHex] = useState('#2f8a6c')
  const accentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!accentOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setAccentOpen(false)
      }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Accent colour"]')) return
      if (!accentRef.current?.contains(t)) setAccentOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [accentOpen])
  const [showDeletedLists, setShowDeletedListsState] = useState<boolean>(() =>
    readShowDeletedLists(),
  )
  // Per-list sort. Lazily filled — each uid hits the cache the first time
  // it's the active list. Cleared along with itemsByUid when a collection
  // disappears (handled by the orphan-pruner below).
  const [taskSortByUid, setTaskSortByUid] = useState<Map<string, TaskSortSpec>>(
    () => new Map(),
  )
  const [sortOpen, setSortOpen] = useState(false)
  const [sortFocusKey, setSortFocusKey] = useState(0)
  const [phonePriority, setPhonePriorityState] = useState<boolean>(() =>
    readPhonePriority(),
  )
  const togglePhonePriority = useCallback(() => {
    setPhonePriorityState((cur) => {
      const next = !cur
      writePhonePriority(next)
      return next
    })
  }, [])
  const [sidebarSort, setSidebarSortState] = useState<SidebarSortSpec>(() =>
    readSidebarSort(),
  )
  const sidebarSortRef = useRef(sidebarSort)
  const setSidebarSort = useCallback((next: SidebarSortSpec) => {
    sidebarSortRef.current = next
    setSidebarSortState(next)
    writeSidebarSort(next)
  }, [])
  const [sidebarSortOpen, setSidebarSortOpen] = useState(false)
  const [sidebarSortFocusKey, setSidebarSortFocusKey] = useState(0)
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false)
  const [customColor, setCustomColor] = useState('#5e8fd9')
  const colorPopoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!colorPopoverOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setColorPopoverOpen(false)
      }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // Ignore the toggle button itself so its onClick can close it
      // (instead of this closing then the click reopening).
      if (t.closest('[aria-label="Recolour this list"]')) return
      if (!colorPopoverRef.current?.contains(t)) {
        setColorPopoverOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [colorPopoverOpen])
  // Two persisted sidebar widths — one per focus state. Defaults match the
  // Tailwind w-52 / w-12 we had before the drag handle existed.
  const [sidebarFocusedWidth, setSidebarFocusedWidth] = useState<number>(() =>
    readSidebarWidth(SIDEBAR_FOCUSED_WIDTH_KEY, 208),
  )
  const [sidebarCollapsedWidth, setSidebarCollapsedWidth] = useState<number>(
    () => readSidebarWidth(SIDEBAR_COLLAPSED_WIDTH_KEY, 48),
  )
  const [zoom, setZoom] = useState<Record<ZoomZone, number>>(() => ({
    sidebar: readZoom('sidebar'),
    tasks: readZoom('tasks'),
    details: readZoom('details'),
  }))
  const adjustZoom = useCallback(
    (zone: ZoomZone, delta: number | 'reset') => {
      setZoom((cur) => {
        const next = delta === 'reset' ? 1 : clampZoom(cur[zone] + delta)
        if (next === cur[zone]) return cur
        writeZoom(zone, next)
        return { ...cur, [zone]: next }
      })
    },
    [],
  )

  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const sidebarFocused = focusZone === 'sidebar'
      const startX = e.clientX
      const startWidth = sidebarFocused
        ? sidebarFocusedWidth
        : sidebarCollapsedWidth
      let latest = startWidth
      setIsResizingSidebar(true)
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(SIDEBAR_MAX_WIDTH, startWidth + (ev.clientX - startX)),
        )
        latest = next
        if (sidebarFocused) setSidebarFocusedWidth(next)
        else setSidebarCollapsedWidth(next)
      }
      const onUp = () => {
        setIsResizingSidebar(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        writeSidebarWidth(
          sidebarFocused
            ? SIDEBAR_FOCUSED_WIDTH_KEY
            : SIDEBAR_COLLAPSED_WIDTH_KEY,
          latest,
        )
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [focusZone, sidebarFocusedWidth, sidebarCollapsedWidth],
  )
  // When Hide-done is on, completed tasks linger for HIDE_GRACE_MS before
  // disappearing so a misclicked checkbox can be untoggled. Map value is the
  // expiry timestamp (Date.now() + HIDE_GRACE_MS) so the row can show a
  // countdown.
  const [recentlyCompleted, setRecentlyCompleted] = useState<
    Map<string, number>
  >(() => new Map())
  const completionTimers = useRef<Map<string, number>>(new Map())

  const inFlightRef = useRef<Set<string>>(new Set())
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Cleanup any pending completion timers on unmount.
  useEffect(() => {
    const timers = completionTimers.current
    return () => {
      for (const id of timers.values()) clearTimeout(id)
      timers.clear()
    }
  }, [])

  // Hydrate cached snapshots from disk before any network sync. This makes
  // the second-and-onward app open instant: trees render immediately and
  // sync only pulls deltas.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const uids = await listSnapshotUids()
        const snapshots = await Promise.all(uids.map((uid) => loadSnapshot(uid)))
        if (cancelled) return
        const nextItems = new Map<string, TaskItem[]>()
        const nextStokens = new Map<string, string>()
        const nextLoaded = new Set<string>()
        for (const snap of snapshots) {
          if (!snap) continue
          nextItems.set(snap.uid, snap.items)
          if (snap.stoken) nextStokens.set(snap.uid, snap.stoken)
          nextLoaded.add(snap.uid)
        }
        if (nextItems.size > 0) {
          setItemsByUid((prev) => {
            const next = new Map(prev)
            for (const [uid, items] of nextItems) next.set(uid, items)
            return next
          })
          setStokenByUid((prev) => {
            const next = new Map(prev)
            for (const [uid, s] of nextStokens) next.set(uid, s)
            return next
          })
          setLoadedUids((prev) => {
            const next = new Set(prev)
            for (const uid of nextLoaded) next.add(uid)
            return next
          })
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the active collection's snapshot to disk on changes (mutations
  // mostly). Debounced so flurries of state updates coalesce into one
  // write; LazyStore's autoSave further debounces the filesystem write.
  useEffect(() => {
    if (!activeUid || !loadedUids.has(activeUid)) return
    const items = itemsByUid.get(activeUid)
    if (!items) return
    const id = setTimeout(() => {
      void saveSnapshot({
        version: 1,
        uid: activeUid,
        items,
        stoken: stokenByUid.get(activeUid),
        lastSyncedAt: Date.now(),
      })
    }, 1000)
    return () => clearTimeout(id)
  }, [itemsByUid, stokenByUid, activeUid, loadedUids])

  // Scroll the active sidebar row into view when activeUid changes — mirrors
  // the tree's selection scroll-into-view.
  useEffect(() => {
    if (!activeUid) return
    const el = document.querySelector(
      `[data-collection-uid="${CSS.escape(activeUid)}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeUid])

  const markRecentlyCompleted = useCallback((uid: string) => {
    const expiresAt = Date.now() + HIDE_GRACE_MS
    setRecentlyCompleted((prev) => {
      const next = new Map(prev)
      next.set(uid, expiresAt)
      return next
    })
    const existing = completionTimers.current.get(uid)
    if (existing) clearTimeout(existing)
    const id = window.setTimeout(() => {
      setRecentlyCompleted((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Map(prev)
        next.delete(uid)
        return next
      })
      completionTimers.current.delete(uid)
    }, HIDE_GRACE_MS)
    completionTimers.current.set(uid, id)
  }, [])

  const clearRecentlyCompleted = useCallback((uid: string) => {
    const existing = completionTimers.current.get(uid)
    if (existing) {
      clearTimeout(existing)
      completionTimers.current.delete(uid)
    }
    setRecentlyCompleted((prev) => {
      if (!prev.has(uid)) return prev
      const next = new Map(prev)
      next.delete(uid)
      return next
    })
  }, [])

  const fetchCollection = useCallback(
    async (uid: string, signal?: AbortSignal) => {
      if (inFlightRef.current.has(uid)) return
      inFlightRef.current.add(uid)
      setLoadingUids((prev) => {
        const next = new Set(prev)
        next.add(uid)
        return next
      })
      setSyncProgress((prev) => {
        const next = new Map(prev)
        next.set(uid, { count: 0, startedAt: Date.now() })
        return next
      })
      // Initialize an empty bucket only if there's no hydrated cache for
      // this uid — otherwise the cached items stay visible while we sync.
      setItemsByUid((prev) => {
        if (prev.has(uid)) return prev
        const next = new Map(prev)
        next.set(uid, [])
        return next
      })
      const fromStoken = stokenByUid.get(uid)
      try {
        const result = await listTaskItems(uid, {
          signal,
          fromStoken,
          onBatch: (batch) => {
            if (cancelledRef.current) return
            setItemsByUid((prev) => {
              const existing = prev.get(uid) ?? []
              // Upsert by itemUid so re-syncs replace rather than duplicate.
              const byId = new Map(existing.map((t) => [t.itemUid, t]))
              for (const t of batch) byId.set(t.itemUid, t)
              const next = new Map(prev)
              next.set(uid, Array.from(byId.values()))
              return next
            })
            setSyncProgress((prev) => {
              const cur = prev.get(uid)
              if (!cur) return prev
              const next = new Map(prev)
              next.set(uid, { ...cur, count: cur.count + batch.length })
              return next
            })
          },
        })
        if (cancelledRef.current) return
        // Apply server-side deletions to the local cache.
        if (result.removed.length > 0) {
          const removeSet = new Set(result.removed)
          setItemsByUid((prev) => {
            const existing = prev.get(uid) ?? []
            const filtered = existing.filter(
              (t) => !removeSet.has(t.itemUid),
            )
            if (filtered.length === existing.length) return prev
            const next = new Map(prev)
            next.set(uid, filtered)
            return next
          })
        }
        if (result.stoken) {
          setStokenByUid((prev) => {
            if (prev.get(uid) === result.stoken) return prev
            const next = new Map(prev)
            next.set(uid, result.stoken)
            return next
          })
        }
        setErrorByUid((prev) => {
          if (!prev.has(uid)) return prev
          const next = new Map(prev)
          next.delete(uid)
          return next
        })
        setLoadedUids((prev) => {
          if (prev.has(uid)) return prev
          const next = new Set(prev)
          next.add(uid)
          return next
        })
        // Persist the freshly-synced snapshot. We read the latest items via
        // a no-op state update so the saved snapshot reflects all batches +
        // removals applied above.
        setItemsByUid((prev) => {
          const items = prev.get(uid)
          if (items) {
            const snapshot: CollectionSnapshot = {
              version: 1,
              uid,
              items,
              stoken: result.stoken || undefined,
              lastSyncedAt: Date.now(),
            }
            void saveSnapshot(snapshot)
          }
          return prev
        })
      } catch (err) {
        if (cancelledRef.current) return
        // AbortError: leave any cached items in place (don't lose what the
        // user already had) but don't mark as loaded — next visit re-syncs.
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setErrorByUid((prev) => {
          const next = new Map(prev)
          next.set(
            uid,
            err instanceof Error ? err.message : 'Failed to load tasks',
          )
          return next
        })
        // Real error: drop the partial bucket so a retry starts clean.
        // Only if we don't have cached items already.
        setItemsByUid((prev) => {
          const items = prev.get(uid)
          if (!items || items.length > 0) return prev
          const next = new Map(prev)
          next.delete(uid)
          return next
        })
      } finally {
        inFlightRef.current.delete(uid)
        if (!cancelledRef.current) {
          setLoadingUids((prev) => {
            const next = new Set(prev)
            next.delete(uid)
            return next
          })
          setSyncProgress((prev) => {
            if (!prev.has(uid)) return prev
            const next = new Map(prev)
            next.delete(uid)
            return next
          })
        }
      }
    },
    [],
  )

  // Load collections on mount, and again whenever the user toggles
  // "show deleted lists" — the server response is different in that mode
  // (tombstones included).
  useEffect(() => {
    listCollections({ includeDeleted: showDeletedLists })
      .then((cs) => {
        if (cancelledRef.current) return
        setCollections(cs)
        setCollectionsError(null)
        if (cs.length > 0) {
          // Keep a still-valid selection (so toggling "show deleted"
          // doesn't jump it); otherwise default to the list shown first
          // in the *sorted* sidebar order, not raw server order.
          const sortedFirst = sortCollections(
            cs,
            sidebarSortRef.current,
            itemsByUidRef.current,
          )[0]?.uid
          setActiveUid((cur) =>
            cur && cs.some((c) => c.uid === cur) ? cur : sortedFirst,
          )
        }

        // Prune orphans: disk snapshots and in-memory state for uids the
        // server no longer returns *under our current filter*. When
        // showDeletedLists is on, tombstones count as "known", so they
        // survive — letting the user browse cached items for deleted
        // lists. When it's off, anything missing (live or tombstoned) is
        // purged.
        const known = new Set(cs.map((c) => c.uid))
        setItemsByUid((prev) => {
          let mutated = false
          const next = new Map(prev)
          for (const uid of next.keys()) {
            if (!known.has(uid)) {
              next.delete(uid)
              mutated = true
            }
          }
          return mutated ? next : prev
        })
        setStokenByUid((prev) => {
          let mutated = false
          const next = new Map(prev)
          for (const uid of next.keys()) {
            if (!known.has(uid)) {
              next.delete(uid)
              mutated = true
            }
          }
          return mutated ? next : prev
        })
        setLoadedUids((prev) => {
          let mutated = false
          const next = new Set(prev)
          for (const uid of next) {
            if (!known.has(uid)) {
              next.delete(uid)
              mutated = true
            }
          }
          return mutated ? next : prev
        })
        void (async () => {
          const snapUids = await listSnapshotUids()
          for (const uid of snapUids) {
            if (!known.has(uid)) {
              await deleteSnapshot(uid)
            }
          }
        })()
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return
        setCollectionsError(
          err instanceof Error ? err.message : 'Failed to load collections',
        )
      })
  }, [showDeletedLists, collectionsRefreshKey])

  const toggleShowDeletedLists = useCallback(() => {
    setShowDeletedListsState((cur) => {
      const next = !cur
      writeShowDeletedLists(next)
      return next
    })
  }, [])

  // Eagerly sync the active collection whenever it changes. With a cached
  // stoken the sync is just a delta; without, it's a full load. We don't
  // skip when the cache already has items — that's how hydrated lists pick
  // up server-side changes — but the UI keeps showing the cached tree
  // throughout. Aborts on cleanup so list-switching mid-sync is cheap.
  useEffect(() => {
    if (!hydrated) return
    if (!activeUid) return
    const controller = new AbortController()
    void fetchCollection(activeUid, controller.signal)
    return () => controller.abort()
  }, [activeUid, hydrated, fetchCollection])

  // After the active collection is FULLY loaded, prefetch the rest in
  // parallel with bounded concurrency so sidebar counts can fill in.
  // Gating on loadedUids (rather than itemsByUid) keeps the prefetch from
  // fighting the active load for CPU while it's still streaming.
  useEffect(() => {
    if (!collections || !activeUid) return
    if (!loadedUids.has(activeUid)) return

    const remaining = collections
      .map((c) => c.uid)
      .filter((uid) => !loadedUids.has(uid) && !inFlightRef.current.has(uid))

    if (remaining.length === 0) return

    let cancelled = false
    let i = 0
    const workers = Array.from({ length: PREFETCH_CONCURRENCY }, async () => {
      while (!cancelled) {
        const idx = i++
        if (idx >= remaining.length) break
        await fetchCollection(remaining[idx])
      }
    })
    void Promise.all(workers)
    return () => {
      cancelled = true
    }
  }, [collections, activeUid, loadedUids, fetchCollection])

  const activeCollection = collections?.find((c) => c.uid === activeUid) ?? null
  const activeItems = activeUid ? itemsByUid.get(activeUid) : undefined
  const activeError = activeUid ? errorByUid.get(activeUid) : undefined
  const activeLoading = activeUid ? loadingUids.has(activeUid) : false

  // Effective sort for the active list. State wins; if a uid hasn't
  // been touched in this session, fall back to localStorage; if even
  // that's empty, use the global default.
  const activeSort: TaskSortSpec = useMemo(() => {
    if (!activeUid) return DEFAULT_TASK_SORT
    return (
      taskSortByUid.get(activeUid) ??
      readTaskSort(activeUid) ??
      DEFAULT_TASK_SORT
    )
  }, [activeUid, taskSortByUid])

  const setActiveSort = useCallback(
    (next: TaskSortSpec) => {
      if (!activeUid) return
      setTaskSortByUid((prev) => {
        const m = new Map(prev)
        m.set(activeUid, next)
        return m
      })
      writeTaskSort(activeUid, next)
    },
    [activeUid],
  )

  const fullTree = useMemo(
    () => (activeItems ? buildTree(activeItems, activeSort) : []),
    [activeItems, activeSort],
  )
  // Sidebar lists, sorted by the user-picked axis + reverse flag. Open
  // and total counts come from itemsByUid; lists we haven't hydrated yet
  // sort as zero so they don't reshuffle as prefetch fills in. For
  // count-based axes the natural direction is descending (most first);
  // `reverse` flips that.
  const sortedCollections = useMemo(() => {
    if (!collections) return null
    return sortCollections(collections, sidebarSort, itemsByUid)
  }, [collections, sidebarSort, itemsByUid])

  // What the sidebar actually renders: real lists + optimistic
  // placeholders for lists still being created. Keyboard nav, typeahead
  // and default-selection deliberately keep using sortedCollections so
  // they never land on a not-yet-real placeholder.
  const displayCollections = useMemo(() => {
    if (!sortedCollections) return sortedCollections
    return pendingLists.length > 0
      ? [...sortedCollections, ...pendingLists]
      : sortedCollections
  }, [sortedCollections, pendingLists])


  const recentlyCompletedKeys = useMemo(
    () => new Set(recentlyCompleted.keys()),
    [recentlyCompleted],
  )

  const visibleTree = useMemo(
    () =>
      applyFilter(fullTree, {
        hideCompleted: filter.hideCompleted,
        search: filter.search.trim().toLowerCase() || undefined,
        tags: filter.tags,
        keep: recentlyCompletedKeys,
      }),
    [fullTree, filter, recentlyCompletedKeys],
  )

  // Distinct tags across the active list, alphabetical, preserving the
  // first-seen casing for display.
  const availableTags = useMemo(() => {
    if (!activeItems) return [] as string[]
    const byLower = new Map<string, string>()
    for (const item of activeItems) {
      for (const cat of item.todo.categories) {
        const k = cat.toLowerCase()
        if (!byLower.has(k)) byLower.set(k, cat)
      }
    }
    return Array.from(byLower.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [activeItems])
  const fadingExpires = useMemo(
    () =>
      filter.hideCompleted ? recentlyCompleted : new Map<string, number>(),
    [filter.hideCompleted, recentlyCompleted],
  )
  const activeCounts = useMemo(
    () => (activeItems ? countTasks(activeItems) : null),
    [activeItems],
  )

  const selectedTaskItem = useMemo(() => {
    if (!activeItems || !selectedTaskUid) return null
    return activeItems.find((it) => it.todo.uid === selectedTaskUid) ?? null
  }, [activeItems, selectedTaskUid])

  const detailAncestors = useMemo(() => {
    if (!activeItems || !selectedTaskUid) return []
    return getAncestorChain(activeItems, selectedTaskUid)
  }, [activeItems, selectedTaskUid])

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  const refreshActive = useCallback(() => {
    if (!activeUid) return
    void fetchCollection(activeUid)
  }, [activeUid, fetchCollection])

  // Re-sync every list (incremental per-collection stoken). Bounded
  // concurrency; fetchCollection already dedupes in-flight uids and
  // drives loadingUids/syncProgress so the per-row indicators light up.
  const syncAll = useCallback(() => {
    const uids = (collections ?? [])
      .map((c) => c.uid)
      .filter((uid) => !inFlightRef.current.has(uid))
    if (uids.length === 0) return
    let i = 0
    const workers = Array.from({ length: PREFETCH_CONCURRENCY }, async () => {
      while (i < uids.length) {
        await fetchCollection(uids[i++])
      }
    })
    void Promise.all(workers)
  }, [collections, fetchCollection])

  // 1 Hz ticker, only running while the active list has an in-flight sync,
  // so the "Syncing… Ns" label updates without re-rendering the whole app
  // every second the rest of the time. nowMs lives in state (not a render
  // call to Date.now()) so the lint purity rules stay happy.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const activeSyncEntry = activeUid ? syncProgress.get(activeUid) : undefined
  useEffect(() => {
    if (!activeSyncEntry) return
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [activeSyncEntry])
  const activeSyncElapsedS = activeSyncEntry
    ? Math.max(0, Math.floor((nowMs - activeSyncEntry.startedAt) / 1000))
    : 0

  function replaceCachedItem(
    colUid: string,
    itemUid: string,
    replacement: TaskItem,
  ) {
    setItemsByUid((prev) => {
      const items = prev.get(colUid)
      if (!items) return prev
      const next = new Map(prev)
      next.set(
        colUid,
        items.map((it) => (it.itemUid === itemUid ? replacement : it)),
      )
      return next
    })
  }

  // If a create is already in progress, blur its input first so it
  // auto-commits (same as clicking away) before we replace it — the
  // half-typed task is saved, never silently dropped on unmount.
  const flushActiveCreate = useCallback(() => {
    const ae = document.activeElement
    if (creating && ae instanceof HTMLInputElement) ae.blur()
  }, [creating])

  const handleStartCreateRoot = useCallback(() => {
    flushActiveCreate()
    setCreating({ parentUid: null })
  }, [flushActiveCreate])

  // Logseq-style status cycle: NEEDS-ACTION → IN-PROCESS → COMPLETED →
  // NEEDS-ACTION. CANCELLED rejoins the cycle at the top (it's set
  // deliberately via the detail panel, so cycling out of it lands on
  // NEEDS-ACTION rather than IN-PROCESS). Bound to Ctrl+Enter in the
  // global keyboard handler below — declared up here so that effect's
  // dep array can list it without hitting the TDZ.
  const handleCycleStatus = useCallback(
    async (task: TaskItem) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = task.itemUid
      const original: TaskItem = task
      const nextStatus: TaskItem['todo']['status'] =
        task.todo.status === 'NEEDS-ACTION'
          ? 'IN-PROCESS'
          : task.todo.status === 'IN-PROCESS'
            ? 'COMPLETED'
            : 'NEEDS-ACTION'
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...task.todo, status: nextStatus },
      }

      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)

      // Grace-period bookkeeping mirrors handleToggleComplete: a new
      // COMPLETED gets the hide-grace timer; leaving COMPLETED clears it.
      if (nextStatus === 'COMPLETED' && task.todo.status !== 'COMPLETED') {
        markRecentlyCompleted(task.todo.uid)
      } else if (
        task.todo.status === 'COMPLETED' &&
        nextStatus !== 'COMPLETED'
      ) {
        clearRecentlyCompleted(task.todo.uid)
      }

      try {
        const result = await updateTask(colUid, itemUid, { status: nextStatus })
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        if (nextStatus === 'COMPLETED' && task.todo.status !== 'COMPLETED') {
          clearRecentlyCompleted(task.todo.uid)
        }
        setMutationError(
          err instanceof Error ? err.message : 'Failed to update task',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid, markRecentlyCompleted, clearRecentlyCompleted],
  )

  const handleStartCreateChild = useCallback(
    (parent: TaskNode) => {
      flushActiveCreate()
      setCreating({ parentUid: parent.todo.uid })
    },
    [flushActiveCreate],
  )

  const handleCancelCreate = useCallback(() => setCreating(null), [])

  const handleConfirmCreate = useCallback(
    async (summary: string) => {
      const cur = creating
      setCreating(null)
      if (!activeUid || !cur) return
      const trimmed = summary.trim()
      if (!trimmed) return
      const colUid = activeUid
      try {
        const newItem = await createTask(
          colUid,
          trimmed,
          cur.parentUid ?? undefined,
        )
        if (cancelledRef.current) return
        setItemsByUid((prev) => {
          const items = prev.get(colUid) ?? []
          const next = new Map(prev)
          next.set(colUid, [...items, newItem])
          return next
        })
        // Follow the new task: select it so the tree's auto-focus +
        // scrollIntoView take the user to wherever it lands after sorting.
        setSelectedTaskUid(newItem.todo.uid)
      } catch (err) {
        if (cancelledRef.current) return
        setMutationError(
          err instanceof Error ? err.message : 'Failed to create task',
        )
      }
    },
    [activeUid, creating],
  )

  // Commit an inline (sub)task then open ITS detail panel (Ctrl+→ while
  // typing). handleConfirmCreate already selects the new task.
  const handleConfirmCreateAndOpen = useCallback(
    async (summary: string) => {
      await handleConfirmCreate(summary)
      if (cancelledRef.current) return
      setFocusZone('details')
    },
    [handleConfirmCreate],
  )

  const handleDeleteRequest = useCallback((node: TaskNode) => {
    const descendants = collectDescendantItemUids(node)
    setConfirmDelete({ node, descendantCount: descendants.length - 1 })
  }, [])

  // Enter the tasks zone and make sure something is selected so the user
  // lands on the first task instead of a selection-less list they'd have
  // to arrow into. Keeps the current selection if it's still visible.
  const focusTasks = useCallback(() => {
    setFocusZone('tasks')
    setSelectedTaskUid((cur) => {
      if (cur && findNodeByUid(visibleTree, cur)) return cur
      return visibleTree[0]?.todo.uid ?? cur
    })
  }, [visibleTree])

  const refreshCollections = useCallback(() => {
    setCollectionsRefreshKey((k) => k + 1)
  }, [])

  const startCreateList = useCallback(() => {
    setListError(null)
    setNewListName('')
    setCreatingList(true)
    setFocusZone('sidebar')
    // Focus after the input mounts.
    requestAnimationFrame(() => newListRef.current?.focus())
  }, [])

  const handleCreateList = useCallback(async () => {
    // Re-entrancy guard: Enter submits, then the input unmounts and its
    // blur handler fires a second submit. Bail on the second call.
    if (creatingListBusyRef.current) return
    const name = newListName.trim()
    // Close the input immediately so it can't blur-resubmit and the user
    // returns to the list right away.
    setCreatingList(false)
    setNewListName('')
    if (!name) return
    creatingListBusyRef.current = true
    setListError(null)
    // Optimistic: show the new list immediately with a "syncing" badge.
    const tempUid = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setPendingLists((p) => [...p, { uid: tempUid, name }])
    setListSyncUids((s) => new Set(s).add(tempUid))
    const dropTemp = () => {
      setPendingLists((p) => p.filter((c) => c.uid !== tempUid))
      setListSyncUids((s) => {
        if (!s.has(tempUid)) return s
        const n = new Set(s)
        n.delete(tempUid)
        return n
      })
    }
    try {
      const info = await createCollection(name)
      if (cancelledRef.current) return
      dropTemp()
      // Select the real list; the load effect keeps it selected since
      // it's present in the refreshed server list.
      setActiveUid(info.uid)
      refreshCollections()
    } catch (err) {
      if (cancelledRef.current) return
      dropTemp()
      setListError(
        err instanceof Error ? err.message : 'Failed to create list',
      )
    } finally {
      creatingListBusyRef.current = false
    }
  }, [newListName, refreshCollections])

  const startRenameList = useCallback((c: CollectionInfo) => {
    setListError(null)
    setRenamingListUid(c.uid)
    setRenameListName(c.name)
    setFocusZone('sidebar')
    requestAnimationFrame(() => {
      const el = renameListRef.current
      if (el) {
        el.focus()
        el.select()
      }
    })
  }, [])

  const handleRenameList = useCallback(async () => {
    const uid = renamingListUid
    if (!uid) return
    const name = renameListName.trim()
    const current = collections?.find((c) => c.uid === uid)
    if (!name || name === current?.name) {
      setRenamingListUid(null)
      return
    }
    setListBusy(true)
    setListError(null)
    try {
      await updateCollectionMeta(uid, { name })
      if (cancelledRef.current) return
      setRenamingListUid(null)
      refreshCollections()
    } catch (err) {
      if (cancelledRef.current) return
      setListError(
        err instanceof Error ? err.message : 'Failed to rename list',
      )
    } finally {
      if (!cancelledRef.current) setListBusy(false)
    }
  }, [renamingListUid, renameListName, collections, refreshCollections])

  const handleDeleteList = useCallback(async () => {
    const target = deletingList
    if (!target) return
    setListError(null)
    // Close the modal immediately and badge the row as "syncing" until
    // the server confirms the deletion (then refresh removes it).
    setDeletingList(null)
    const uid = target.uid
    setListSyncUids((s) => new Set(s).add(uid))
    const clearSync = () =>
      setListSyncUids((s) => {
        if (!s.has(uid)) return s
        const n = new Set(s)
        n.delete(uid)
        return n
      })
    try {
      await deleteCollection(uid)
      if (cancelledRef.current) return
      clearSync()
      // The load effect auto-selects another list when the active one
      // disappears from the refreshed server response.
      refreshCollections()
    } catch (err) {
      if (cancelledRef.current) return
      clearSync()
      setListError(
        err instanceof Error ? err.message : 'Failed to delete list',
      )
    }
  }, [deletingList, refreshCollections])

  const handleSetListColor = useCallback(
    async (color: string | undefined) => {
      const uid = activeUid
      const col = sortedCollections?.find((c) => c.uid === uid)
      if (!uid || !col || col.isDeleted) return
      setColorPopoverOpen(false)
      if ((col.color ?? undefined) === (color ?? undefined)) return
      setListBusy(true)
      setListError(null)
      try {
        await updateCollectionMeta(uid, { color })
        if (cancelledRef.current) return
        refreshCollections()
      } catch (err) {
        if (cancelledRef.current) return
        setListError(
          err instanceof Error ? err.message : 'Failed to recolour list',
        )
      } finally {
        if (!cancelledRef.current) setListBusy(false)
      }
    },
    [activeUid, sortedCollections, refreshCollections],
  )

  // Global single-key shortcuts: l / t to switch focus zones, n to start a
  // new task, f to toggle Hide done, plus sidebar arrow navigation while
  // focusZone === 'sidebar'. Skipped while typing or while a modal is open
  // (and modifier-key combos are ignored so OS shortcuts pass through).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return

      // Ctrl/Cmd +/-/0 → zoom the currently-focused zone. Honored even
      // from inside text inputs (it's a global view control).
      if (e.ctrlKey || e.metaKey) {
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

      // Ctrl/Cmd+F → open Filter and focus search (override browser find).
      // Honored even from inside text inputs.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setFilterOpen(true)
        setFilterFocusKey((k) => k + 1)
        return
      }

      // Ctrl/Cmd+Arrow = zone meta-navigator. Steps through
      // sidebar → tasks → details (and back) regardless of tree state;
      // it never expands/collapses the hierarchy.
      //   →  sidebar ⇒ enter the list; tasks ⇒ open details (if a task
      //      is selected). In details the panel handles its own keys.
      // While typing in a field (renaming, inline-create, detail
      // inputs), Ctrl/Cmd+←/→ is native word-jump, not meta-nav.
      const inTextField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        if (inTextField || focusZone === 'details') return
        e.preventDefault()
        if (focusZone === 'sidebar') {
          focusTasks()
        } else if (selectedTaskUid) {
          setFocusZone('details')
        }
        return
      }
      //   ←  tasks ⇒ jump straight to the task lists (no collapse). In
      //      details the panel owns Ctrl+← (save-aware exit), so don't
      //      intercept it here.
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        if (inTextField || focusZone === 'details') return
        if (focusZone === 'tasks') {
          e.preventDefault()
          setFocusZone('sidebar')
        }
        return
      }

      // Ctrl/Cmd+Enter opens the detail panel for the selected task
      // (plain Enter now cycles status, so Ctrl+Enter is the "open card"
      // accelerator, mirroring Ctrl+→). The detail panel reuses
      // Ctrl+Enter for "save and exit", so don't intercept it there.
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (focusZone === 'details') return
        if (!selectedTaskUid) return
        e.preventDefault()
        setFocusZone('details')
        return
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return

      if (e.metaKey || e.ctrlKey || e.altKey) return

      // In the list (sidebar) view, plain letters/digits are a
      // type-to-search, not shortcuts. This deliberately swallows ALL
      // alphanumerics so none of the task-view single-key shortcuts
      // (l/t/e/m/s/n/f/0-9) fire while browsing lists. Repeating the
      // same single char cycles through matches.
      if (focusZone === 'sidebar' && /^[a-z0-9]$/i.test(e.key)) {
        e.preventDefault()
        const lists = sortedCollections ?? []
        if (lists.length > 0) {
          const ch = e.key.toLowerCase()
          const now = Date.now()
          const st = listTypeaheadRef.current
          let buf: string
          if (now - st.time > 800) buf = ch
          else if (st.buf.length === 1 && st.buf === ch) buf = ch
          else buf = st.buf + ch
          listTypeaheadRef.current = { buf, time: now }
          const matches = lists.filter((c) =>
            (c.name || '').toLowerCase().startsWith(buf),
          )
          if (matches.length > 0) {
            let pick = matches[0]
            if (buf.length === 1) {
              const ci = matches.findIndex((c) => c.uid === activeUid)
              if (ci >= 0) pick = matches[(ci + 1) % matches.length]
            }
            setActiveUid(pick.uid)
          }
        }
        return
      }

      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        setFocusZone('sidebar')
        return
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        focusTasks()
        return
      }
      if (e.key === 'e' || e.key === 'E') {
        if (!selectedTaskUid) return
        e.preventDefault()
        setFocusZone('details')
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        if (!selectedTaskUid || !activeUid) return
        const node = findNodeByUid(fullTree, selectedTaskUid)
        if (!node) return
        const itemUids = collectDescendantItemUids(node)
        e.preventDefault()
        setMoving({
          itemUids,
          rootVtodoUid: node.todo.uid,
          summary: node.todo.summary,
          descendantCount: itemUids.length - 1,
        })
        return
      }
      if (e.key === 's' || e.key === 'S') {
        if (!activeUid) return
        e.preventDefault()
        setFocusZone('tasks')
        setSortOpen((open) => !open)
        setSortFocusKey((k) => k + 1)
        return
      }
      // Sidebar list management. (List creation is the header "+" button;
      // plain letters are type-to-search, handled above.)
      if (focusZone === 'sidebar') {
        const activeCol = sortedCollections?.find((c) => c.uid === activeUid)
        if (e.key === 'F2' && activeCol && !activeCol.isDeleted) {
          e.preventDefault()
          startRenameList(activeCol)
          return
        }
        if (
          (e.key === 'Delete' || e.key === 'Backspace') &&
          activeCol &&
          !activeCol.isDeleted
        ) {
          e.preventDefault()
          setListError(null)
          setDeletingList(activeCol)
          return
        }
      }

      if (e.key === 'n' || e.key === 'N') {
        if (!activeUid || !activeItems) return
        e.preventDefault()
        setFocusZone('tasks')
        handleStartCreateRoot()
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setFilterOpen((open) => !open)
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setShowKeybindings(true)
        return
      }

      // Tasks-mode fallback: when the list is empty the TaskTree isn't
      // mounted, so its own ArrowLeft handler can't fire and the user
      // would be stranded. Route ArrowLeft (and Backspace) straight to
      // the sidebar in that case. Non-empty lists let the tree handle
      // ArrowLeft (collapse / jump to parent).
      if (
        focusZone === 'tasks' &&
        visibleTree.length === 0 &&
        (e.key === 'ArrowLeft' || e.key === 'Backspace')
      ) {
        e.preventDefault()
        setFocusZone('sidebar')
        return
      }

      if (
        focusZone === 'sidebar' &&
        sortedCollections &&
        sortedCollections.length > 0
      ) {
        const list = sortedCollections
        const idx = list.findIndex((c) => c.uid === activeUid)
        switch (e.key) {
          case 'ArrowDown': {
            e.preventDefault()
            setActiveUid(list[idx < 0 ? 0 : Math.min(list.length - 1, idx + 1)].uid)
            return
          }
          case 'ArrowUp': {
            e.preventDefault()
            setActiveUid(list[idx <= 0 ? 0 : idx - 1].uid)
            return
          }
          case 'Home': {
            e.preventDefault()
            setActiveUid(list[0].uid)
            return
          }
          case 'End': {
            e.preventDefault()
            setActiveUid(list[list.length - 1].uid)
            return
          }
          case 'PageDown': {
            e.preventDefault()
            const PAGE = 10
            setActiveUid(list[idx < 0 ? 0 : Math.min(list.length - 1, idx + PAGE)].uid)
            return
          }
          case 'PageUp': {
            e.preventDefault()
            const PAGE = 10
            setActiveUid(list[idx <= 0 ? 0 : Math.max(0, idx - PAGE)].uid)
            return
          }
          case 'ArrowRight':
          case 'Enter': {
            // If the user has Tab'd to a button (e.g. the Hide-done eye in
            // the header), Enter is meant to fire that button's click —
            // don't intercept it.
            if (
              e.key === 'Enter' &&
              (e.target instanceof HTMLButtonElement ||
                e.target instanceof HTMLAnchorElement)
            ) {
              return
            }
            e.preventDefault()
            focusTasks()
            return
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    focusZone,
    sortedCollections,
    activeUid,
    activeItems,
    selectedTaskUid,
    selectedTaskItem,
    visibleTree,
    fullTree,
    handleCycleStatus,
    handleStartCreateRoot,
    startCreateList,
    startRenameList,
    adjustZoom,
    focusTasks,
  ])

  // The hardened move itself (used by the picker and by drag-to-list).
  const performMove = useCallback(
    async (cur: MovePayload, srcUid: string, destUid: string) => {
      if (destUid === srcUid) return

      // Optimistic: remove from source in-memory, then await server. On
      // failure we re-fetch the source (cheap delta) so any half-done
      // state is reconciled. The destination's items will appear when
      // we switch to it and its sync runs.
      const toMove = new Set(cur.itemUids)
      const movedItems = (activeItems ?? []).filter((it) =>
        toMove.has(it.itemUid),
      )
      setItemsByUid((prev) => {
        const existing = prev.get(srcUid)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(
          srcUid,
          existing.filter((t) => !toMove.has(t.itemUid)),
        )
        return next
      })
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        for (const uid of cur.itemUids) next.add(uid)
        return next
      })
      setMutationError(null)

      try {
        const created = await moveTasksToCollection(
          srcUid,
          destUid,
          cur.itemUids,
        )
        if (!cancelledRef.current) {
          // Splice the freshly-created items into the destination's
          // in-memory list so the user sees them on switch.
          setItemsByUid((prev) => {
            const existing = prev.get(destUid) ?? []
            const byId = new Map(existing.map((t) => [t.itemUid, t]))
            for (const t of created) byId.set(t.itemUid, t)
            const next = new Map(prev)
            next.set(destUid, Array.from(byId.values()))
            return next
          })
          // Follow the task: switch to the destination list and
          // re-select it by its preserved VTODO uid.
          setActiveUid(destUid)
          setSelectedTaskUid(cur.rootVtodoUid)
        }
      } catch (err) {
        // NEVER silent. A move that didn't fully complete must surface,
        // and the source must be reconciled from the server (its items
        // may still be there) — so do NOT bail on cancelledRef here.
        if (!cancelledRef.current) {
          // Roll back the optimistic removal so it doesn't look like the
          // data vanished (the forced source re-sync below is the real
          // safety net).
          setItemsByUid((prev) => {
            const existing = prev.get(srcUid) ?? []
            const byId = new Map(existing.map((t) => [t.itemUid, t]))
            for (const t of movedItems) byId.set(t.itemUid, t)
            const next = new Map(prev)
            next.set(srcUid, Array.from(byId.values()))
            return next
          })
        }
        setMutationError(
          err instanceof Error ? err.message : 'Failed to move task',
        )
      } finally {
        // ALWAYS force the SOURCE to re-sync from the server next time
        // it's opened (this session and on next launch), regardless of
        // success / failure / cancellation. deleteSnapshot is a
        // filesystem op so it's safe even if the component unmounted —
        // this is the guarantee that the app shows the server's truth
        // and a half-completed move can't leave a silent ghost (item
        // gone here but still on the server / other clients).
        void deleteSnapshot(srcUid)
        if (!cancelledRef.current) {
          setStokenByUid((prev) => {
            if (!prev.has(srcUid)) return prev
            const next = new Map(prev)
            next.delete(srcUid)
            return next
          })
          setLoadedUids((prev) => {
            if (!prev.has(srcUid)) return prev
            const next = new Set(prev)
            next.delete(srcUid)
            return next
          })
          setPendingItemUids((prev) => {
            let mutated = false
            const next = new Set(prev)
            for (const uid of cur.itemUids) {
              if (next.delete(uid)) mutated = true
            }
            return mutated ? next : prev
          })
        }
      }
    },
    [activeItems],
  )

  // Move-picker pick → move the selected payload.
  const handleMovePick = useCallback(
    async (destUid: string) => {
      const cur = moving
      const srcUid = activeUid
      setMoving(null)
      if (!cur || !srcUid) return
      await performMove(cur, srcUid, destUid)
    },
    [moving, activeUid, performMove],
  )

  // Drop a dragged task (by VTODO uid) onto a sidebar list → move its
  // whole subtree there, reusing the verified move path (no picker).
  const handleDropTaskOnList = useCallback(
    (destUid: string, draggedUid: string) => {
      const srcUid = activeUid
      if (!srcUid || destUid === srcUid) return
      const node = findNodeByUid(fullTree, draggedUid)
      if (!node) return
      const itemUids = collectDescendantItemUids(node)
      void performMove(
        {
          itemUids,
          rootVtodoUid: node.todo.uid,
          summary: node.todo.summary,
          descendantCount: itemUids.length - 1,
        },
        srcUid,
        destUid,
      )
    },
    [activeUid, fullTree, performMove],
  )

  const handleConfirmDelete = useCallback(async () => {
    const target = confirmDelete
    setConfirmDelete(null)
    if (!target || !activeUid) return
    const colUid = activeUid
    const itemUidsToDelete = collectDescendantItemUids(target.node)
    const deleteSet = new Set(itemUidsToDelete)

    setMutationError(null)
    setItemsByUid((prev) => {
      const items = prev.get(colUid)
      if (!items) return prev
      const next = new Map(prev)
      next.set(
        colUid,
        items.filter((it) => !deleteSet.has(it.itemUid)),
      )
      return next
    })

    try {
      await deleteTasks(colUid, itemUidsToDelete)
    } catch (err) {
      if (cancelledRef.current) return
      setMutationError(
        err instanceof Error ? err.message : 'Failed to delete task',
      )
      // Refetch the collection so the cache is consistent again.
      try {
        const refreshed = await listTaskItems(colUid)
        if (cancelledRef.current) return
        setItemsByUid((prev) => {
          const next = new Map(prev)
          next.set(colUid, refreshed.items)
          return next
        })
      } catch {
        // best effort; leave the optimistic state in place
      }
    }
  }, [activeUid, confirmDelete])

  const handleChangePriority = useCallback(
    async (node: TaskNode, newPriority: Priority) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = node.itemUid
      const original: TaskItem = { itemUid, todo: node.todo }
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...node.todo, priority: newPriority },
      }
      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)
      try {
        const result = await updateTask(colUid, itemUid, {
          priority: newPriority,
        })
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        setMutationError(
          err instanceof Error ? err.message : 'Failed to update priority',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid],
  )

  const requestMoveNode = useCallback(
    (node: TaskNode) => {
      if (!activeUid) return
      const itemUids = collectDescendantItemUids(node)
      setMoving({
        itemUids,
        rootVtodoUid: node.todo.uid,
        summary: node.todo.summary,
        descendantCount: itemUids.length - 1,
      })
    },
    [activeUid],
  )

  // ---- Right-click context menus ----
  const openTaskMenu = useCallback(
    (node: TaskNode, x: number, y: number) => {
      const prio = (p: Priority): ContextMenuItem => ({
        label: `Priority: ${
          p === 0 ? 'None' : p === 1 ? 'High' : p === 5 ? 'Medium' : 'Low'
        }`,
        onSelect: () => void handleChangePriority(node, p),
        disabled: node.todo.priority === p,
      })
      setMenu({
        x,
        y,
        items: [
          {
            label: 'New subtask',
            onSelect: () => handleStartCreateChild(node),
          },
          {
            label: 'Move to another list…',
            onSelect: () => requestMoveNode(node),
          },
          prio(1),
          prio(5),
          prio(9),
          prio(0),
          {
            label: 'Delete',
            danger: true,
            onSelect: () => handleDeleteRequest(node),
          },
        ],
      })
    },
    [
      handleChangePriority,
      handleStartCreateChild,
      requestMoveNode,
      handleDeleteRequest,
    ],
  )

  const openListMenu = useCallback(
    (c: CollectionInfo, x: number, y: number) => {
      const locked = c.uid.startsWith('pending-') || c.isDeleted === true
      setMenu({
        x,
        y,
        items: [
          { label: 'New list', onSelect: startCreateList },
          {
            label: 'Rename',
            disabled: locked,
            onSelect: () => startRenameList(c),
          },
          {
            label: 'Recolour…',
            disabled: locked,
            onSelect: () => {
              setActiveUid(c.uid)
              setColorPopoverOpen(true)
            },
          },
          {
            label: 'Delete',
            danger: true,
            disabled: locked,
            onSelect: () => {
              setListError(null)
              setDeletingList(c)
            },
          },
        ],
      })
    },
    [startCreateList, startRenameList],
  )

  const openSidebarBlankMenu = useCallback(
    (x: number, y: number) => {
      setMenu({
        x,
        y,
        items: [{ label: 'New list', onSelect: startCreateList }],
      })
    },
    [startCreateList],
  )

  const handleRenameTask = useCallback(
    async (node: TaskNode, newSummary: string) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = node.itemUid
      const original: TaskItem = { itemUid, todo: node.todo }
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...node.todo, summary: newSummary },
      }
      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)
      try {
        const result = await updateTask(colUid, itemUid, {
          summary: newSummary,
        })
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        setMutationError(
          err instanceof Error ? err.message : 'Failed to rename task',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid],
  )

  const handleSaveDetails = useCallback(
    async (patch: VTodoPatch) => {
      if (!activeUid) return
      if (Object.keys(patch).length === 0) return
      const items = itemsByUid.get(activeUid)
      const target = items?.find((it) => it.todo.uid === selectedTaskUid)
      if (!target) return
      const colUid = activeUid
      const itemUid = target.itemUid
      const original = target
      // Apply the patch locally exactly the way the server will (update the
      // raw VTODO, then re-parse) so the optimistic view reflects every
      // field — not a hand-maintained subset. Falls back to the original
      // todo if the round-trip throws; the awaited server call surfaces
      // the real error in that case.
      let optimisticTodo = target.todo
      try {
        const parsed = parseVTodo(updateVTodo(target.todo.raw, patch))
        if (parsed) optimisticTodo = parsed
      } catch {
        // keep original
      }
      const optimistic: TaskItem = { itemUid, todo: optimisticTodo }

      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)

      // If the panel changed the task to COMPLETED, run it through the
      // grace-period flow so it doesn't blink out under Hide-done.
      if (patch.status === 'COMPLETED' && original.todo.status !== 'COMPLETED') {
        markRecentlyCompleted(original.todo.uid)
      } else if (
        patch.status !== undefined &&
        patch.status !== 'COMPLETED' &&
        original.todo.status === 'COMPLETED'
      ) {
        clearRecentlyCompleted(original.todo.uid)
      }

      try {
        const result = await updateTask(colUid, itemUid, patch)
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        if (
          patch.status === 'COMPLETED' &&
          original.todo.status !== 'COMPLETED'
        ) {
          clearRecentlyCompleted(original.todo.uid)
        }
        setMutationError(
          err instanceof Error ? err.message : 'Failed to save task',
        )
        throw err
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [
      activeUid,
      itemsByUid,
      selectedTaskUid,
      markRecentlyCompleted,
      clearRecentlyCompleted,
    ],
  )

  // Raw passthrough save for `broken` items: store the hand-edited iCal
  // verbatim, then re-parse (leniently) to refresh the row.
  const handleSaveRaw = useCallback(
    async (rawString: string) => {
      if (!activeUid) return
      const colUid = activeUid
      const items = itemsByUid.get(activeUid)
      const target = items?.find((it) => it.todo.uid === selectedTaskUid)
      if (!target) return
      const itemUid = target.itemUid
      const original = target
      setMutationError(null)
      setPendingItemUids((prev) => new Set(prev).add(itemUid))
      try {
        const result = await updateTaskRaw(colUid, itemUid, rawString)
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        setMutationError(
          err instanceof Error ? err.message : 'Failed to save raw content',
        )
        throw err
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid, itemsByUid, selectedTaskUid],
  )

  const handleToggleComplete = useCallback(
    async (node: TaskNode) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = node.itemUid
      const original: TaskItem = { itemUid, todo: node.todo }
      const nextStatus =
        node.todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED'
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...node.todo, status: nextStatus },
      }

      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)

      // Grace-period bookkeeping: keep newly-completed tasks visible briefly
      // when Hide-done is on; clear the timer if the user is uncompleting.
      if (nextStatus === 'COMPLETED') {
        markRecentlyCompleted(node.todo.uid)
      } else {
        clearRecentlyCompleted(node.todo.uid)
      }

      try {
        const result = await toggleComplete(colUid, itemUid, node.todo.status)
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        // Roll back the grace-period state too on failure.
        if (nextStatus === 'COMPLETED') {
          clearRecentlyCompleted(node.todo.uid)
        }
        setMutationError(
          err instanceof Error ? err.message : 'Failed to update task',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid, markRecentlyCompleted, clearRecentlyCompleted],
  )

  return (
    <div className="flex h-screen bg-bg text-text">
      {showKeybindings && (
        <KeybindingsModal onClose={() => setShowKeybindings(false)} />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.node.todo.summary || '(untitled)'}"?`}
          body={
            confirmDelete.descendantCount > 0
              ? `This will permanently delete this task and ${
                  confirmDelete.descendantCount
                } subtask${confirmDelete.descendantCount === 1 ? '' : 's'}.`
              : 'This will permanently delete this task.'
          }
          confirmLabel="Delete"
          destructive
          zoom={zoom.tasks}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
      {deletingList && (
        <ConfirmModal
          title={`Delete list "${deletingList.name || '(untitled)'}"?`}
          body={
            listBusy
              ? 'Deleting…'
              : listError
                ? listError
                : 'The list is removed from this and other EteSync clients. Cached items stay visible until you toggle "show deleted lists" off. This cannot be undone from here.'
          }
          confirmLabel={listBusy ? 'Deleting…' : 'Delete'}
          destructive
          zoom={zoom.sidebar}
          onCancel={() => {
            if (!listBusy) {
              setDeletingList(null)
              setListError(null)
            }
          }}
          onConfirm={() => {
            if (!listBusy) void handleDeleteList()
          }}
        />
      )}
      {moving && sortedCollections && activeUid && (
        <MoveTaskPicker
          collections={sortedCollections}
          excludeUid={activeUid}
          taskSummary={moving.summary}
          descendantCount={moving.descendantCount}
          onCancel={() => setMoving(null)}
          onPick={handleMovePick}
        />
      )}
      <aside
        style={{
          width:
            focusZone === 'sidebar'
              ? sidebarFocusedWidth
              : sidebarCollapsedWidth,
          zoom: zoom.sidebar,
        }}
        className={`relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface ${
          isResizingSidebar
            ? 'select-none'
            : 'transition-[width,opacity] duration-300 ease-out'
        } ${focusZone === 'sidebar' ? 'opacity-100' : 'opacity-30'}`}
      >
        {(() => {
          // Single source of truth for whether the sidebar renders the
          // full row (names visible) or the strip (dots + counts only).
          // Driven by the current rendered width so dragging either state
          // past the threshold flips the look smoothly.
          const renderedWidth =
            focusZone === 'sidebar'
              ? sidebarFocusedWidth
              : sidebarCollapsedWidth
          const showFull = renderedWidth >= SIDEBAR_FULL_THRESHOLD
          return (
            <>
              <div className="flex items-center justify-between gap-1 px-3 py-3">
                {showFull ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setFocusZone('sidebar')}
                      title="Focus the list selection (l)"
                      className="text-xs font-semibold uppercase tracking-wider text-text-faint transition-colors hover:text-text-muted"
                    >
                      Lists
                    </button>
                    <div className="relative flex items-center gap-1">
                      <button
                        type="button"
                        onClick={syncAll}
                        disabled={loadingUids.size > 0}
                        title={
                          loadingUids.size > 0
                            ? `Syncing ${loadingUids.size} list${loadingUids.size === 1 ? '' : 's'}…`
                            : 'Sync all lists'
                        }
                        aria-label="Sync all lists"
                        className="flex h-5 shrink-0 items-center justify-center gap-0.5 rounded-md border border-border px-1 text-[10px] text-text-faint transition-colors hover:border-border-strong hover:text-text-muted disabled:cursor-not-allowed"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          className={`h-3 w-3 ${loadingUids.size > 0 ? 'animate-spin' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                          <path d="M13.5 2.5v3h-3" />
                        </svg>
                        {loadingUids.size > 0 && (
                          <span className="tabular-nums">
                            {loadingUids.size}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={startCreateList}
                        title="New list (n)"
                        aria-label="New list"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] text-text-faint transition-colors hover:border-border-strong hover:text-text-muted"
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
                          <path d="M8 3v10M3 8h10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const col = sortedCollections?.find(
                            (c) => c.uid === activeUid,
                          )
                          if (col && !col.isDeleted) {
                            setListError(null)
                            setDeletingList(col)
                          }
                        }}
                        disabled={
                          !sortedCollections?.some(
                            (c) => c.uid === activeUid && !c.isDeleted,
                          )
                        }
                        title="Delete this list (Del)"
                        aria-label="Delete this list"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] text-text-faint transition-colors hover:border-danger/50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-faint"
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
                          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.4a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 4.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFocusZone('sidebar')
                          setColorPopoverOpen((open) => {
                            if (!open) {
                              const cur = sortedCollections?.find(
                                (c) => c.uid === activeUid,
                              )?.color
                              if (cur && /^#[0-9a-fA-F]{6}$/.test(cur)) {
                                setCustomColor(cur)
                              }
                            }
                            return !open
                          })
                        }}
                        disabled={
                          !sortedCollections?.some(
                            (c) => c.uid === activeUid && !c.isDeleted,
                          )
                        }
                        aria-expanded={colorPopoverOpen}
                        title="Recolour this list"
                        aria-label="Recolour this list"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] text-text-faint transition-colors hover:border-border-strong hover:text-text-muted disabled:cursor-not-allowed disabled:opacity-30"
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
                          <circle cx="8" cy="8" r="5.5" />
                          <circle cx="8" cy="5" r="0.6" fill="currentColor" />
                          <circle cx="5.2" cy="7.2" r="0.6" fill="currentColor" />
                          <circle cx="6.4" cy="10.4" r="0.6" fill="currentColor" />
                          <circle cx="10" cy="9.6" r="0.6" fill="currentColor" />
                        </svg>
                      </button>
                      {colorPopoverOpen && (
                        <div
                          ref={colorPopoverRef}
                          role="dialog"
                          aria-label="List colour"
                          className="absolute right-0 top-6 z-20 w-44 rounded-md border border-border bg-surface p-2 shadow-xl"
                        >
                          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                            List colour
                          </p>
                          <div className="flex flex-wrap gap-1.5 px-1">
                            {LIST_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => void handleSetListColor(c)}
                                title={c}
                                aria-label={`Set colour ${c}`}
                                className="h-5 w-5 rounded-full border border-border transition-transform hover:scale-110"
                                style={{ background: c }}
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => void handleSetListColor(undefined)}
                              title="Default (no colour)"
                              aria-label="Default colour"
                              className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] text-text-faint transition-colors hover:border-border-strong hover:text-text-muted"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-1.5 border-t border-border px-1 pt-2">
                            <input
                              type="color"
                              value={customColor}
                              onChange={(e) => setCustomColor(e.target.value)}
                              aria-label="Custom colour picker"
                              title="Pick any colour"
                              className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                            />
                            <input
                              type="text"
                              value={customColor}
                              spellCheck={false}
                              onChange={(e) => setCustomColor(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (/^#[0-9a-fA-F]{6}$/.test(customColor)) {
                                    void handleSetListColor(
                                      customColor.toLowerCase(),
                                    )
                                  }
                                }
                              }}
                              aria-label="Custom colour hex"
                              className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 font-mono text-xs text-text outline-none focus:border-border-strong"
                            />
                            <button
                              type="button"
                              disabled={!/^#[0-9a-fA-F]{6}$/.test(customColor)}
                              onClick={() =>
                                void handleSetListColor(
                                  customColor.toLowerCase(),
                                )
                              }
                              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Set
                            </button>
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setFocusZone('sidebar')
                          setSidebarSortOpen((open) => !open)
                          setSidebarSortFocusKey((k) => k + 1)
                        }}
                        aria-expanded={sidebarSortOpen}
                        aria-pressed={
                          sidebarSort.sort !== DEFAULT_SIDEBAR_SORT.sort ||
                          sidebarSort.reverse
                        }
                        title={`Sort lists — current: ${
                          sidebarSort.sort === 'name'
                            ? 'Name'
                            : sidebarSort.sort === 'open'
                              ? 'Open count'
                              : 'Total count'
                        }${sidebarSort.reverse ? ' (reversed)' : ''}`}
                        aria-label="Open sidebar sort"
                        className={`flex h-5 shrink-0 items-center justify-center rounded-md border px-1 text-[10px] transition-colors ${
                          sidebarSort.sort !== DEFAULT_SIDEBAR_SORT.sort ||
                          sidebarSort.reverse
                            ? 'border-accent/40 bg-accent-soft text-text'
                            : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
                        }`}
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
                          <path d="M4 3v10M4 13l-2-2M4 13l2-2" />
                          <path d="M9 4h6M9 8h4M9 12h2" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={toggleShowDeletedLists}
                        aria-pressed={showDeletedLists}
                        title={
                          showDeletedLists
                            ? 'Hide deleted lists'
                            : 'Show deleted lists (tombstones from other clients)'
                        }
                        aria-label="Toggle deleted lists"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] transition-colors ${
                          showDeletedLists
                            ? 'border-accent/40 bg-accent-soft text-text'
                            : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
                        }`}
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
                          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
                          <circle cx="8" cy="8" r="2" />
                          {!showDeletedLists && <path d="M3 13L13 3" />}
                        </svg>
                      </button>
                      {sidebarSortOpen && (
                        <SortPopover
                          title="Sort lists"
                          options={SIDEBAR_SORT_OPTIONS}
                          spec={sidebarSort}
                          onChange={setSidebarSort}
                          onClose={() => setSidebarSortOpen(false)}
                          onConfirm={() => {
                            setSidebarSortOpen(false)
                            setFocusZone('sidebar')
                          }}
                          focusKey={sidebarSortFocusKey}
                          footer="Global. Saved automatically."
                          positionClass="right-0 top-6"
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFocusZone('sidebar')}
                    title="Focus the list selection (l)"
                    aria-label="Focus list selection"
                    className="mx-auto text-xs font-semibold text-text-faint transition-colors hover:text-text-muted"
                  >
                    ›
                  </button>
                )}
              </div>
              <div
                className="flex-1 overflow-y-auto px-1"
                onContextMenu={(e) => {
                  e.preventDefault()
                  openSidebarBlankMenu(e.clientX, e.clientY)
                }}
              >
                {sortedCollections === null && !collectionsError && (
                  <p className="px-2 py-3 text-xs text-text-faint">
                    {showFull ? 'Loading…' : '…'}
                  </p>
                )}
                {collectionsError && showFull && (
                  <p className="px-2 py-3 text-xs text-danger">
                    {collectionsError}
                  </p>
                )}
                {sortedCollections &&
                  sortedCollections.length === 0 &&
                  pendingLists.length === 0 &&
                  showFull &&
                  !creatingList && (
                    <p className="px-2 py-3 text-xs text-text-faint">
                      No task lists found.
                    </p>
                  )}
                {creatingList && showFull && (
                  <div className="px-1 py-1">
                    <input
                      ref={newListRef}
                      type="text"
                      value={newListName}
                      disabled={listBusy}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleCreateList()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setCreatingList(false)
                          setNewListName('')
                          setListError(null)
                        }
                      }}
                      onBlur={() => {
                        if (newListName.trim()) void handleCreateList()
                        else setCreatingList(false)
                      }}
                      placeholder="New list name…"
                      className="w-full rounded-md border border-accent/40 bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                )}
                {listError && !deletingList && showFull && (
                  <p className="px-2 py-1.5 text-[11px] text-danger">
                    {listError}
                  </p>
                )}
                {displayCollections?.map((c) => {
                  const isActive = c.uid === activeUid
                  const items = itemsByUid.get(c.uid)
                  const counts = items ? countTasks(items) : null
                  const listSyncing =
                    loadingUids.has(c.uid) || listSyncUids.has(c.uid)
                  // Optimistic create placeholders aren't real server
                  // collections yet — not selectable / renamable.
                  const isPlaceholder = c.uid.startsWith('pending-')
                  const failed = errorByUid.get(c.uid)
                  const sidebarHot = isActive && focusZone === 'sidebar'
                  const deleted = c.isDeleted === true
                  const baseTitle = deleted ? `${c.name} (deleted)` : c.name
                  if (renamingListUid === c.uid && showFull) {
                    return (
                      <div
                        key={c.uid}
                        data-collection-uid={c.uid}
                        className="flex w-full items-center gap-2 px-2 py-1"
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background:
                              c.color || 'var(--color-border-strong)',
                          }}
                        />
                        <input
                          ref={renameListRef}
                          type="text"
                          value={renameListName}
                          disabled={listBusy}
                          onChange={(e) => setRenameListName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleRenameList()
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setRenamingListUid(null)
                              setListError(null)
                            }
                          }}
                          onBlur={() => void handleRenameList()}
                          className="min-w-0 flex-1 rounded-md border border-accent/40 bg-surface-2 px-1.5 py-1 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
                        />
                      </div>
                    )
                  }
                  return (
                    <button
                      key={c.uid}
                      data-collection-uid={c.uid}
                      type="button"
                      onClick={() => {
                        if (isPlaceholder) return
                        setActiveUid(c.uid)
                        setFocusZone('sidebar')
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        openListMenu(c, e.clientX, e.clientY)
                      }}
                      onDoubleClick={() => {
                        if (!deleted && !isPlaceholder) startRenameList(c)
                      }}
                      onDragOver={(e) => {
                        const ok =
                          !isPlaceholder &&
                          !deleted &&
                          c.uid !== activeUid &&
                          e.dataTransfer.types.includes(TASK_DND_MIME)
                        if (!ok) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragOverListUid !== c.uid)
                          setDragOverListUid(c.uid)
                      }}
                      onDragLeave={() => {
                        setDragOverListUid((u) =>
                          u === c.uid ? null : u,
                        )
                      }}
                      onDrop={(e) => {
                        const uid = e.dataTransfer.getData(TASK_DND_MIME)
                        setDragOverListUid(null)
                        if (
                          !uid ||
                          isPlaceholder ||
                          deleted ||
                          c.uid === activeUid
                        )
                          return
                        e.preventDefault()
                        handleDropTaskOnList(c.uid, uid)
                      }}
                      title={
                        showFull
                          ? deleted
                            ? `${c.name} — tombstoned. Cached items still visible; new edits will fail.`
                            : undefined
                          : counts
                            ? `${baseTitle} — ${counts.open} open of ${counts.total}`
                            : failed
                              ? `${baseTitle} — ${failed}`
                              : baseTitle
                      }
                      className={`flex w-full items-center gap-2 rounded-md py-1.5 text-left text-sm transition-colors ${
                        showFull ? 'px-2 justify-start' : 'px-1 justify-center'
                      } ${
                        isActive
                          ? sidebarHot
                            ? 'bg-accent-soft text-text ring-1 ring-accent/40'
                            : 'bg-accent-soft text-text'
                          : 'text-text-muted hover:bg-surface-2 hover:text-text'
                      } ${deleted ? 'opacity-50' : ''} ${
                        dragOverListUid === c.uid
                          ? 'ring-2 ring-accent ring-inset'
                          : ''
                      }`}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            c.color || 'var(--color-border-strong)',
                        }}
                      />
                      {showFull && (
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            deleted ? 'line-through' : ''
                          }`}
                        >
                          {c.name}
                        </span>
                      )}
                      {listSyncing && (
                        <svg
                          viewBox="0 0 16 16"
                          className="h-3 w-3 shrink-0 animate-spin text-text-faint"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-label="Syncing"
                        >
                          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                          <path d="M13.5 2.5v3h-3" />
                        </svg>
                      )}
                      <span
                        className={`shrink-0 text-xs tabular-nums ${
                          isActive ? 'text-text-muted' : 'text-text-faint'
                        }`}
                        title={
                          showFull
                            ? listSyncing
                              ? 'Syncing…'
                              : counts
                                ? `${counts.open} open of ${counts.total}`
                                : failed
                                  ? failed
                                  : 'Loading…'
                            : undefined
                        }
                      >
                        {counts ? counts.open : failed ? '!' : '…'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-border px-2 py-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  title={showFull ? undefined : 'Sign out'}
                  aria-label="Sign out"
                  className={`text-xs text-text-faint hover:text-text-muted ${
                    showFull ? '' : 'flex w-full justify-center'
                  }`}
                >
                  {showFull ? (
                    'Sign out'
                  ) : (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
                      <path d="M10 5l3 3-3 3M6 8h7" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )
        })()}
        {/* Resize handle on the right edge. 6 px wide hit area; only a
            1 px line shows on hover. Drag persists the width to the
            current focus state's localStorage key. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={
            focusZone === 'sidebar'
              ? 'Resize sidebar (focused width)'
              : 'Resize sidebar (collapsed width)'
          }
          onMouseDown={handleSidebarResizeStart}
          className="group absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize"
        >
          <div
            className={`mx-auto h-full w-px transition-colors ${
              isResizingSidebar
                ? 'bg-accent'
                : 'bg-transparent group-hover:bg-accent/40'
            }`}
          />
        </div>
      </aside>

      <main
        data-focus-zone={focusZone}
        style={{ zoom: zoom.tasks }}
        className={`relative flex flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-out ${
          focusZone === 'tasks' ? 'opacity-100' : 'opacity-20'
        }`}
        onMouseDown={(e) => {
          // Pull focus to the tasks pane when the user clicks anywhere in
          // the centre column (without preventing the underlying click).
          if (focusZone !== 'tasks') {
            const t = e.target as HTMLElement
            // ignore clicks in modals and in the detail panel
            if (
              !t.closest('[role="dialog"]') &&
              !t.closest('[data-detail-zone]')
            ) {
              setFocusZone('tasks')
            }
          }
        }}
      >
        {mutationError && (
          <div
            role="alert"
            className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-md border border-danger/30 bg-surface px-3 py-2 text-xs text-danger shadow-lg"
          >
            <span className="flex-1">{mutationError}</span>
            <button
              type="button"
              onClick={() => setMutationError(null)}
              className="text-text-faint hover:text-text-muted"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="truncate text-sm font-medium text-text">
              {activeCollection?.name ?? '—'}
            </h2>
            {activeCounts && (
              <span className="text-xs tabular-nums text-text-faint">
                {activeCounts.open} open · {activeCounts.total}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeLoading && (
              <span
                className="text-xs text-text-faint tabular-nums"
                title={
                  activeSyncEntry
                    ? `${activeSyncEntry.count} item${activeSyncEntry.count === 1 ? '' : 's'} received over ${activeSyncElapsedS}s`
                    : 'Sync in progress'
                }
              >
                {activeSyncEntry
                  ? activeSyncEntry.count > 0
                    ? `Syncing… ${activeSyncEntry.count} item${activeSyncEntry.count === 1 ? '' : 's'} · ${activeSyncElapsedS}s`
                    : `Syncing… ${activeSyncElapsedS}s`
                  : 'Syncing…'}
              </span>
            )}
            <div
              className="flex shrink-0 items-center rounded-md border border-border text-text-muted"
              title="Task card size (Ctrl/Cmd + / - / 0)"
            >
              <button
                type="button"
                onClick={() => adjustZoom('tasks', -ZOOM_STEP)}
                aria-label="Smaller task cards"
                className="flex h-7 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => adjustZoom('tasks', 'reset')}
                aria-label="Reset task card size"
                title="Reset (Ctrl/Cmd+0)"
                className="h-7 min-w-[2.75rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
              >
                {Math.round(zoom.tasks * 100)}%
              </button>
              <button
                type="button"
                onClick={() => adjustZoom('tasks', ZOOM_STEP)}
                aria-label="Larger task cards"
                className="flex h-7 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text"
              >
                A+
              </button>
            </div>
            <button
              type="button"
              onClick={refreshActive}
              disabled={!activeUid || activeLoading}
              title={
                activeLoading
                  ? 'Syncing…'
                  : 'Force sync — re-fetch this list from the server'
              }
              aria-label="Force sync"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 ${activeLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                <path d="M13.5 2.5v3h-3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleStartCreateRoot}
              disabled={!activeUid || !activeItems}
              title="Add task (at top of list)"
              aria-label="Add task"
              className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
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
              <span>Add task</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilter({ ...filter, hideCompleted: !filter.hideCompleted })
              }
              aria-pressed={filter.hideCompleted}
              title={
                filter.hideCompleted
                  ? 'Showing only open tasks — click to show completed'
                  : 'Hide completed tasks'
              }
              aria-label="Toggle hide completed"
              className={`flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors ${
                filter.hideCompleted
                  ? 'border-accent/40 bg-accent-soft text-text'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text'
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {filter.hideCompleted ? (
                  <>
                    <path d="M2 8s2.5-4.5 6-4.5 6 4.5 6 4.5-2.5 4.5-6 4.5S2 8 2 8z" />
                    <circle cx="8" cy="8" r="2" />
                    <path d="M2.5 13.5l11-11" />
                  </>
                ) : (
                  <>
                    <path d="M2 8s2.5-4.5 6-4.5 6 4.5 6 4.5-2.5 4.5-6 4.5S2 8 2 8z" />
                    <circle cx="8" cy="8" r="2" />
                  </>
                )}
              </svg>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                aria-expanded={filterOpen}
                aria-pressed={isFilterActive(filter)}
                title="Filter (f)"
                className={`relative flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
                  isFilterActive(filter)
                    ? 'border-accent/40 bg-accent-soft text-text'
                    : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2.5 3h11l-4 5.5V13l-3 1.5V8.5L2.5 3z" />
                </svg>
                <span>Filter</span>
                {isFilterActive(filter) && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent"
                  />
                )}
              </button>
              {filterOpen && (
                <FilterPopover
                  filter={filter}
                  onChange={setFilter}
                  onClose={() => setFilterOpen(false)}
                  onSubmit={() => {
                    setFilterOpen(false)
                    setFocusZone('tasks')
                  }}
                  availableTags={availableTags}
                  focusKey={filterFocusKey}
                />
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setFocusZone('tasks')
                  setSortOpen((open) => !open)
                  setSortFocusKey((k) => k + 1)
                }}
                disabled={!activeUid}
                aria-expanded={sortOpen}
                aria-pressed={activeSort.sort !== DEFAULT_TASK_SORT.sort}
                title={`Sort tasks (s) — ${activeSort.sort}${activeSort.reverse ? ' ↓' : ''}`}
                className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeSort.sort !== DEFAULT_TASK_SORT.sort ||
                  activeSort.reverse
                    ? 'border-accent/40 bg-accent-soft text-text'
                    : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 3v10M4 13l-2-2M4 13l2-2" />
                  <path d="M9 4h6M9 8h4M9 12h2" />
                </svg>
                <span>Sort</span>
              </button>
              {sortOpen && activeUid && (
                <SortPopover
                  title="Sort tasks"
                  options={TASK_SORT_OPTIONS}
                  spec={activeSort}
                  onChange={setActiveSort}
                  onClose={() => setSortOpen(false)}
                  onConfirm={() => {
                    setSortOpen(false)
                    setFocusZone('tasks')
                  }}
                  focusKey={sortFocusKey}
                  footer="Per-list. Saved automatically."
                />
              )}
            </div>
            <button
              type="button"
              onClick={togglePhonePriority}
              aria-pressed={phonePriority}
              title={
                phonePriority
                  ? 'Phone-friendly priority on — dropdown shows 4 buckets (None/High/Medium/Low). Click for full 9 levels.'
                  : 'Phone-friendly priority off — dropdown shows all 9 levels. Click for 4-bucket UI that survives phone round-trips.'
              }
              aria-label="Toggle phone-friendly priority"
              className={`flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors ${
                phonePriority
                  ? 'border-accent/40 bg-accent-soft text-text'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text'
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
                <path d="M7 12.5h2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              title={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
              aria-label="Toggle theme"
              aria-pressed={theme === 'light'}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {theme === 'dark' ? (
                /* Sun — clicking goes to light. */
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="8" cy="8" r="3" />
                  <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1" />
                </svg>
              ) : (
                /* Moon — clicking goes to dark. */
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a5 5 0 0 0 7 7z" />
                </svg>
              )}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAccentHex(accent ?? '#2f8a6c')
                  setAccentOpen((o) => !o)
                }}
                aria-expanded={accentOpen}
                aria-label="Accent colour"
                title="Accent colour"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M8 1.5c3.6 0 6.5 2.7 6.5 6 0 2-1.6 3-3 3h-1.6c-.8 0-1.4.6-1.4 1.4 0 .4.2.7.2 1 0 .8-.7 1.1-1.2 1.1A6.5 6.5 0 0 1 8 1.5z" />
                  <circle cx="5.5" cy="6" r="0.6" fill="currentColor" />
                  <circle cx="8" cy="4.5" r="0.6" fill="currentColor" />
                  <circle cx="10.5" cy="6" r="0.6" fill="currentColor" />
                </svg>
              </button>
              {accentOpen && (
                <div
                  ref={accentRef}
                  role="dialog"
                  aria-label="Accent colour picker"
                  className="absolute right-0 top-9 z-30 w-48 rounded-md border border-border bg-surface p-2 shadow-xl"
                >
                  <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                    Accent colour
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setAccent(c)
                          setAccentOpen(false)
                        }}
                        title={c}
                        aria-label={`Accent ${c}`}
                        className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                          accent === c
                            ? 'border-text'
                            : 'border-border'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setAccent(null)
                        setAccentOpen(false)
                      }}
                      title="Theme default"
                      aria-label="Default accent"
                      className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
                        accent === null
                          ? 'border-text text-text'
                          : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
                      }`}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 border-t border-border px-1 pt-2">
                    <input
                      type="color"
                      value={accentHex}
                      onChange={(e) => setAccentHex(e.target.value)}
                      aria-label="Custom accent picker"
                      className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={accentHex}
                      spellCheck={false}
                      onChange={(e) => setAccentHex(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          /^#[0-9a-fA-F]{6}$/.test(accentHex)
                        ) {
                          e.preventDefault()
                          setAccent(accentHex.toLowerCase())
                          setAccentOpen(false)
                        }
                      }}
                      aria-label="Custom accent hex"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 font-mono text-xs text-text outline-none focus:border-border-strong"
                    />
                    <button
                      type="button"
                      disabled={!/^#[0-9a-fA-F]{6}$/.test(accentHex)}
                      onClick={() => {
                        setAccent(accentHex.toLowerCase())
                        setAccentOpen(false)
                      }}
                      className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Set
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowKeybindings(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              ?
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {/* Sync error: full-page when we have nothing to show, otherwise
              a non-blocking banner above the cached tree so the user can
              keep working from what was previously synced. */}
          {activeError && !activeItems && (
            <div className="px-5 py-4 text-sm text-danger">
              <p>{activeError}</p>
              <button
                type="button"
                onClick={refreshActive}
                disabled={activeLoading}
                className="mt-2 rounded border border-danger/40 px-2 py-0.5 text-[11px] text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeLoading ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {activeError && activeItems && (
            <div
              role="status"
              className="mx-5 mt-3 flex items-center gap-2 rounded-md border border-danger/30 bg-surface-2 px-3 py-2 text-xs text-danger"
            >
              <span className="flex-1">
                Sync failed — showing cached tasks. {activeError}
              </span>
              <button
                type="button"
                onClick={refreshActive}
                disabled={activeLoading}
                className="shrink-0 rounded border border-danger/40 px-2 py-0.5 text-[11px] text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeLoading ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {!activeError &&
            activeItems === undefined &&
            !activeLoading && (
              <p className="px-5 py-4 text-sm text-text-faint">Loading tasks…</p>
            )}
          {activeItems && (visibleTree.length > 0 || creating) && (
            <TaskTree
              roots={visibleTree}
              onToggleComplete={handleToggleComplete}
              onCycleStatus={handleCycleStatus}
              pendingUids={pendingItemUids}
              creatingParent={creating ? creating.parentUid : undefined}
              onAddChild={handleStartCreateChild}
              onConfirmCreate={handleConfirmCreate}
              onConfirmCreateAndOpen={handleConfirmCreateAndOpen}
              onCancelCreate={handleCancelCreate}
              onRenameTask={handleRenameTask}
              onDeleteRequest={handleDeleteRequest}
              onChangePriority={handleChangePriority}
              onRowContextMenu={openTaskMenu}
              taskDndMime={TASK_DND_MIME}
              onLeaveLeft={() => setFocusZone('sidebar')}
              fadingExpires={fadingExpires}
              phonePriority={phonePriority}
              selectedUid={selectedTaskUid}
              onSelectChange={(uid) => {
                setSelectedTaskUid(uid)
                setFocusZone('tasks')
              }}
              inactive={focusZone !== 'tasks'}
            />
          )}
          {activeItems && visibleTree.length === 0 && !creating && (
            <p className="px-5 py-4 text-sm text-text-faint">
              {activeLoading
                ? 'Loading tasks…'
                : isFilterActive(filter) && fullTree.length > 0
                  ? 'No tasks match the current filter.'
                  : 'No tasks in this list.'}
            </p>
          )}
        </div>
      </main>

      <DetailPanel
        key={selectedTaskItem?.todo.uid ?? '__empty__'}
        task={selectedTaskItem}
        ancestors={detailAncestors}
        allTasks={activeItems ?? []}
        zoom={zoom.details}
        focused={focusZone === 'details'}
        pinned={detailPinned}
        onTogglePin={toggleDetailPinned}
        phonePriority={phonePriority}
        onRequestFocus={() => setFocusZone('details')}
        onExit={() => setFocusZone('tasks')}
        onSave={handleSaveDetails}
        onSaveRaw={handleSaveRaw}
        pending={
          selectedTaskItem
            ? pendingItemUids.has(selectedTaskItem.itemUid)
            : false
        }
      />
      <EditModeIndicator />
      {menu && (
        <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
