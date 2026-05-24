import type { CalView } from './caldate'
import type { CalTask } from './caltasks'
import type { CollectionInfo, EventItem } from '../types'

// Process-lifetime in-memory cache of the calendar module's state. Survives
// CalendarView unmount/remount (switching modules) so returning to the
// calendar is instant — no spinner, no refetch. Disk snapshots
// (calsnapshot.ts) cover a cold app start; this covers warm navigation.
//
// Deliberately not reactive: CalendarView owns the React state and mirrors
// it here on change, then re-seeds from here on mount.

export interface CalMemory {
  calendars: CollectionInfo[] | null
  eventsByCal: Map<string, EventItem[]>
  stokenByCal: Map<string, string>
  // Last successful sync timestamp per calendar uid. Lets the global
  // sync-status indicator read calendar freshness without re-mounting
  // CalendarView. Populated from the disk snapshot's lastSyncedAt on
  // load and bumped on every successful sync.
  lastSyncedAt: Map<string, number>
  hidden: Set<string>
  view: CalView
  anchorMs: number
  // Tasks-with-due-dates overlay (U1).
  tasks: CalTask[]
  showTasks: boolean
  // True once a network sync has completed at least once this session, so
  // remounts can skip straight to a background delta sync.
  warmed: boolean
}

const mem: CalMemory = {
  calendars: null,
  eventsByCal: new Map(),
  stokenByCal: new Map(),
  lastSyncedAt: new Map(),
  hidden: new Set(),
  view: 'month',
  anchorMs: Date.now(),
  tasks: [],
  showTasks: true,
  warmed: false,
}

export function getCalMemory(): CalMemory {
  return mem
}

export function patchCalMemory(patch: Partial<CalMemory>): void {
  Object.assign(mem, patch)
}

// Wipe on logout (called from etebase.logout via clearAllCalSnapshots'
// neighbour). Keeps the singleton identity but empties it.
export function resetCalMemory(): void {
  mem.calendars = null
  mem.eventsByCal = new Map()
  mem.stokenByCal = new Map()
  mem.lastSyncedAt = new Map()
  mem.hidden = new Set()
  mem.view = 'month'
  mem.anchorMs = Date.now()
  mem.tasks = []
  mem.showTasks = true
  mem.warmed = false
}
