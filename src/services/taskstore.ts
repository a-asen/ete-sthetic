import type { CollectionInfo, TaskItem } from '../types'

// Process-lifetime in-memory cache of the task module's state. Survives
// MainView unmount/remount (switching to the calendar module) so coming
// back to tasks is instant — no spinner, no disk reread, no reparse of
// every VTODO. Disk snapshots (services/snapshots.ts) still cover a cold
// app start; this covers warm intra-session navigation between modules.
//
// Deliberately not reactive: MainView owns the React state and mirrors
// it here on change, then re-seeds from here on mount.

const LAST_SELECTED_KEY = 'ete-sthetic.tasks.lastSelected'
// Per-collection set of VTODO uids the user has collapsed. We persist
// the COMPLEMENT of the expanded set because the default is "all roots
// expanded" — storing collapsed uids means new tasks (never seen before)
// default to expanded, which matches the user's expectation. Survives
// module switches (TaskTree unmount/remount) and app restarts.
const COLLAPSED_KEY = 'ete-sthetic.tasks.collapsed'

function readLastSelected(): Map<string, string> {
  try {
    const raw = localStorage.getItem(LAST_SELECTED_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, string>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function writeLastSelected(map: Map<string, string>): void {
  try {
    localStorage.setItem(
      LAST_SELECTED_KEY,
      JSON.stringify(Object.fromEntries(map)),
    )
  } catch {
    // Quota or disabled storage — silently drop; the cache is best-effort.
  }
}

// Per-collection collapsed-uid sets, persisted as
// { collectionUid: [vtodoUid, ...], ... }.
function loadCollapsedMap(): Map<string, Set<string>> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, string[]>
    const out = new Map<string, Set<string>>()
    for (const [k, v] of Object.entries(obj)) {
      out.set(k, new Set(v))
    }
    return out
  } catch {
    return new Map()
  }
}

function writeCollapsedMap(map: Map<string, Set<string>>): void {
  try {
    const obj: Record<string, string[]> = {}
    for (const [k, v] of map) obj[k] = Array.from(v)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(obj))
  } catch {
    // Quota or disabled storage — silently drop; best-effort.
  }
}

export interface TaskMemory {
  collections: CollectionInfo[] | null
  itemsByUid: Map<string, TaskItem[]>
  stokenByUid: Map<string, string>
  loadedUids: Set<string>
  syncedAt: Map<string, number>
  activeUid: string | null
  selectedTaskUid: string | null
  // Per-collection last-selected task uid, persisted to localStorage so
  // switching away from a list and back returns the cursor to where the
  // user left it (rather than resetting to the first task).
  lastSelectedByCollection: Map<string, string>
  // Per-collection set of VTODO uids the user has collapsed. Persisted
  // to localStorage so module switches and app restarts preserve the
  // user's collapses — without this, switching to calendar and back
  // unmounts TaskTree and resets to "all roots expanded", wiping every
  // collapse. We store the complement (collapsed, not expanded) so
  // newly-created tasks default to expanded.
  collapsedByCollection: Map<string, Set<string>>
  // True once a session has populated this cache at least once — lets the
  // disk-hydration step skip itself on a warm re-mount.
  warmed: boolean
}

const mem: TaskMemory = {
  collections: null,
  itemsByUid: new Map(),
  stokenByUid: new Map(),
  loadedUids: new Set(),
  syncedAt: new Map(),
  activeUid: null,
  selectedTaskUid: null,
  lastSelectedByCollection: readLastSelected(),
  collapsedByCollection: loadCollapsedMap(),
  warmed: false,
}

// Save the per-collection selection map; updates the in-memory copy and
// flushes to localStorage. Pass `null` to forget a list entirely (e.g.
// after the list is deleted).
export function rememberLastSelected(
  collectionUid: string,
  taskUid: string | null,
): void {
  if (taskUid) mem.lastSelectedByCollection.set(collectionUid, taskUid)
  else mem.lastSelectedByCollection.delete(collectionUid)
  writeLastSelected(mem.lastSelectedByCollection)
}

// Read the per-collection collapsed-uid set. Returns an empty Set for
// collections the user has never collapsed anything in. TaskTree uses
// this to seed its `expanded` state on mount: a uid is expanded unless
// it's in this set (the complement of the default all-roots-expanded).
export function readCollapsed(collectionUid: string): Set<string> {
  return mem.collapsedByCollection.get(collectionUid) ?? new Set()
}

// Persist a per-collection collapsed-uid set. Pass the full new Set
// (TaskTree computes it from its `expanded` state and writes the
// complement). Pass `null` to forget a collection entirely (e.g. after
// the list is deleted).
export function rememberCollapsed(
  collectionUid: string,
  collapsed: Set<string> | null,
): void {
  if (collapsed && collapsed.size > 0) {
    mem.collapsedByCollection.set(collectionUid, collapsed)
  } else {
    mem.collapsedByCollection.delete(collectionUid)
  }
  writeCollapsedMap(mem.collapsedByCollection)
}

export function getTaskMemory(): TaskMemory {
  return mem
}

export function patchTaskMemory(patch: Partial<TaskMemory>): void {
  Object.assign(mem, patch)
}

// Wipe on logout. Keeps the singleton identity but empties it so the
// next account can't see the previous one's data.
export function resetTaskMemory(): void {
  mem.collections = null
  mem.itemsByUid = new Map()
  mem.stokenByUid = new Map()
  mem.loadedUids = new Set()
  mem.syncedAt = new Map()
  mem.activeUid = null
  mem.selectedTaskUid = null
  mem.lastSelectedByCollection = new Map()
  mem.collapsedByCollection = new Map()
  mem.warmed = false
  try {
    localStorage.removeItem(LAST_SELECTED_KEY)
    localStorage.removeItem(COLLAPSED_KEY)
  } catch {
    // best-effort; storage may be disabled
  }
}
