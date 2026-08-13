import type { CalView } from './caldate'
import type { CalTask } from './caltasks'
import type { CalBirthday } from './birthdays'
import type { IcsSubscription } from './icsSubscriptions'
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
  // Calendars the user has locked: events in them are read-only (no
  // create / edit / move / delete / import). Persisted to localStorage by
  // CalendarView; this mirror seeds warm remounts.
  lockedCals: Set<string>
  view: CalView
  anchorMs: number
  // Tasks-with-due-dates overlay (U1).
  tasks: CalTask[]
  showTasks: boolean
  // Contact birthdays overlay. Projected per-occurrence at render
  // time; the raw list lives here so module switches don't refetch.
  birthdays: CalBirthday[]
  showBirthdays: boolean
  // Categories the user has hidden from the birthdays overlay. The
  // BDAY_UNCATEGORISED sentinel hides contacts without any CATEGORIES.
  hiddenBdayCategories: Set<string>
  // ICS subscriptions (remote public calendars). The list itself is
  // persisted to localStorage by icsSubscriptions.ts; this cache
  // mirrors the parsed events so a module switch doesn't refetch.
  subscriptions: IcsSubscription[]
  eventsBySub: Map<string, EventItem[]>
  // Subscriptions the user has hidden in the sidebar (parallels
  // `hidden` for etebase calendars).
  hiddenSubs: Set<string>
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
  lockedCals: new Set(),
  view: 'month',
  anchorMs: Date.now(),
  tasks: [],
  showTasks: true,
  birthdays: [],
  showBirthdays: false,
  hiddenBdayCategories: new Set(),
  subscriptions: [],
  eventsBySub: new Map(),
  hiddenSubs: new Set(),
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
  mem.lockedCals = new Set()
  mem.view = 'month'
  mem.anchorMs = Date.now()
  mem.tasks = []
  mem.showTasks = true
  mem.birthdays = []
  mem.showBirthdays = false
  mem.hiddenBdayCategories = new Set()
  mem.subscriptions = []
  mem.eventsBySub = new Map()
  mem.hiddenSubs = new Set()
  mem.warmed = false
}
