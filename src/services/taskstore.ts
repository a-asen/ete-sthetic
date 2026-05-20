import type { CollectionInfo, TaskItem } from '../types'

// Process-lifetime in-memory cache of the task module's state. Survives
// MainView unmount/remount (switching to the calendar module) so coming
// back to tasks is instant — no spinner, no disk reread, no reparse of
// every VTODO. Disk snapshots (services/snapshots.ts) still cover a cold
// app start; this covers warm intra-session navigation between modules.
//
// Deliberately not reactive: MainView owns the React state and mirrors
// it here on change, then re-seeds from here on mount.

export interface TaskMemory {
  collections: CollectionInfo[] | null
  itemsByUid: Map<string, TaskItem[]>
  stokenByUid: Map<string, string>
  loadedUids: Set<string>
  syncedAt: Map<string, number>
  activeUid: string | null
  selectedTaskUid: string | null
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
  warmed: false,
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
  mem.warmed = false
}
