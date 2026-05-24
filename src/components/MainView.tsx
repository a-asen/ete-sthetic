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
  findParentAndSiblings,
  getAncestorChain,
} from '../services/tree'
import { parseVTodo, updateVTodo, type VTodoPatch } from '../services/vtodo'
import {
  type CollectionSnapshot,
  deleteSnapshot,
  listSnapshotUids,
  loadCollectionsList,
  loadSnapshot,
  saveCollectionsList,
  saveSnapshot,
} from '../services/snapshots'
import {
  getTaskMemory,
  patchTaskMemory,
  rememberLastSelected,
} from '../services/taskstore'
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
import { SettingsPopover } from './SettingsPopover'
import { SidebarSettingsPopover } from './SidebarSettingsPopover'
import { Hint } from './Hint'
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

const HIDE_COMPLETED_KEY = 'ete-sthetic.hideCompleted'
const DETAIL_PINNED_KEY = 'ete-sthetic.detailPanelPinned'
const SHOW_DELETED_LISTS_KEY = 'ete-sthetic.showDeletedLists'
const SIDEBAR_SORT_KEY = 'ete-sthetic.sidebarSort'
const PHONE_PRIORITY_KEY = 'ete-sthetic.phoneFriendlyPriority'

// Adaptive sync settings (all in minutes; 0 = off/manual). The active
// list refreshes frequently; other lists much less often; switching to
// a list kicks a background sync only if it's older than the freshness
// window.
const ACTIVE_SYNC_KEY = 'ete-sthetic.activeSyncMin'
const BG_SYNC_KEY = 'ete-sthetic.bgSyncMin'
const SWITCH_FRESH_KEY = 'ete-sthetic.switchFreshMin'
const ACTIVE_SYNC_OPTIONS = [0, 1, 5, 15, 30, 60] as const
const BG_SYNC_OPTIONS = [0, 30, 60, 240, 720, 1440] as const
const SWITCH_FRESH_OPTIONS = [0, 15, 30, 60, 240] as const
const DEFAULT_ACTIVE_SYNC_MIN = 5
const DEFAULT_BG_SYNC_MIN = 240
const DEFAULT_SWITCH_FRESH_MIN = 60

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
    // not fatal
  }
}

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
const SIDEBAR_FOCUSED_WIDTH_KEY = 'ete-sthetic.sidebarFocusedWidth'
const SIDEBAR_COLLAPSED_WIDTH_KEY = 'ete-sthetic.sidebarCollapsedWidth'
const DETAIL_FOCUSED_WIDTH_KEY = 'ete-sthetic.detailFocusedWidth'
// Detail panel resize bounds. Default matches the prior w-80 (320 px).
const DETAIL_MIN_WIDTH = 240
const DETAIL_MAX_WIDTH = 720
const DETAIL_DEFAULT_WIDTH = 320
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
// A completed task lingers solid for HIDE_GRACE_MS (the "oops, un-click"
// window), then fades out over FADE_MS. CASCADE_STEP_MS staggers the fade
// down a branch: each completed parent starts fading a beat after its
// completed children, so a finished subtree clears bottom-up.
const HIDE_GRACE_MS = 5000
const FADE_MS = 1400
const CASCADE_STEP_MS = 700
const EMPTY_FADING: ReadonlySet<string> = new Set()
const EMPTY_REVEALED: ReadonlySet<string> = new Set()
const EMPTY_DONE_COUNTS: ReadonlyMap<string, number> = new Map()

// Drag-and-drop: a task row carries its VTODO uid under this mime so a
// sidebar list row can accept the drop and move the subtree.
const TASK_DND_MIME = 'application/x-ete-task-uid'

