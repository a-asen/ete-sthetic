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
  mem.warmed = false
  try {
    localStorage.removeItem(LAST_SELECTED_KEY)
  } catch {
    // best-effort; storage may be disabled
  }
}