interface MovePayload {
  itemUids: string[]
  rootVtodoUid: string
  summary: string
  descendantCount: number
  // When true, after the move resolves the active list switches to the
  // destination and the moved root re-selects there (the "go look at it
  // where it landed" path). When false, the user stays on the source
  // list and the just-moved row leaves the view (the more common "get
  // this off my plate" path). Drag-to-list keeps the legacy follow
  // behaviour since the drop's destination is the user's pointer goal.
  follow: boolean
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

function readDetailWidth(): number {
  try {
    const raw = localStorage.getItem(DETAIL_FOCUSED_WIDTH_KEY)
    if (raw == null) return DETAIL_DEFAULT_WIDTH
    const n = Number(raw)
    if (!Number.isFinite(n)) return DETAIL_DEFAULT_WIDTH
    return Math.max(DETAIL_MIN_WIDTH, Math.min(DETAIL_MAX_WIDTH, n))
  } catch {
    return DETAIL_DEFAULT_WIDTH
  }
}
function writeDetailWidth(value: number) {
  try {
    localStorage.setItem(DETAIL_FOCUSED_WIDTH_KEY, String(Math.round(value)))
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
  sidebar: 'ete-sthetic.zoom.sidebar',
  tasks: 'ete-sthetic.zoom.tasks',
  details: 'ete-sthetic.zoom.details',
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
  // Seed initial state from the process-lifetime task memory cache so
  // switching back from the calendar module is instant (no spinner, no
  // disk reread). The state-mirror effect below keeps the cache in sync.
  const m0 = getTaskMemory()
  const [collections, setCollections] = useState<CollectionInfo[] | null>(
    () => m0.collections,
  )
  const [collectionsError, setCollectionsError] = useState<string | null>(null)
  // True while the last collections load failed and we're rendering the
  // on-disk cached list — i.e. we're offline / the server is unreachable
  // and no sync can happen until it recovers.
  const [offline, setOffline] = useState(false)
  const [activeUid, setActiveUid] = useState<string | null>(() => m0.activeUid)

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
  const quickAddRef = useRef<HTMLInputElement>(null)
  const sidebarSettingsBtnRef = useRef<HTMLButtonElement>(null)
  // Guards against the create-list input firing twice (Enter then the
  // unmount blur), which was creating duplicate lists.
  const creatingListBusyRef = useRef(false)
  // Type-to-search buffer for the sidebar list view.
  const taskTypeaheadRef = useRef<{ buf: string; time: number }>({
    buf: '',
    time: 0,
  })
  const listTypeaheadRef = useRef<{ buf: string; time: number }>({
    buf: '',
    time: 0,
  })

  const [itemsByUid, setItemsByUid] = useState<Map<string, TaskItem[]>>(
    () => new Map(m0.itemsByUid),
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
  const [loadedUids, setLoadedUids] = useState<Set<string>>(
    () => new Set(m0.loadedUids),
  )
  // Per-collection sync token (Etebase stoken). Persisted alongside the
  // items so re-opens fetch only the delta.
  const [stokenByUid, setStokenByUid] = useState<Map<string, string>>(
    () => new Map(m0.stokenByUid),
  )
  // Warm memory counts as already-hydrated — the disk pass below bails
  // out and we render instantly from the cache.
  const [hydrated, setHydrated] = useState<boolean>(() => m0.warmed)
  const [activeSyncMin, setActiveSyncMinState] = useState(() =>
    readIntPref(ACTIVE_SYNC_KEY, ACTIVE_SYNC_OPTIONS, DEFAULT_ACTIVE_SYNC_MIN),
  )
  const [bgSyncMin, setBgSyncMinState] = useState(() =>
    readIntPref(BG_SYNC_KEY, BG_SYNC_OPTIONS, DEFAULT_BG_SYNC_MIN),
  )
  const [switchFreshMin, setSwitchFreshMinState] = useState(() =>
    readIntPref(
      SWITCH_FRESH_KEY,
      SWITCH_FRESH_OPTIONS,
      DEFAULT_SWITCH_FRESH_MIN,
    ),
  )
  const setActiveSyncMin = useCallback((n: number) => {
    setActiveSyncMinState(n)
    writeIntPref(ACTIVE_SYNC_KEY, n)
  }, [])
  const setBgSyncMin = useCallback((n: number) => {
    setBgSyncMinState(n)
    writeIntPref(BG_SYNC_KEY, n)
  }, [])
  const setSwitchFreshMin = useCallback((n: number) => {
    setSwitchFreshMinState(n)
    writeIntPref(SWITCH_FRESH_KEY, n)
  }, [])
  // uid → last successful sync time (ms). Seeded from disk snapshots at
  // hydration so a recent cache doesn't trigger a re-sync just from
  // switching to the list. A ref (not state) — it only gates effects.
  const syncedAtRef = useRef<Map<string, number>>(new Map(m0.syncedAt))

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
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(
    () => m0.selectedTaskUid,
  )
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [sidebarSettingsOpen, setSidebarSettingsOpen] = useState(false)
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false)
  const [customColor, setCustomColor] = useState('#5e8fd9')
  const colorPopoverRef = useRef<HTMLDivElement>(null)
  // Clear the drop highlight if a drag ends anywhere (dropped outside a
  // list, or cancelled with Esc) so it can never stay stuck on.
  useEffect(() => {
    const clear = () => setDragOverListUid(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

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
  const [detailFocusedWidth, setDetailFocusedWidth] = useState<number>(() =>
    readDetailWidth(),
  )
  const [isResizingDetail, setIsResizingDetail] = useState(false)
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
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

  // Detail panel resize. The panel hugs the window's right edge, so a
  // leftward drag *increases* the width (delta is inverted vs sidebar).
  const handleDetailResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = detailFocusedWidth
      let latest = startWidth
      setIsResizingDetail(true)
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          DETAIL_MIN_WIDTH,
          Math.min(DETAIL_MAX_WIDTH, startWidth - (ev.clientX - startX)),
        )
        latest = next
        setDetailFocusedWidth(next)
      }
      const onUp = () => {
        setIsResizingDetail(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        writeDetailWidth(latest)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [detailFocusedWidth],
  )
  // When Hide-done is on, completed tasks linger for a grace window before
  // disappearing so a misclicked checkbox can be untoggled. Map value is the
  // expiry timestamp (removal time) so the row can show a countdown.
  const [recentlyCompleted, setRecentlyCompleted] = useState<
    Map<string, number>
  >(() => new Map())
  // The subset of `recentlyCompleted` currently in its fade-out animation
  // (the last FADE_MS before removal). Driven by precise per-uid timers so
  // the cascade staggers cleanly rather than at the countdown's tick rate.
  const [fadingUids, setFadingUids] = useState<Set<string>>(() => new Set())
  // Per uid: the fade-start timer and the removal timer.
  const completionTimers = useRef<
    Map<string, { fade: number; remove: number }>
  >(new Map())
  // Synchronous mirror of `recentlyCompleted` so markRecentlyCompleted can
  // read the live schedule (incl. back-to-back completions) without taking
  // the state as a dependency.
  const recentlyCompletedRef = useRef(recentlyCompleted)
  // Latest active-list items, for resolving the parent/child links the
  // cascade walks. A ref so the completion handlers stay stable.
  const activeItemsRef = useRef<TaskItem[] | undefined>(undefined)
  // Per-branch "show completed" peeks (parent uids). Lets the user
  // inspect a branch's completed subtasks under Hide-done without
  // un-hiding completed tasks globally. Transient — reset on list switch.
  const [revealedBranches, setRevealedBranches] = useState<Set<string>>(
    () => new Set(),
  )
  // Synchronous mirror so the completion handlers can tell whether a
  // freshly-completed task is pinned visible by a reveal.
  const revealedBranchesRef = useRef(revealedBranches)

  const inFlightRef = useRef<Set<string>>(new Set())
  const cancelledRef = useRef(false)

  // Forward ref to the (later-defined) detail-save handler so the global
  // keybindings effect — which runs before handleSaveDetails is defined —
  // can call it for the Alt+←/→ indent/outdent shortcuts. A live ref
  // (updated by an effect downstream) keeps the closure fresh without
  // forcing the keybindings effect to re-subscribe on every render of
  // handleSaveDetails's identity.
  const handleSaveDetailsRef =
    useRef<((patch: VTodoPatch) => Promise<void>) | null>(null)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    recentlyCompletedRef.current = recentlyCompleted
  }, [recentlyCompleted])

  useEffect(() => {
    revealedBranchesRef.current = revealedBranches
  }, [revealedBranches])

  // Cleanup any pending completion timers on unmount.
  useEffect(() => {
    const timers = completionTimers.current
    return () => {
      for (const { fade, remove } of timers.values()) {
        clearTimeout(fade)
        clearTimeout(remove)
      }
      timers.clear()
    }
  }, [])

  // Hydrate cached snapshots from disk before any network sync. This makes
  // the second-and-onward app open instant: trees render immediately and
  // sync only pulls deltas. Skipped on a warm intra-session remount —
  // taskstore already holds the parsed VTODOs from earlier this session.
  useEffect(() => {
    if (getTaskMemory().warmed) return
    let cancelled = false

    // Safety net for the "Loading tasks… forever" bug: if the disk pass
    // hasn't completed within 2s — whether a Vite/Tauri HMR + strict-mode
    // double-mount swallowed the IIFE's resolution, or disk I/O genuinely
    // stalled — force `hydrated = true` so the network-sync trigger
    // (gated on `!hydrated || !activeUid`) can fire instead of leaving
    // the pane stuck. Happy path: the finally below clears the timer
    // first. Failure path: we skip the cold-cache optimisation for this
    // session and fall through to a normal network sync.
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setHydrated(true)
    }, 2000)

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
          if (snap.lastSyncedAt) {
            syncedAtRef.current.set(snap.uid, snap.lastSyncedAt)
          }
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
        clearTimeout(safetyTimer)
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(safetyTimer)
    }
  }, [])

  // Mirror render state into the process-lifetime cache so an unmount
  // (module switch) doesn't lose it — matches CalendarView's calstore
  // mirror. Marks `warmed` so the disk-hydration effect can skip the
  // re-mount round trip.
  useEffect(() => {
    patchTaskMemory({
      collections,
      itemsByUid,
      stokenByUid,
      loadedUids,
      syncedAt: syncedAtRef.current,
      activeUid,
      selectedTaskUid,
      warmed: true,
    })
  }, [
    collections,
    itemsByUid,
    stokenByUid,
    loadedUids,
    activeUid,
    selectedTaskUid,
  ])

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

  // (Re)arm a uid's two timers: it enters the fade animation after
  // `fadeDelayMs`, and is removed (with its fade flag) after
  // `removeDelayMs`. Clears any prior timers and un-sets the fade flag so
  // a re-armed row restarts solid until its (possibly later) fade turn.
  const armCompletionTimers = useCallback(
    (uid: string, fadeDelayMs: number, removeDelayMs: number) => {
      const timers = completionTimers.current
      const existing = timers.get(uid)
      if (existing) {
        clearTimeout(existing.fade)
        clearTimeout(existing.remove)
      }
      setFadingUids((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Set(prev)
        next.delete(uid)
        return next
      })
      const fade = window.setTimeout(() => {
        setFadingUids((prev) => {
          if (prev.has(uid)) return prev
          const next = new Set(prev)
          next.add(uid)
          return next
        })
      }, Math.max(0, fadeDelayMs))
      const remove = window.setTimeout(() => {
        setRecentlyCompleted((prev) => {
          if (!prev.has(uid)) return prev
          const next = new Map(prev)
          next.delete(uid)
          recentlyCompletedRef.current = next
          return next
        })
        setFadingUids((prev) => {
          if (!prev.has(uid)) return prev
          const next = new Set(prev)
          next.delete(uid)
          return next
        })
        completionTimers.current.delete(uid)
      }, Math.max(0, removeDelayMs))
      timers.set(uid, { fade, remove })
    },
    [],
  )

  // Mark `uid` newly completed and (re)schedule the cascade. A node fades
  // after its own HIDE_GRACE_MS, but never sooner than a CASCADE_STEP past
  // its latest still-fading child; each completed ancestor of the
  // now-finished subtree trails the level below it, so a completed subtree
  // clears bottom-up. A completed task that still has an open descendant
  // isn't leaving — it's skipped (it stays via applyFilter's
  // surviving-descendant rule), and gets pulled into the cascade only once
  // that last descendant is itself completed.
  const markRecentlyCompleted = useCallback(
    (uid: string) => {
      // buildTree resolves PARENT and CHILD reltypes and breaks cycles, so
      // the cascade walks the same hierarchy the tree view renders.
      const roots = buildTree(activeItemsRef.current ?? [])
      const nodeOf = new Map<string, TaskNode>()
      const parentOf = new Map<string, string>()
      const walk = (n: TaskNode, parent?: string) => {
        nodeOf.set(n.todo.uid, n)
        if (parent) parentOf.set(n.todo.uid, parent)
        for (const c of n.children) walk(c, n.todo.uid)
      }
      for (const r of roots) walk(r)

      // The items snapshot may still show `uid`'s pre-completion status,
      // and a graced sibling/ancestor is already on its way out — both
      // count as done for the "is this subtree finished?" test.
      const graced = recentlyCompletedRef.current
      const isDone = (id: string): boolean =>
        id === uid ||
        graced.has(id) ||
        nodeOf.get(id)?.todo.status === 'COMPLETED'
      const allDoneCache = new Map<string, boolean>()
      const allDone = (n: TaskNode): boolean => {
        const cached = allDoneCache.get(n.todo.uid)
        if (cached != null) return cached
        let ok = isDone(n.todo.uid)
        for (const c of n.children) if (!allDone(c)) ok = false
        allDoneCache.set(n.todo.uid, ok)
        return ok
      }

      const node = nodeOf.get(uid)
      // Still has an open descendant → not leaving the list, so no fade.
      if (node && !allDone(node)) return
      // Inside a revealed branch → pinned visible by the peek; no fade
      // until the user collapses the reveal.
      for (let a = parentOf.get(uid); a; a = parentOf.get(a)) {
        if (revealedBranchesRef.current.has(a)) return
      }

      const now = Date.now()
      const next = new Map(graced)
      const rescheduled: Array<{ uid: string; fadeStartsAt: number }> = []
      const fadeStartOf = (id: string): number | undefined => {
        const exp = next.get(id)
        return exp == null ? undefined : exp - FADE_MS
      }
      const place = (id: string, fadeStartsAt: number) => {
        next.set(id, fadeStartsAt + FADE_MS)
        rescheduled.push({ uid: id, fadeStartsAt })
      }

      // The just-completed node trails its latest still-fading child.
      let latestChild = -Infinity
      for (const c of node?.children ?? []) {
        const fs = fadeStartOf(c.todo.uid)
        if (fs != null) latestChild = Math.max(latestChild, fs)
      }
      let cursorStart = Math.max(
        now + HIDE_GRACE_MS,
        latestChild + CASCADE_STEP_MS,
      )
      place(uid, cursorStart)

      // Pull each completed ancestor whose whole subtree is now finished
      // into the cascade, trailing the level below it. Stop at the first
      // ancestor that's still open or still has an unfinished branch.
      let cursor = uid
      const seen = new Set<string>([uid])
      for (;;) {
        const par = parentOf.get(cursor)
        if (!par || seen.has(par)) break
        seen.add(par)
        const parNode = nodeOf.get(par)
        if (!parNode || !isDone(par) || !allDone(parNode)) break
        const required = cursorStart + CASCADE_STEP_MS
        const parFadeStart = fadeStartOf(par)
        if (parFadeStart != null && parFadeStart >= required) break
        place(par, required)
        cursorStart = required
        cursor = par
      }

      recentlyCompletedRef.current = next
      setRecentlyCompleted(next)
      for (const { uid: id, fadeStartsAt } of rescheduled) {
        armCompletionTimers(
          id,
          fadeStartsAt - now,
          fadeStartsAt + FADE_MS - now,
        )
      }
      // A branch that's now cascading out has been "consumed" — drop its
      // reveal so it can actually leave (a revealed branch is pinned).
      setRevealedBranches((prev) => {
        let changed = false
        const nextR = new Set(prev)
        for (const { uid: id } of rescheduled) {
          if (nextR.delete(id)) changed = true
        }
        return changed ? nextR : prev
      })
    },
    [armCompletionTimers],
  )

  const clearRecentlyCompleted = useCallback((uid: string) => {
    // Un-completing a task un-finishes its subtree: cancel its own fade
    // plus every ancestor that was cascading out on the assumption the
    // branch was done, so none of them fade-and-pop back into view.
    const roots = buildTree(activeItemsRef.current ?? [])
    const parentOf = new Map<string, string>()
    const walk = (n: TaskNode, parent?: string) => {
      if (parent) parentOf.set(n.todo.uid, parent)
      for (const c of n.children) walk(c, n.todo.uid)
    }
    for (const r of roots) walk(r)

    const sched = recentlyCompletedRef.current
    const victims = new Set<string>([uid])
    let cur = uid
    for (;;) {
      const par = parentOf.get(cur)
      if (!par || victims.has(par) || !sched.has(par)) break
      victims.add(par)
      cur = par
    }

    for (const v of victims) {
      const existing = completionTimers.current.get(v)
      if (existing) {
        clearTimeout(existing.fade)
        clearTimeout(existing.remove)
        completionTimers.current.delete(v)
      }
    }
    setRecentlyCompleted((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const v of victims) if (next.delete(v)) changed = true
      if (!changed) return prev
      recentlyCompletedRef.current = next
      return next
    })
    setFadingUids((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const v of victims) if (next.delete(v)) changed = true
      return changed ? next : prev
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
        syncedAtRef.current.set(uid, Date.now())
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
        setOffline(false)
        void saveCollectionsList(cs)
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
        // Network/server failure: fall back to the cached list so the
        // app is still usable offline. Do NOT prune snapshots here — we
        // have no authoritative server list to prune against.
        void loadCollectionsList().then((cached) => {
          if (cancelledRef.current) return
          setOffline(true)
          if (cached && cached.length > 0) {
            setCollections((cur) => cur ?? cached)
            setActiveUid((curr) =>
              curr && cached.some((c) => c.uid === curr)
                ? curr
                : sortCollections(
                    cached,
                    sidebarSortRef.current,
                    itemsByUidRef.current,
                  )[0]?.uid,
            )
          }
        })
      })
  }, [showDeletedLists, collectionsRefreshKey])

  const toggleShowDeletedLists = useCallback(() => {
    setShowDeletedListsState((cur) => {
      const next = !cur
      writeShowDeletedLists(next)
      return next
    })
  }, [])

  // Switching to a list kicks a BACKGROUND sync only if we have nothing
  // cached (initial load) or it hasn't been synced within the freshness
  // window. Otherwise show the cache and wait for Refresh / Sync-all.
  // No AbortController: an in-flight sync keeps running when you switch
  // away (aborts only on unmount via cancelledRef); fetchCollection's
  // inFlightRef dedupe means switching back never restarts it.
  useEffect(() => {
    if (!hydrated || !activeUid) return
    const last = syncedAtRef.current.get(activeUid)
    const freshMs = switchFreshMin * 60_000
    const needInitial = !loadedUids.has(activeUid)
    const stale = last === undefined || Date.now() - last >= freshMs
    if (needInitial || stale) {
      void fetchCollection(activeUid)
    }
    // loadedUids intentionally omitted: only react to a real list
    // switch, not to a background sync flipping it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUid, hydrated, fetchCollection, switchFreshMin])

  // Periodic background refresh of the ACTIVE list while it's open
  // (fast cadence). Disabled when 0 ("manual").
  useEffect(() => {
    if (!hydrated || !activeUid || activeSyncMin <= 0) return
    const ms = activeSyncMin * 60_000
    const id = setInterval(() => {
      const last = syncedAtRef.current.get(activeUid)
      if (last === undefined || Date.now() - last >= ms) {
        void fetchCollection(activeUid)
      }
    }, ms)
    return () => clearInterval(id)
  }, [activeUid, hydrated, fetchCollection, activeSyncMin])

  // Periodic background refresh of OTHER lists (slow cadence) so they
  // don't drift far. Skips the active list (it has its own faster
  // timer) and anything synced within the window. Disabled when 0.
  useEffect(() => {
    if (!hydrated || bgSyncMin <= 0 || !collections) return
    const ms = bgSyncMin * 60_000
    const tick = () => {
      for (const c of collections) {
        if (c.uid === activeUid) continue
        const last = syncedAtRef.current.get(c.uid)
        if (last === undefined || Date.now() - last >= ms) {
          void fetchCollection(c.uid)
        }
      }
    }
    const id = setInterval(tick, ms)
    return () => clearInterval(id)
  }, [hydrated, bgSyncMin, collections, activeUid, fetchCollection])

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

  // Keep the cascade's link source pointed at the live active list.
  useEffect(() => {
    activeItemsRef.current = activeItems
  }, [activeItems])

  // Per-branch reveals are a transient peek — drop them on a list switch
  // or when Hide-done is turned off (nothing to reveal then).
  useEffect(() => {
    setRevealedBranches((prev) => (prev.size === 0 ? prev : new Set()))
  }, [activeUid, filter.hideCompleted])

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
        revealedBranches: filter.hideCompleted ? revealedBranches : undefined,
      }),
    [fullTree, filter, recentlyCompletedKeys, revealedBranches],
  )

  // uid → count of completed descendants currently hidden by Hide-done.
  // Drives the per-row "show completed subtasks" control; empty (so no
  // controls) when Hide-done is off.
  const branchDoneHidden = useMemo(() => {
    if (!filter.hideCompleted) return EMPTY_DONE_COUNTS
    const visibleUids = new Set<string>()
    const collectVisible = (n: TaskNode) => {
      visibleUids.add(n.todo.uid)
      n.children.forEach(collectVisible)
    }
    visibleTree.forEach(collectVisible)
    const counts = new Map<string, number>()
    const count = (n: TaskNode): number => {
      let hidden = 0
      for (const c of n.children) {
        hidden += count(c)
        if (c.todo.status === 'COMPLETED' && !visibleUids.has(c.todo.uid)) {
          hidden += 1
        }
      }
      counts.set(n.todo.uid, hidden)
      return hidden
    }
    fullTree.forEach(count)
    return counts
  }, [filter.hideCompleted, fullTree, visibleTree])

  // Revealed set as the tree view sees it — empty while Hide-done is off
  // so stale reveals don't surface a control with nothing to reveal.
  const revealedForView = useMemo(
    () => (filter.hideCompleted ? revealedBranches : EMPTY_REVEALED),
    [filter.hideCompleted, revealedBranches],
  )

  const handleToggleBranchReveal = useCallback((uid: string) => {
    setRevealedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

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
  // Rows mid fade-out — only visually fades while Hide-done is on.
  const fadingActiveUids = useMemo(
    () => (filter.hideCompleted ? fadingUids : EMPTY_FADING),
    [filter.hideCompleted, fadingUids],
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

  // Root tasks are added via the always-present quick-add row; `n` (and
  // the old "start create root" entry point) just focuses it.
  const handleStartCreateRoot = useCallback(() => {
    flushActiveCreate()
    setFocusZone('tasks')
    requestAnimationFrame(() => quickAddRef.current?.focus())
  }, [flushActiveCreate])

  // Prev/next visible task — used by the detail panel to scroll through
  // items without leaving the detail view. Reads the rendered tree rows
  // so the order matches exactly what the user sees (including expanded
  // subtasks and the current sort/filter), without lifting tree state.
  const navigateTask = useCallback(
    (delta: -1 | 1) => {
      if (!selectedTaskUid) return
      const uids = Array.from(
        document.querySelectorAll<HTMLElement>('[data-task-uid]'),
      )
        .map((n) => n.dataset.taskUid)
        .filter((u): u is string => !!u)
      const i = uids.indexOf(selectedTaskUid)
      if (i < 0) return
      const j = Math.max(0, Math.min(uids.length - 1, i + delta))
      const next = uids[j]
      if (next && next !== selectedTaskUid) setSelectedTaskUid(next)
    },
    [selectedTaskUid],
  )

  const handleQuickAddRoot = useCallback(
    async (summary: string) => {
      if (!activeUid) return
      const trimmed = summary.trim()
      if (!trimmed) return
      const colUid = activeUid
      try {
        const newItem = await createTask(colUid, trimmed, undefined)
        if (cancelledRef.current) return
        setItemsByUid((prev) => {
          const items = prev.get(colUid) ?? []
          const next = new Map(prev)
          next.set(colUid, [...items, newItem])
          return next
        })
        setSelectedTaskUid(newItem.todo.uid)
      } catch (err) {
        if (cancelledRef.current) return
        setMutationError(
          err instanceof Error ? err.message : 'Failed to create task',
        )
      }
    },
    [activeUid],
  )

  const handleQuickAddRootAndOpen = useCallback(
    async (summary: string) => {
      await handleQuickAddRoot(summary)
      if (cancelledRef.current) return
      setFocusZone('details')
    },
    [handleQuickAddRoot],
  )

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

  // Per-collection cursor memory. When the user switches lists, restore
  // the last task they had selected in the new list; while they're
  // working in a list, mirror every selection change into the persisted
  // map so the next switch can recall it.
  const prevActiveUidRef = useRef<string | null>(m0.activeUid)
  useEffect(() => {
    if (!activeUid) return
    if (prevActiveUidRef.current === activeUid) return
    prevActiveUidRef.current = activeUid
    const saved = getTaskMemory().lastSelectedByCollection.get(activeUid)
    if (saved) setSelectedTaskUid(saved)
  }, [activeUid])
  useEffect(() => {
    if (!activeUid) return
    if (prevActiveUidRef.current !== activeUid) return
    if (!selectedTaskUid) return
    rememberLastSelected(activeUid, selectedTaskUid)
  }, [activeUid, selectedTaskUid])

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

  // Global keybindings. All command shortcuts are Ctrl/Cmd-prefixed so bare
  // letters can stay reserved for typeahead in the sidebar / task list:
  //   Ctrl+L / Ctrl+T / Ctrl+E zone switches, Ctrl+N new, Ctrl+M move,
  //   Ctrl+S sort, Ctrl+F filter, Ctrl+Enter / Ctrl+→ open details,
  //   Ctrl +/-/0 zoom, Ctrl+←/→ meta-nav. Bare keys here are arrow
  //   navigation, F2/Delete in the sidebar, and `?` for the help modal.
  // Skipped while a modal is open; typeahead handlers are gated separately.
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

      // Ctrl/Cmd+L → focus the sidebar (list of task lists). Honored
      // even from inside text inputs so it works as a universal
      // "jump to lists" shortcut.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setFocusZone('sidebar')
        return
      }
      // Ctrl/Cmd+T → focus the task pane.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === 't' || e.key === 'T')
      ) {
        e.preventDefault()
        focusTasks()
        return
      }
      // Ctrl/Cmd+E → open the detail panel for the selected task.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        if (!selectedTaskUid) return
        e.preventDefault()
        setFocusZone('details')
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

      // Ctrl/Cmd+Shift+S → force a sync-all (every list refreshes now,
      // bypassing the staleness windows). The per-row spinners and the
      // sidebar's sync-all spinner light up the same way as the toolbar
      // button. Handled before the bare Ctrl+S so the Shift variant
      // doesn't fall through to the sort popover.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 's' || e.key === 'S')
      ) {
        e.preventDefault()
        syncAll()
        return
      }

      // Ctrl/Cmd+S → jump to the sorting menu (overrides browser Save).
      // In the list view that's the sidebar list-settings popover (sort
      // lists / show deleted); elsewhere it's the task sort popover.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === 's' || e.key === 'S')
      ) {
        e.preventDefault()
        if (focusZone === 'sidebar') {
          setSidebarSettingsOpen(true)
        } else if (activeUid) {
          setFocusZone('tasks')
          setSortOpen(true)
          setSortFocusKey((k) => k + 1)
        }
        return
      }

      // Ctrl/Cmd+N → focus the quick-add row (plain `n` is task-view
      // typeahead now).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        if (!activeUid || !activeItems) return
        e.preventDefault()
        setFocusZone('tasks')
        handleStartCreateRoot()
        return
      }

      // Ctrl/Cmd+M → move the selected task, staying on the source list
      //   (the "get this off my plate" path — the common case).
      // Ctrl/Cmd+Shift+M → move AND follow the task to the destination
      //   list so the user can keep working on it where it landed.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
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
          follow: e.shiftKey,
        })
        return
      }

      // Alt+arrow on the selected task: pure parentUid edits that reuse
      // handleSaveDetails's optimistic + rollback path. Sibling reorder
      // is still deferred (needs the per-list manual-order store), so
      // Alt+↑/↓ here is a *reparent*, not a swap.
      //   Alt+←  outdent — become a sibling of the current parent
      //   Alt+→  indent  — become a child of the previous visible sibling
      //   Alt+↑  reparent — become a child of the parent's previous sibling
      //   Alt+↓  reparent — become a child of the parent's next sibling
      // Scoped to the tasks zone and skipped inside text fields so native
      // Alt+arrow word-jump still works in renames / detail inputs.
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        focusZone === 'tasks' &&
        !inTextField &&
        selectedTaskUid &&
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown')
      ) {
        const loc = findParentAndSiblings(visibleTree, selectedTaskUid)
        if (!loc) return
        const save = handleSaveDetailsRef.current
        if (!save) return
        if (e.key === 'ArrowLeft') {
          // Outdent: become a sibling of the current parent. No-op when
          // already at the root.
          if (!loc.parent) return
          e.preventDefault()
          const grand = findParentAndSiblings(visibleTree, loc.parent.todo.uid)
          const newParentUid: string | null = grand?.parent?.todo.uid ?? null
          void save({ parentUid: newParentUid })
        } else if (e.key === 'ArrowRight') {
          // Indent: become a child of the previous visible sibling. No-op
          // for the first sibling (nothing to slot under).
          if (loc.index === 0) return
          e.preventDefault()
          const prev = loc.siblings[loc.index - 1]
          void save({ parentUid: prev.todo.uid })
        } else {
          // Alt+↑/↓: step the *parent reference* one position through the
          // parent's siblings — same depth, new branch. Under priority
          // sort, position within the destination is decided by sort, not
          // by us: we change the hierarchy only, not the sort key. No-op
          // for a root (no parent to step) and when the current parent is
          // already at the relevant end of its sibling row.
          if (!loc.parent) return
          const parentLoc = findParentAndSiblings(
            visibleTree,
            loc.parent.todo.uid,
          )
          if (!parentLoc) return
          const targetIdx =
            e.key === 'ArrowUp' ? parentLoc.index - 1 : parentLoc.index + 1
          if (targetIdx < 0 || targetIdx >= parentLoc.siblings.length) return
          e.preventDefault()
          const newParent = parentLoc.siblings[targetIdx]
          void save({ parentUid: newParent.todo.uid })
        }
        return
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return

      if (e.metaKey || e.ctrlKey || e.altKey) return

      // In the task view, plain letters are typeahead through the
      // visible task rows (matches the sidebar's list typeahead). Digits
      // are left alone so TaskTree's 0–9 priority hotkeys still work.
      // Every action shortcut is Ctrl-prefixed so bare letters never
      // double as commands here.
      if (focusZone === 'tasks' && /^[a-z]$/i.test(e.key)) {
        e.preventDefault()
        const ch = e.key.toLowerCase()
        const now = Date.now()
        const st = taskTypeaheadRef.current
        let buf: string
        if (now - st.time > 800) buf = ch
        else if (st.buf.length === 1 && st.buf === ch) buf = ch
        else buf = st.buf + ch
        taskTypeaheadRef.current = { buf, time: now }
        // Read the rendered rows so the order tracks what the user sees
        // (current sort/filter + any expanded subtree).
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>('[data-task-uid]'),
        )
        const summaries = new Map<string, string>()
        for (const it of activeItems ?? []) {
          summaries.set(it.todo.uid, (it.todo.summary || '').toLowerCase())
        }
        const ordered = rows
          .map((el) => el.dataset.taskUid)
          .filter((u): u is string => !!u)
          .map((uid) => ({ uid, sum: summaries.get(uid) ?? '' }))
        const matches = ordered.filter((o) => o.sum.startsWith(buf))
        if (matches.length > 0) {
          let pick = matches[0]
          if (buf.length === 1) {
            const ci = matches.findIndex((m) => m.uid === selectedTaskUid)
            if (ci >= 0) pick = matches[(ci + 1) % matches.length]
          }
          setSelectedTaskUid(pick.uid)
        }
        return
      }
      // In the list (sidebar) view, plain letters/digits are a
      // type-to-search, not shortcuts. Repeating the same single char
      // cycles through matches. Every command shortcut is Ctrl-prefixed
      // and handled above, so nothing competes with typeahead here.
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

      // Sidebar list management. (List creation is the header "+" button;
      // plain letters are type-to-search, handled above.) Command shortcuts
      // (new / move / sort / filter / focus zones / details) are all
      // Ctrl-prefixed and handled at the top of this effect — bare letters
      // are reserved for typeahead.
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
    syncAll,
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
          // in-memory list so the user sees them on switch (whether or
          // not we follow now — the destination is pre-warmed either way).
          setItemsByUid((prev) => {
            const existing = prev.get(destUid) ?? []
            const byId = new Map(existing.map((t) => [t.itemUid, t]))
            for (const t of created) byId.set(t.itemUid, t)
            const next = new Map(prev)
            next.set(destUid, Array.from(byId.values()))
            return next
          })
          if (cur.follow) {
            // Follow the task: switch to the destination list and
            // re-select it by its preserved VTODO uid.
            setActiveUid(destUid)
            setSelectedTaskUid(cur.rootVtodoUid)
          } else {
            // Stay on the source. The moved row is gone from the source's
            // visible items, so clear selection rather than leaving a
            // dangling uid that arrow-nav would have to recover from.
            setSelectedTaskUid(null)
          }
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
      // Drag-to-list keeps the legacy follow behaviour — the drop's
      // destination is the user's pointer goal, so jumping there is what
      // they asked for. (Keyboard Ctrl+M is the "stay" path.)
      void performMove(
        {
          itemUids,
          rootVtodoUid: node.todo.uid,
          summary: node.todo.summary,
          descendantCount: itemUids.length - 1,
          follow: true,
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
      // Right-click "Move" defaults to stay-on-source (the common case);
      // Ctrl+Shift+M is the path to also follow the task to its new list.
      setMoving({
        itemUids,
        rootVtodoUid: node.todo.uid,
        summary: node.todo.summary,
        descendantCount: itemUids.length - 1,
        follow: false,
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

  // Keep handleSaveDetailsRef pointing at the latest closure so the
  // forward-call from the keybindings effect (Alt+←/→ indent/outdent)
  // sees current state.
  useEffect(() => {
    handleSaveDetailsRef.current = handleSaveDetails
  }, [handleSaveDetails])

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
        onMouseDown={() => {
          // Click anywhere in the list pane focuses it — important when
          // there are no list rows to click (e.g. a load error shows an
          // empty sidebar).
          if (focusZone !== 'sidebar') setFocusZone('sidebar')
        }}
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
                      title="Focus the list selection (Ctrl+L)"
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
                        title="New list"
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
                        ref={sidebarSettingsBtnRef}
                        type="button"
                        onClick={() =>
                          setSidebarSettingsOpen((o) => !o)
                        }
                        aria-expanded={sidebarSettingsOpen}
                        aria-label="List settings"
                        title="List settings (sort, show deleted)"
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
                          <circle cx="8" cy="8" r="2" />
                          <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
                        </svg>
                      </button>
                      {sidebarSettingsOpen && (
                        <SidebarSettingsPopover
                          sortOptions={SIDEBAR_SORT_OPTIONS}
                          sortValue={sidebarSort.sort}
                          reverse={sidebarSort.reverse}
                          onSort={(v) =>
                            setSidebarSort({
                              sort: v as SidebarSort,
                              reverse: sidebarSort.reverse,
                            })
                          }
                          onToggleReverse={() =>
                            setSidebarSort({
                              sort: sidebarSort.sort,
                              reverse: !sidebarSort.reverse,
                            })
                          }
                          showDeleted={showDeletedLists}
                          onToggleShowDeleted={toggleShowDeletedLists}
                          onClose={() => setSidebarSettingsOpen(false)}
                          anchorRef={sidebarSettingsBtnRef}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFocusZone('sidebar')}
                    title="Focus the list selection (Ctrl+L)"
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
                      onDragLeave={(e) => {
                        // dragleave also fires when the pointer crosses
                        // onto a child element (the colour dot / label);
                        // ignore those so the highlight doesn't flicker.
                        if (
                          e.currentTarget.contains(
                            e.relatedTarget as Node | null,
                          )
                        )
                          return
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
                      className={`group flex w-full items-center gap-2 rounded-md py-1.5 text-left text-sm transition-colors ${
                        showFull ? 'px-2 justify-start' : 'px-1 justify-center'
                      } ${
                        isActive
                          ? sidebarHot
                            ? 'bg-accent-soft text-text ring-1 ring-accent/40'
                            : 'bg-accent-soft text-text'
                          : 'text-text-muted hover:bg-surface-2 hover:text-text'
                      } ${deleted ? 'opacity-50' : ''} ${
                        dragOverListUid === c.uid
                          ? 'bg-accent-soft text-text ring-2 ring-accent ring-inset'
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
                      {listSyncing ? (
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
                      ) : (
                        showFull &&
                        !isPlaceholder &&
                        !deleted && (
                          <span
                            role="button"
                            tabIndex={-1}
                            aria-label={`Sync ${c.name}`}
                            title="Sync this list"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              void fetchCollection(c.uid)
                            }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
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
                              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                              <path d="M13.5 2.5v3h-3" />
                            </svg>
                          </span>
                        )
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
          className="group absolute inset-y-0 right-0 z-10 w-2.5 cursor-ew-resize"
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
          const t = e.target as HTMLElement
          // ignore clicks in modals and in the detail panel
          if (
            t.closest('[role="dialog"]') ||
            t.closest('[data-detail-zone]')
          )
            return
          if (focusZone !== 'tasks') setFocusZone('tasks')
          // Clicking empty space (not a task row) seeds the selection on
          // the first task so arrow keys work immediately — no need to
          // press Down first. An existing valid selection is kept.
          if (!t.closest('[data-task-uid]')) {
            setSelectedTaskUid((cur) =>
              cur && findNodeByUid(visibleTree, cur)
                ? cur
                : (visibleTree[0]?.todo.uid ?? cur),
            )
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                aria-expanded={filterOpen}
                aria-pressed={isFilterActive(filter)}
                title="Filter (Ctrl+F)"
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                aria-expanded={settingsOpen}
                aria-label="Settings"
                title="Settings"
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
                  <circle cx="8" cy="8" r="2.25" />
                  <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
                </svg>
              </button>
              {settingsOpen && (
                <SettingsPopover
                  hideCompleted={filter.hideCompleted}
                  onToggleHideCompleted={() =>
                    setFilter({
                      ...filter,
                      hideCompleted: !filter.hideCompleted,
                    })
                  }
                  phonePriority={phonePriority}
                  onTogglePhonePriority={togglePhonePriority}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  accent={accent}
                  accentPresets={ACCENT_PRESETS}
                  onSetAccent={setAccent}
                  sidebarZoomPct={Math.round(zoom.sidebar * 100)}
                  onSidebarZoom={(d) => adjustZoom('sidebar', d)}
                  taskZoomPct={Math.round(zoom.tasks * 100)}
                  onZoom={(d) => adjustZoom('tasks', d)}
                  detailZoomPct={Math.round(zoom.details * 100)}
                  onDetailZoom={(d) => adjustZoom('details', d)}
                  activeSyncMin={activeSyncMin}
                  activeSyncOptions={ACTIVE_SYNC_OPTIONS}
                  onSetActiveSync={setActiveSyncMin}
                  bgSyncMin={bgSyncMin}
                  bgSyncOptions={BG_SYNC_OPTIONS}
                  onSetBgSync={setBgSyncMin}
                  switchFreshMin={switchFreshMin}
                  switchFreshOptions={SWITCH_FRESH_OPTIONS}
                  onSetSwitchFresh={setSwitchFreshMin}
                  onLogout={handleLogout}
                  onClose={() => setSettingsOpen(false)}
                />
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
          {activeItems && (
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
              onQuickAdd={handleQuickAddRoot}
              onQuickAddAndOpen={handleQuickAddRootAndOpen}
              quickAddRef={quickAddRef}
              onRenameTask={handleRenameTask}
              onDeleteRequest={handleDeleteRequest}
              onChangePriority={handleChangePriority}
              onRowContextMenu={openTaskMenu}
              taskDndMime={TASK_DND_MIME}
              onLeaveLeft={() => setFocusZone('sidebar')}
              fadingExpires={fadingExpires}
              activelyFading={fadingActiveUids}
              branchDoneHidden={branchDoneHidden}
              revealedBranches={revealedForView}
              onToggleBranchReveal={handleToggleBranchReveal}
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
            <div className="px-5 py-4">
              <p className="text-sm text-text-faint">
                {activeLoading
                  ? 'Loading tasks…'
                  : isFilterActive(filter) && fullTree.length > 0
                    ? 'No tasks match the current filter.'
                    : 'No tasks in this list.'}
              </p>
              {!activeLoading && fullTree.length === 0 && (
                <Hint id="tasks.empty-list" variant="card" className="mt-3">
                  Press <kbd className="font-mono">Ctrl</kbd>+
                  <kbd className="font-mono">N</kbd> to add a task ·{' '}
                  <kbd className="font-mono">?</kbd> for all shortcuts.
                </Hint>
              )}
            </div>
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
        onNavigateTask={navigateTask}
        focusedWidth={detailFocusedWidth}
        onResizeStart={handleDetailResizeStart}
        isResizing={isResizingDetail}
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
      {offline && (
        <div
          role="alert"
          className="fixed left-1/2 top-0 z-50 flex -translate-x-1/2 items-center gap-3 rounded-b-md border border-t-0 border-danger/50 bg-danger px-4 py-1.5 text-xs font-medium text-bg shadow-lg"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1.5 5.5a9 9 0 0 1 13 0M4 8.5a5.5 5.5 0 0 1 8 0M8 11.5h.01" />
            <path d="M2 14L14 2" />
          </svg>
          <span>
            Offline — can't reach the server. Showing cached data;
            changes won't sync until reconnected.
          </span>
          <button
            type="button"
            onClick={() => setCollectionsRefreshKey((k) => k + 1)}
            className="shrink-0 rounded border border-bg/40 px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
