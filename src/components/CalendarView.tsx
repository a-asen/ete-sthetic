import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EventConflictError,
  createCalendar,
  createEvent,
  createEventRaw,
  deleteCollection,
  deleteEvent,
  forceUpdateEvent,
  listCalendars,
  listEventItems,
  logout,
  moveEventToCollection,
  replaceEventRaw,
  toggleComplete,
  updateCollectionMeta,
  updateEvent,
} from '../services/etebase'
import { loadCalTasks, type CalTask } from '../services/caltasks'
import {
  bdayCategoriesIndex,
  isBdayVisible,
  loadCalBirthdays,
  type CalBirthday,
} from '../services/birthdays'
import {
  fetchIcsSubscription,
  listSubscriptions,
  suggestSubscriptionName,
  writeSubscriptions,
  type IcsSubscription,
} from '../services/icsSubscriptions'
import {
  clearSubSnapshot,
  loadSubSnapshot,
  saveSubSnapshot,
} from '../services/icsSubscriptionSnapshot'
import {
  fetchWeather,
  readWeatherCache,
  readWeatherLocation,
  readWeatherPastDays,
  readWeatherRefresh,
  readWeatherUnits,
  writeWeatherCache,
  writeWeatherLocation,
  writeWeatherPastDays,
  writeWeatherRefresh,
  writeWeatherUnits,
  type DailyForecast,
  type HourlyForecast,
  type WeatherLocation,
  type WeatherUnits,
} from '../services/weather'
import {
  addExdate,
  detachedEvent,
  newSeriesFrom,
  truncateUntil,
} from '../services/recurrence-edit'
import type { CollectionInfo, EventItem } from '../types'
import {
  parseVEvent,
  type NewVEventArgs,
  type VEventPatch,
} from '../services/vevent'
import {
  type CalView,
  addDays,
  bucketByDay,
  dayKey,
  monthGridDays,
  rangeTitle,
  startOfDay,
  stepAnchor,
  viewDayRange,
} from '../services/caldate'
import { loadCalSnapshot, saveCalSnapshot } from '../services/calsnapshot'
import { getCalMemory, patchCalMemory } from '../services/calstore'
import {
  logSyncFailure,
  registerSyncAllHandler,
  setModuleSyncing,
} from '../services/syncStatus'
import {
  isIcsFile,
  parseIcsCandidates,
  type IcsImportCandidate,
} from '../services/icsImport'
import { ImportIcsModal, type ImportPlanEntry } from './calendar/ImportIcsModal'
import { ConfirmModal } from './ConfirmModal'
import { PasteIcsModal } from './calendar/PasteIcsModal'
import {
  CONTACT_OPEN_EVENT,
  ICS_OPEN_EVENT,
  type ContactOpenDetail,
  type IcsOpenDetail,
} from '../App'
import { MonthGrid } from './calendar/MonthGrid'
import { TimeGrid } from './calendar/TimeGrid'
import { YearGrid } from './calendar/YearGrid'
import { CalendarSidebar } from './calendar/CalendarSidebar'
import { CalendarSettingsPopover } from './calendar/CalendarSettingsPopover'
import { EventComposer } from './calendar/EventComposer'
import { ConflictModal } from './calendar/ConflictModal'
import { EventPopover } from './calendar/EventPopover'
import { DayPopover } from './calendar/DayPopover'
import {
  RecurrenceScopeModal,
  type RecurScope,
} from './calendar/RecurrenceScopeModal'
import { expandEvents } from '../services/recurrence'
import { startAlarmScheduler } from '../services/alarms'
import { buildIcs, splitIcs } from '../services/ics'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

// Persisted calendar UI prefs (localStorage; survive restart).
const WEEKNUM_KEY = 'cal.weekNumbers'
const DEFAULT_CAL_KEY = 'cal.defaultCal'
const SIDEBAR_WIDTH_KEY = 'cal.sidebarWidth'
const MAIN_ZOOM_KEY = 'cal.mainZoom'
const SIDEBAR_ZOOM_KEY = 'cal.sidebarZoom'
const HOUR_PX_KEY = 'cal.hourPx'
const SHOW_TASKS_KEY = 'cal.showTasks'
const CAL_SORT_KEY = 'cal.sort'
const CAL_SORT_REV_KEY = 'cal.sortReverse'
// Adjustable visible-hours window. `cal.dayWindowOn` is the master toggle;
// when off the grid shows the full 00:00–24:00. The base window applies to
// every day unless `cal.weekendWindowOn` is set, in which case Sat–Sun use
// `cal.weekendWindow`.
const DAY_WINDOW_ON_KEY = 'cal.dayWindowOn'
const DAY_WINDOW_KEY = 'cal.dayWindow'
const WEEKEND_WINDOW_ON_KEY = 'cal.weekendWindowOn'
const WEEKEND_WINDOW_KEY = 'cal.weekendWindow'
const SHOW_BIRTHDAYS_KEY = 'cal.showBirthdays'
const HIDDEN_BDAY_CATS_KEY = 'cal.hiddenBdayCategories'
const LOCKED_CALS_KEY = 'cal.lockedCalendars'
const HIDDEN_CALS_KEY = 'cal.hiddenCalendars'
const SHOW_DELETED_CALS_KEY = 'cal.showDeleted'

// Visible-hours window: the grid shows [startH, endH]. `endH` may exceed 24
// to extend past midnight into the next day (eg {6, 26} = 06:00 → 02:00 next
// day); the extension amount is `endH - 24`. `startH` trims the morning.
interface DayWindow {
  startH: number
  endH: number
}
// 30 = 06:00 the next morning — the furthest the day-end may extend.
const MAX_END_H = 30
const DAY_WINDOW_DEFAULT: DayWindow = { startH: 0, endH: 24 }
const WEEKEND_WINDOW_DEFAULT: DayWindow = { startH: 0, endH: 27 }

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_DEFAULT_WIDTH = 240
const HOUR_PX_MIN = 28
const HOUR_PX_MAX = 96
const HOUR_PX_DEFAULT = 44
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.6
const ZOOM_DEFAULT = 1

// Turn a sync / load failure into a human-readable toast message. Etebase
// and the underlying fetch surface network failures as terse strings
// ("Network request failed", "Failed to fetch", …); we detect those and
// explain the situation rather than dumping the bare message, while still
// appending it so a non-network error stays diagnosable.
function describeCalError(e: unknown, action: string): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    /network|fetch|failed to fetch|load failed|econn|timeout|timed out|offline|dns|unreachable/i.test(
      msg,
    )
  ) {
    return `${action} failed — network error. Check your connection, then sync again.`
  }
  return `${action} failed: ${msg}`
}

// One line in the import details log — a human-readable record of what
// happened to each event as it was uploaded.
interface ImportLogEntry {
  summary: string
  when: string
  outcome: 'added' | 'updated' | 'failed'
  error?: string
}

interface ImportState {
  total: number
  done: number
  added: number
  updated: number
  failed: number
  log: ImportLogEntry[]
  expanded: boolean
  // running → user can cancel; finished/cancelled → user can close.
  status: 'running' | 'finished' | 'cancelled'
}

// Compact, readable "when" for an event in the import log.
function fmtImportWhen(start: Date | undefined, allDay: boolean): string {
  if (!start) return 'No date'
  if (allDay) {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  return start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    // Private mode / storage disabled — pref just won't persist.
  }
}
function readStr(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function writeStr(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    // Non-fatal — see writeBool.
  }
}

function readNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
  } catch {
    return fallback
  }
}
function writeNum(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    // not fatal
  }
}

function readWindow(key: string, fallback: DayWindow): DayWindow {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<DayWindow>
    const startH = Math.max(0, Math.min(23, Number(parsed.startH ?? 0)))
    const endH = Math.max(
      startH + 1,
      Math.min(MAX_END_H, Number(parsed.endH ?? 24)),
    )
    if (!Number.isFinite(startH) || !Number.isFinite(endH)) return fallback
    return { startH, endH }
  } catch {
    return fallback
  }
}
function writeWindow(key: string, v: DayWindow): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // not fatal
  }
}

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: '3day', label: '3 days' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

const ACCENT = 'var(--color-accent)'

interface CalendarViewProps {
  onLoggedOut: () => void
  // "Reveal this event" from the global meta-search: jump the view to its
  // date. Consumed once via onPendingOpenConsumed.
  pendingOpen?: { calUid: string; itemUid: string; startMs: number | null } | null
  onPendingOpenConsumed?: () => void
}

export function CalendarView({
  onLoggedOut,
  pendingOpen,
  onPendingOpenConsumed,
}: CalendarViewProps) {
  // Seed all state from the process-lifetime memory cache, so switching
  // back into the calendar is instant (no spinner, no refetch).
  const m0 = getCalMemory()
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(
    () => m0.calendars,
  )
  // Transient bottom toast for ICS import/export + sync feedback. Sync /
  // load failures (incl. network errors) surface here rather than as a
  // full-screen takeover — a flaky connection shouldn't blank the calendar
  // when we already have cached events to show.
  const [notice, setNotice] = useState<string | null>(null)
  // Sync / load failures (incl. network errors). Unlike `notice` this is a
  // persistent, dismissible red banner — a connection problem is worth
  // keeping on screen until the user acts, not flashing for 4s. Cleared
  // when a sync attempt starts or succeeds.
  const [syncError, setSyncError] = useState<string | null>(null)
  // Live state for an in-flight (or just-finished) ICS import. Drives the
  // bottom progress panel: a progress bar, a Cancel button, and an
  // expandable per-event log. Stays up after completion (with a Close
  // button) so the user can review the summary; null when idle.
  const [importState, setImportState] = useState<ImportState | null>(null)
  // Flipped true by the Cancel button; the import loops check it between
  // events and stop early. A ref (not state) so the running loop sees the
  // latest value without being re-created.
  const importCancelRef = useRef(false)
  const ioBusy = useRef(false)
  const [eventsByCal, setEventsByCal] = useState<Map<string, EventItem[]>>(
    () => new Map(m0.eventsByCal),
  )
  // Which calendars are toggled off in the sidebar. Persisted to
  // localStorage so the user's show/hide choices survive app restarts
  // (the warm in-memory cache covers module switches; this covers
  // open/close cycles). Seeded from the warm cache first, else disk.
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (m0.hidden.size > 0) return new Set(m0.hidden)
    try {
      const raw = localStorage.getItem(HIDDEN_CALS_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr)
        ? new Set(arr.filter((x): x is string => typeof x === 'string'))
        : new Set()
    } catch {
      return new Set()
    }
  })
  // Persist show/hide choices to disk on every change (toggleCal,
  // show-all, hide-all all flow through `hidden`). Covers app restarts;
  // the calMemory mirror below covers in-session module switches.
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_CALS_KEY, JSON.stringify([...hidden]))
    } catch {
      // Quota / disabled storage — choices just won't persist this session.
    }
  }, [hidden])
  // Locked calendars — events in them are read-only (no create / edit /
  // move / delete / import). Persisted to localStorage so a lock survives
  // restart; seeded from the warm in-memory mirror first.
  const [lockedCals, setLockedCals] = useState<Set<string>>(() => {
    if (m0.lockedCals.size > 0) return new Set(m0.lockedCals)
    try {
      const raw = localStorage.getItem(LOCKED_CALS_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr)
        ? new Set(arr.filter((x): x is string => typeof x === 'string'))
        : new Set()
    } catch {
      return new Set()
    }
  })
  const toggleLock = useCallback((uid: string) => {
    setLockedCals((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      try {
        localStorage.setItem(LOCKED_CALS_KEY, JSON.stringify([...next]))
      } catch {
        // Persistence is non-fatal — the lock still holds in-session.
      }
      patchCalMemory({ lockedCals: next })
      return next
    })
  }, [])
  const isCalLocked = useCallback(
    (uid: string) => lockedCals.has(uid),
    [lockedCals],
  )
  // Show server-side tombstones (calendars deleted in this or another
  // client) in the sidebar, badged and read-only. Mirrors the tasks
  // module's "show deleted lists". Persisted so it survives restart.
  const [showDeletedCals, setShowDeletedCals] = useState<boolean>(() =>
    readBool(SHOW_DELETED_CALS_KEY),
  )
  // Pending calendar-delete confirmation (uid + name for the modal copy).
  const [deletingCal, setDeletingCal] = useState<{
    uid: string
    name: string
  } | null>(null)
  const [loadingCount, setLoadingCount] = useState(0)
  const [view, setView] = useState<CalView>(() => m0.view)
  const [anchor, setAnchor] = useState<Date>(() => new Date(m0.anchorMs))
  const [tasks, setTasks] = useState<CalTask[]>(() => m0.tasks)
  const [showTasks, setShowTasks] = useState<boolean>(() => {
    const raw = localStorage.getItem(SHOW_TASKS_KEY)
    return raw == null ? m0.showTasks : raw === '1'
  })
  const toggleShowTasks = useCallback(() => {
    setShowTasks((v) => {
      writeBool(SHOW_TASKS_KEY, !v)
      return !v
    })
  }, [])
  // Birthdays overlay (fed from the contacts module's cache or, on a
  // cold first use, directly from etebase). Off by default — opt-in to
  // keep the calendar visually unchanged for users who don't want it.
  const [birthdays, setBirthdays] = useState<CalBirthday[]>(
    () => m0.birthdays,
  )
  const [showBirthdays, setShowBirthdays] = useState<boolean>(() => {
    const raw = localStorage.getItem(SHOW_BIRTHDAYS_KEY)
    return raw == null ? m0.showBirthdays : raw === '1'
  })
  const toggleShowBirthdays = useCallback(() => {
    setShowBirthdays((v) => {
      writeBool(SHOW_BIRTHDAYS_KEY, !v)
      return !v
    })
  }, [])
  const [hiddenBdayCategories, setHiddenBdayCategories] = useState<
    Set<string>
  >(() => {
    if (m0.hiddenBdayCategories.size > 0) {
      return new Set(m0.hiddenBdayCategories)
    }
    try {
      const raw = localStorage.getItem(HIDDEN_BDAY_CATS_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr)
        ? new Set(arr.filter((x): x is string => typeof x === 'string'))
        : new Set()
    } catch {
      return new Set()
    }
  })
  const toggleBdayCategory = useCallback((cat: string) => {
    setHiddenBdayCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      try {
        localStorage.setItem(
          HIDDEN_BDAY_CATS_KEY,
          JSON.stringify([...next]),
        )
      } catch {
        // Persistence is non-fatal — the toggle still works in-session.
      }
      patchCalMemory({ hiddenBdayCategories: next })
      return next
    })
  }, [])

  // ICS subscriptions — remote read-only feeds. List is persisted via
  // icsSubscriptions.ts; fetched events live in `eventsBySub` which
  // mirrors `eventsByCal`'s shape so the rest of the render path can
  // merge them with a single union.
  const [subscriptions, setSubscriptions] = useState<IcsSubscription[]>(
    () =>
      m0.subscriptions.length > 0 ? m0.subscriptions : listSubscriptions(),
  )
  const [eventsBySub, setEventsBySub] = useState<Map<string, EventItem[]>>(
    () => new Map(m0.eventsBySub),
  )
  const [hiddenSubs, setHiddenSubs] = useState<Set<string>>(
    () => new Set(m0.hiddenSubs),
  )
  const [syncingSubIds, setSyncingSubIds] = useState<Set<string>>(
    () => new Set(),
  )

  // Cold-cache hydration: when the warm CalMemory map is empty
  // (fresh module mount / app start), pull each subscription's
  // last-known events off disk so the grid paints immediately
  // instead of waiting for the first HTTP fetch. The periodic
  // refresh / on-mount network sync still runs alongside — the
  // snapshot is just the "show something useful right now" path.
  useEffect(() => {
    if (m0.eventsBySub.size > 0) return
    if (subscriptions.length === 0) return
    let cancelled = false
    void (async () => {
      const loaded: [string, EventItem[]][] = []
      for (const sub of subscriptions) {
        const snap = await loadSubSnapshot(sub.id)
        if (snap && snap.events.length > 0) {
          loaded.push([sub.id, snap.events])
        }
      }
      if (cancelled || loaded.length === 0) return
      setEventsBySub((prev) => {
        const next = new Map(prev)
        // Only fill in entries that aren't already populated — a
        // network fetch that landed before the snapshot read takes
        // precedence (fresher data).
        for (const [id, events] of loaded) {
          if (!next.has(id) || next.get(id)?.length === 0) {
            next.set(id, events)
          }
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply a partial update to one subscription and persist immediately
  // so a crash before the next render doesn't lose the change.
  const updateSubscription = useCallback(
    (id: string, patch: Partial<IcsSubscription>) => {
      setSubscriptions((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
        writeSubscriptions(next)
        return next
      })
    },
    [],
  )

  const fetchSubscription = useCallback(
    async (id: string) => {
      const sub = subscriptions.find((s) => s.id === id)
      if (!sub) return
      setSyncingSubIds((p) => {
        const n = new Set(p)
        n.add(id)
        return n
      })
      try {
        const result = await fetchIcsSubscription(sub.url, undefined, {
          etag: sub.etag ?? null,
          lastModified: sub.lastModified ?? null,
        })
        const now = Date.now()
        if (result.kind === 'not-modified') {
          // Server confirmed the cached copy is still current — keep
          // the existing events untouched and just bump the sync
          // timestamp + persist any refreshed validators.
          updateSubscription(id, {
            lastSyncedAt: now,
            lastError: null,
            etag: result.etag,
            lastModified: result.lastModified,
          })
        } else {
          setEventsBySub((prev) => {
            const next = new Map(prev)
            next.set(id, result.events)
            return next
          })
          updateSubscription(id, {
            lastSyncedAt: now,
            lastError: null,
            etag: result.etag,
            lastModified: result.lastModified,
          })
          // Persist for the next cold start. Fire-and-forget — a write
          // failure is non-fatal (in-memory cache still works), and we
          // don't want the spinner to wait on disk I/O.
          void saveSubSnapshot({
            version: 1,
            id,
            events: result.events,
            lastSyncedAt: now,
          })
        }
      } catch (e) {
        updateSubscription(id, {
          lastError: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setSyncingSubIds((p) => {
          const n = new Set(p)
          n.delete(id)
          return n
        })
      }
    },
    [subscriptions, updateSubscription],
  )

  const handleAddSubscription = useCallback(
    (url: string) => {
      const trimmed = url.trim()
      if (!trimmed) return
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `sub-${Date.now()}`
      const sub: IcsSubscription = {
        id,
        url: trimmed,
        name: suggestSubscriptionName(trimmed),
        color: '',
        refreshMinutes: 60,
        lastSyncedAt: null,
        lastError: null,
        etag: null,
        lastModified: null,
      }
      setSubscriptions((prev) => {
        const next = [...prev, sub]
        writeSubscriptions(next)
        return next
      })
      // Fire-and-forget — the row is added immediately so the user
      // sees feedback; fetchSubscription will mark the row syncing
      // and either populate events or surface the error badge.
      void (async () => {
        // Wait one tick so setSubscriptions lands before fetch reads
        // the list (fetchSubscription closes over `subscriptions`).
        await Promise.resolve()
        // Inline the fetch here — we can't call fetchSubscription
        // yet because its closure still has the pre-add list.
        setSyncingSubIds((p) => {
          const n = new Set(p)
          n.add(id)
          return n
        })
        try {
          const result = await fetchIcsSubscription(sub.url)
          const now = Date.now()
          // First-ever fetch — we have no prior validators, so the
          // server can only return 'fresh'. The narrowed branch isn't
          // exhaustive at the type level (the return is the union),
          // so guard explicitly.
          if (result.kind === 'fresh') {
            setEventsBySub((prev) => {
              const next = new Map(prev)
              next.set(id, result.events)
              return next
            })
            updateSubscription(id, {
              lastSyncedAt: now,
              lastError: null,
              etag: result.etag,
              lastModified: result.lastModified,
            })
            void saveSubSnapshot({
              version: 1,
              id,
              events: result.events,
              lastSyncedAt: now,
            })
          } else {
            updateSubscription(id, {
              lastSyncedAt: now,
              lastError: null,
              etag: result.etag,
              lastModified: result.lastModified,
            })
          }
        } catch (e) {
          updateSubscription(id, {
            lastError: e instanceof Error ? e.message : String(e),
          })
        } finally {
          setSyncingSubIds((p) => {
            const n = new Set(p)
            n.delete(id)
            return n
          })
        }
      })()
    },
    [updateSubscription],
  )

  const handleRemoveSubscription = useCallback((id: string) => {
    setSubscriptions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      writeSubscriptions(next)
      return next
    })
    setEventsBySub((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    // Wipe the on-disk cache so a re-add of the same URL (with a new
    // id) doesn't briefly paint old events. Fire-and-forget.
    void clearSubSnapshot(id)
    setHiddenSubs((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const handleRenameSubscription = useCallback(
    (id: string, name: string) => {
      updateSubscription(id, { name: name.trim() })
    },
    [updateSubscription],
  )

  const toggleSub = useCallback((id: string) => {
    setHiddenSubs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Weather overlay. Seeded from localStorage; the fetched forecast
  // and its source location/units live alongside in `weatherCache`
  // so a module switch (or app restart) shows the last forecast
  // immediately without waiting for a re-fetch.
  const [weatherLocation, setWeatherLocationState] =
    useState<WeatherLocation | null>(() => readWeatherLocation())
  const [weatherUnits, setWeatherUnitsState] = useState<WeatherUnits>(() =>
    readWeatherUnits(),
  )
  const [weatherRefreshMin, setWeatherRefreshMinState] = useState<number>(
    () => readWeatherRefresh(),
  )
  const [weatherPastDays, setWeatherPastDaysState] = useState<number>(() =>
    readWeatherPastDays(),
  )
  const initialCache = useMemo(() => readWeatherCache(), [])
  const [weatherDaily, setWeatherDaily] = useState<DailyForecast[]>(
    () => initialCache?.daily ?? [],
  )
  const [weatherHourly, setWeatherHourly] = useState<HourlyForecast[]>(
    () => initialCache?.hourly ?? [],
  )
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<number | null>(
    () => initialCache?.fetchedAt ?? null,
  )
  const [weatherSyncing, setWeatherSyncing] = useState(false)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const setWeatherLocation = useCallback((loc: WeatherLocation | null) => {
    setWeatherLocationState(loc)
    writeWeatherLocation(loc)
    if (loc === null) {
      // Drop the cached forecast — it was for the old location and
      // would surface confusing labels next render.
      setWeatherDaily([])
      setWeatherHourly([])
      setWeatherFetchedAt(null)
      writeWeatherCache(null)
    }
  }, [])
  const setWeatherUnits = useCallback((u: WeatherUnits) => {
    setWeatherUnitsState(u)
    writeWeatherUnits(u)
  }, [])
  const setWeatherRefreshMin = useCallback((min: number) => {
    setWeatherRefreshMinState(min)
    writeWeatherRefresh(min)
  }, [])
  const setWeatherPastDays = useCallback((days: number) => {
    setWeatherPastDaysState(days)
    writeWeatherPastDays(days)
  }, [])

  const refreshWeather = useCallback(async () => {
    if (!weatherLocation) return
    setWeatherSyncing(true)
    setWeatherError(null)
    try {
      const { daily, hourly } = await fetchWeather(
        weatherLocation,
        weatherUnits,
        undefined,
        weatherPastDays,
      )
      const now = Date.now()
      setWeatherDaily(daily)
      setWeatherHourly(hourly)
      setWeatherFetchedAt(now)
      writeWeatherCache({
        fetchedAt: now,
        location: weatherLocation,
        units: weatherUnits,
        pastDays: weatherPastDays,
        daily,
        hourly,
      })
    } catch (e) {
      setWeatherError(e instanceof Error ? e.message : String(e))
    } finally {
      setWeatherSyncing(false)
    }
  }, [weatherLocation, weatherUnits, weatherPastDays])

  // Re-fetch when location or units change, plus a periodic refresh
  // on the cadence the user picked. `refreshMinutes === 0` disables
  // the periodic tick (manual via the settings popover only).
  useEffect(() => {
    if (!weatherLocation) return
    // Only auto-fetch on (re)mount if the cached forecast is for a
    // different location/units or older than the refresh window. The
    // useMemo-seeded cache survives a module switch unchanged.
    const cache = readWeatherCache()
    const stale =
      !cache ||
      cache.location.latitude !== weatherLocation.latitude ||
      cache.location.longitude !== weatherLocation.longitude ||
      cache.units !== weatherUnits ||
      (cache.pastDays ?? 0) !== weatherPastDays ||
      (weatherRefreshMin > 0 &&
        Date.now() - cache.fetchedAt >= weatherRefreshMin * 60_000)
    if (stale) void refreshWeather()
  }, [
    weatherLocation,
    weatherUnits,
    weatherPastDays,
    weatherRefreshMin,
    refreshWeather,
  ])

  useEffect(() => {
    if (!weatherLocation || weatherRefreshMin <= 0) return
    const handle = window.setInterval(
      () => void refreshWeather(),
      weatherRefreshMin * 60_000,
    )
    return () => window.clearInterval(handle)
  }, [weatherLocation, weatherRefreshMin, refreshWeather])

  // Index forecast by dayKey for O(1) lookup in the grid.
  const weatherByDay = useMemo(() => {
    const m = new Map<string, DailyForecast>()
    for (const d of weatherDaily) m.set(d.dayKey, d)
    return m
  }, [weatherDaily])
  // Index hourly entries by `YYYY-MM-DD@HH`. Used by TimeGrid's
  // weather strip to look up per-hour rows. ~168 entries (7 days × 24)
  // — small enough to scan, but a Map lets the per-day-per-hour
  // render loop stay O(1) per cell.
  const weatherByHour = useMemo(() => {
    const m = new Map<string, HourlyForecast>()
    for (const h of weatherHourly) m.set(h.key, h)
    return m
  }, [weatherHourly])
  const [showWeekNum, setShowWeekNum] = useState<boolean>(() =>
    readBool(WEEKNUM_KEY),
  )
  // Calendar UI sizing prefs.
  const [calSidebarWidth, setCalSidebarWidth] = useState<number>(() =>
    readNum(
      SIDEBAR_WIDTH_KEY,
      SIDEBAR_DEFAULT_WIDTH,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
    ),
  )
  const [isResizingCalSidebar, setIsResizingCalSidebar] = useState(false)
  const [calMainZoom, setCalMainZoomState] = useState<number>(() =>
    readNum(MAIN_ZOOM_KEY, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX),
  )
  const [calSidebarZoom, setCalSidebarZoomState] = useState<number>(() =>
    readNum(SIDEBAR_ZOOM_KEY, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX),
  )
  const [calHourPx, setCalHourPxState] = useState<number>(() =>
    readNum(HOUR_PX_KEY, HOUR_PX_DEFAULT, HOUR_PX_MIN, HOUR_PX_MAX),
  )
  const adjustCalMainZoom = useCallback((delta: number | 'reset') => {
    setCalMainZoomState((cur) => {
      const next =
        delta === 'reset'
          ? ZOOM_DEFAULT
          : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(cur + delta).toFixed(2)))
      writeNum(MAIN_ZOOM_KEY, next)
      return next
    })
  }, [])
  const adjustCalSidebarZoom = useCallback((delta: number | 'reset') => {
    setCalSidebarZoomState((cur) => {
      const next =
        delta === 'reset'
          ? ZOOM_DEFAULT
          : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(cur + delta).toFixed(2)))
      writeNum(SIDEBAR_ZOOM_KEY, next)
      return next
    })
  }, [])
  const adjustCalHourPx = useCallback((delta: number | 'reset') => {
    setCalHourPxState((cur) => {
      const next =
        delta === 'reset'
          ? HOUR_PX_DEFAULT
          : Math.max(HOUR_PX_MIN, Math.min(HOUR_PX_MAX, cur + delta))
      writeNum(HOUR_PX_KEY, next)
      return next
    })
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  // Per-calendar sort.
  type CalSort = 'original' | 'name'
  const [calSort, setCalSortState] = useState<CalSort>(() => {
    const v = readStr(CAL_SORT_KEY)
    return v === 'name' ? v : 'original'
  })
  const [calSortReverse, setCalSortReverseState] = useState<boolean>(() =>
    readBool(CAL_SORT_REV_KEY),
  )
  const setCalSort = useCallback((v: CalSort) => {
    setCalSortState(v)
    writeStr(CAL_SORT_KEY, v)
  }, [])
  const toggleCalSortReverse = useCallback(() => {
    setCalSortReverseState((v) => {
      writeBool(CAL_SORT_REV_KEY, !v)
      return !v
    })
  }, [])

  // Per-calendar in-flight sync set (drives the row spinners). The
  // existing loadingCount is a coarse total — we want per-row feedback.
  const [syncingUids, setSyncingUids] = useState<Set<string>>(
    () => new Set(),
  )

  // Most-recent successful calendar sync, for the sidebar's "Synced …"
  // label. Seeded from the warm cache (which the disk snapshot populates)
  // so a cold start shows the persisted time, not "never".
  const [lastCalSync, setLastCalSync] = useState<number | null>(() => {
    const vals = [...getCalMemory().lastSyncedAt.values()]
    return vals.length ? Math.max(...vals) : null
  })

  // Adjustable visible-hours window. When `dayWindowOn` is off the grid shows
  // the full day; when on, each day shows [startH, endH] — with endH past 24
  // extending into the next day. Weekends use their own window when
  // `weekendWindowOn` is set, otherwise the base window.
  const [dayWindowOn, setDayWindowOnState] = useState<boolean>(() =>
    readBool(DAY_WINDOW_ON_KEY),
  )
  const [dayWindow, setDayWindowState] = useState<DayWindow>(() =>
    readWindow(DAY_WINDOW_KEY, DAY_WINDOW_DEFAULT),
  )
  const [weekendWindowOn, setWeekendWindowOnState] = useState<boolean>(() =>
    readBool(WEEKEND_WINDOW_ON_KEY),
  )
  const [weekendWindow, setWeekendWindowState] = useState<DayWindow>(() =>
    readWindow(WEEKEND_WINDOW_KEY, WEEKEND_WINDOW_DEFAULT),
  )
  const toggleDayWindow = useCallback(() => {
    setDayWindowOnState((v) => {
      writeBool(DAY_WINDOW_ON_KEY, !v)
      return !v
    })
  }, [])
  const setDayWindow = useCallback((v: DayWindow) => {
    setDayWindowState(v)
    writeWindow(DAY_WINDOW_KEY, v)
  }, [])
  const toggleWeekendWindow = useCallback(() => {
    setWeekendWindowOnState((v) => {
      writeBool(WEEKEND_WINDOW_ON_KEY, !v)
      return !v
    })
  }, [])
  const setWeekendWindow = useCallback((v: DayWindow) => {
    setWeekendWindowState(v)
    writeWindow(WEEKEND_WINDOW_KEY, v)
  }, [])
  // User-chosen calendar new events default into. '' = not set → fall back
  // to the first visible calendar (resolved below).
  const [defaultCalPref, setDefaultCalPref] = useState<string>(() =>
    readStr(DEFAULT_CAL_KEY),
  )
  const toggleWeekNum = useCallback(() => {
    setShowWeekNum((v) => {
      writeBool(WEEKNUM_KEY, !v)
      return !v
    })
  }, [])
  const chooseDefaultCal = useCallback((uid: string) => {
    setDefaultCalPref(uid)
    writeStr(DEFAULT_CAL_KEY, uid)
  }, [])
  // Display order for the sidebar list — driven by the calendar sort
  // pref. `calendars` itself stays as fetched (other code references the
  // server order indirectly via uid lookups).
  const sortedCalendars = useMemo(() => {
    if (!calendars) return calendars
    let arr = calendars
    if (calSort === 'name') {
      arr = [...arr].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, {
          sensitivity: 'base',
        }),
      )
    }
    if (calSortReverse) arr = [...arr].reverse()
    return arr
  }, [calendars, calSort, calSortReverse])

  const handleCalSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = calSidebarWidth
      let latest = startWidth
      setIsResizingCalSidebar(true)
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(SIDEBAR_MAX_WIDTH, startWidth + (ev.clientX - startX)),
        )
        latest = next
        setCalSidebarWidth(next)
      }
      const onUp = () => {
        setIsResizingCalSidebar(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        writeNum(SIDEBAR_WIDTH_KEY, latest)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [calSidebarWidth],
  )
  // Keyboard-focused day (arrow keys move it; the view pages to follow).
  const [selected, setSelected] = useState<Date>(() =>
    startOfDay(new Date(m0.anchorMs)),
  )
  // Reveal an event from the global meta-search: jump the view to its date
  // and make sure its calendar isn't hidden (else it wouldn't show).
  useEffect(() => {
    if (!pendingOpen) return
    if (pendingOpen.startMs != null) {
      const d = startOfDay(new Date(pendingOpen.startMs))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnchor(d)
      setSelected(d)
    }
    setHidden((prev) => {
      if (!prev.has(pendingOpen.calUid)) return prev
      const next = new Set(prev)
      next.delete(pendingOpen.calUid)
      return next
    })
    onPendingOpenConsumed?.()
  }, [pendingOpen, onPendingOpenConsumed])
  // Composer is either creating (date/hour prefill) or editing an event.
  const [composer, setComposer] = useState<
    | {
        mode: 'new'
        date: Date
        hour?: number
        start?: Date
        end?: Date
        allDay?: boolean
      }
    | { mode: 'edit'; item: EventItem; calUid: string }
    | null
  >(null)
  const [creating, setCreating] = useState(false)
  // Quick-add VEVENT flows: drag-drop / paste / (future) OS open-with.
  // `importing` holds the parsed candidates while the picker is open;
  // `pastingIcs` toggles the paste textarea modal. Drag-drop fills
  // `importing` directly; paste flows into it via the picker.
  const [importing, setImporting] = useState<IcsImportCandidate[] | null>(null)
  const [pastingIcs, setPastingIcs] = useState(false)
  const [icsDragHover, setIcsDragHover] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    calUid: string
    itemUid: string
    localRaw: string
    serverRaw: string
  } | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  const [popover, setPopover] = useState<{
    item: EventItem
    calUid: string
    // True when calUid identifies an ICS subscription rather than an
    // etebase calendar, OR the user has locked the calendar — either way
    // EventPopover hides Edit / Delete so we don't write through to a
    // read-only feed or a locked calendar.
    readOnly: boolean
    // Explanatory note shown in place of the actions when read-only.
    readOnlyReason?: string
    x: number
    y: number
  } | null>(null)
  const [dayPopover, setDayPopover] = useState<{
    day: Date
    x: number
    y: number
  } | null>(null)
  // stoken per calendar — a ref (not render state); seeded from memory.
  const stokenRef = useRef<Map<string, string>>(new Map(m0.stokenByCal))
  const loadAbort = useRef<AbortController | null>(null)
  // The event currently open in the editor + the raw it was opened with,
  // so a background sync can warn if it changed underneath the user.
  const editBaseRef = useRef<{ itemUid: string; raw: string } | null>(null)
  const [serverChanged, setServerChanged] = useState(false)
  // Pending edit/delete of a recurring event, awaiting a scope choice.
  const [recurOp, setRecurOp] = useState<
    | {
        action: 'edit'
        calUid: string
        itemUid: string
        baseRaw: string
        occStart: Date
        allDay: boolean
        patch: VEventPatch
      }
    | {
        action: 'delete'
        calUid: string
        itemUid: string
        baseRaw: string
        occStart: Date
        allDay: boolean
      }
    | null
  >(null)

  // Sync one calendar: start from whatever we already have for it
  // (memory/snapshot), then apply a stoken delta from the server.
  const syncCalendar = useCallback(
    async (uid: string, signal: AbortSignal, seed: EventItem[]) => {
      const acc = new Map(seed.map((e) => [e.itemUid, e]))
      let fromStoken = stokenRef.current.get(uid)
      // Cold (no memory seed): try the disk snapshot for an instant paint
      // and a stoken to delta-sync from.
      if (acc.size === 0 && !fromStoken) {
        const snap = await loadCalSnapshot(uid)
        if (snap && !signal.aborted) {
          for (const e of snap.events) acc.set(e.itemUid, e)
          fromStoken = snap.stoken
          const seeded = [...acc.values()]
          setEventsByCal((prev) => new Map(prev).set(uid, seeded))
          // Seed the in-memory freshness map from disk so the global
          // sync-status indicator reflects calendar age even if the
          // calendar view hasn't run a network sync this session yet.
          getCalMemory().lastSyncedAt.set(uid, snap.lastSyncedAt)
        }
      }
      const res = await listEventItems(uid, {
        signal,
        fromStoken,
        onBatch: (batch) => {
          if (signal.aborted) return
          for (const e of batch) acc.set(e.itemUid, e)
          setEventsByCal((prev) =>
            new Map(prev).set(uid, [...acc.values()]),
          )
        },
      })
      if (signal.aborted) return
      for (const removed of res.removed) acc.delete(removed)
      const finalList = [...acc.values()]
      // If the event open in the editor changed on the server, flag it
      // so the composer can warn rather than silently diverge.
      const eb = editBaseRef.current
      if (eb) {
        const fresh = finalList.find((e) => e.itemUid === eb.itemUid)
        if (fresh && fresh.event.raw !== eb.raw) setServerChanged(true)
      }
      setEventsByCal((prev) => new Map(prev).set(uid, finalList))
      stokenRef.current.set(uid, res.stoken)
      const now = Date.now()
      getCalMemory().lastSyncedAt.set(uid, now)
      setLastCalSync(now)
      await saveCalSnapshot({
        version: 1,
        uid,
        events: finalList,
        stoken: res.stoken,
        lastSyncedAt: now,
      })
    },
    [],
  )

  // Force a per-calendar sync from the sidebar's ↻ button. Tracks
  // loading state per uid for the row spinner; failures are swallowed
  // (the next periodic sync will retry).
  const handleSyncCalendar = useCallback(
    async (uid: string) => {
      if (syncingUids.has(uid)) return
      setSyncingUids((s) => {
        const next = new Set(s)
        next.add(uid)
        return next
      })
      const ac = new AbortController()
      try {
        await syncCalendar(uid, ac.signal, eventsByCal.get(uid) ?? [])
        // A successful manual sync clears any standing sync-error banner.
        setSyncError(null)
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setSyncError(describeCalError(e, 'Calendar sync'))
          logSyncFailure(
            'calendar',
            e instanceof Error ? e.message : String(e),
          )
        }
      } finally {
        setSyncingUids((s) => {
          const next = new Set(s)
          next.delete(uid)
          return next
        })
      }
    },
    [syncingUids, syncCalendar, eventsByCal],
  )

  // Sync every live (non-deleted) calendar — the sidebar's module-level
  // ↻ button. handleSyncCalendar dedupes already-in-flight uids.
  const handleSyncAllCalendars = useCallback(() => {
    const live = (calendars ?? []).filter((c) => !c.isDeleted)
    for (const c of live) void handleSyncCalendar(c.uid)
  }, [calendars, handleSyncCalendar])

  // Push calendar-module sync state into the global SyncStatusPill.
  useEffect(() => {
    setModuleSyncing('calendar', syncingUids.size > 0)
  }, [syncingUids])

  // OS "Open with → ete-sthetic" handoff. App.tsx switches to the
  // calendar module and dispatches ICS_OPEN_EVENT with the argv path;
  // we read the file and open the picker (same modal drag-drop and
  // paste use). Single source of truth for "an .ics arrived from
  // anywhere": the ImportIcsModal.
  useEffect(() => {
    const onOpen = async (e: Event) => {
      const detail = (e as CustomEvent<IcsOpenDetail>).detail
      if (!detail?.path) return
      try {
        const text = await readTextFile(detail.path)
        const candidates = parseIcsCandidates(text)
        if (candidates.length === 0) {
          setNotice('No events found in that file')
          return
        }
        setImporting(candidates)
      } catch (err) {
        setNotice(
          `Couldn't open .ics: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    window.addEventListener(ICS_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ICS_OPEN_EVENT, onOpen)
  }, [])
  // Sync-all handler: fan out per-calendar syncs. handleSyncCalendar
  // dedupes via syncingUids so calling it on an already-syncing uid
  // is a no-op.
  useEffect(() => {
    const syncAll = async () => {
      const live = calendars ? calendars.filter((c) => !c.isDeleted) : []
      await Promise.all(live.map((c) => handleSyncCalendar(c.uid)))
    }
    return registerSyncAllHandler('calendar', syncAll)
  }, [calendars, handleSyncCalendar])

  const loadAll = useCallback(async () => {
    loadAbort.current?.abort()
    const ac = new AbortController()
    loadAbort.current = ac
    // Starting a fresh load clears any standing error; it re-sets below
    // if this attempt also fails.
    setSyncError(null)
    try {
      const mem = getCalMemory()
      let cals = mem.calendars
      if (!cals) {
        cals = await listCalendars({
          includeDeleted: readBool(SHOW_DELETED_CALS_KEY),
        })
        if (ac.signal.aborted) return
        setCalendars(() => cals)
      }
      // Only live calendars are synced — tombstones have no events to
      // pull and the server rejects item listing on a deleted collection.
      const live = cals.filter((c) => !c.isDeleted)
      setLoadingCount(() => live.length)
      await Promise.all(
        live.map((c) =>
          syncCalendar(
            c.uid,
            ac.signal,
            mem.eventsByCal.get(c.uid) ?? [],
          )
            .catch((e) => {
              if (
                ac.signal.aborted ||
                (e as { name?: string })?.name === 'AbortError'
              )
                return
              setSyncError(describeCalError(e, 'Calendar sync'))
              logSyncFailure(
                'calendar',
                e instanceof Error ? e.message : String(e),
              )
            })
            .finally(() => {
              if (!ac.signal.aborted)
                setLoadingCount((n) => Math.max(0, n - 1))
            }),
        ),
      )
      // Tasks overlay: load alongside (failures are non-fatal — the
      // calendar still works without tasks).
      loadCalTasks(ac.signal)
        .then((t) => {
          if (!ac.signal.aborted) setTasks(() => t)
        })
        .catch(() => {})
      // Birthdays overlay: same pattern. Skipped when contacts is the
      // only data source we don't yet have anything for — loadCalBirthdays
      // prefers the contacts module's warm cache and falls back to a
      // direct etebase fetch otherwise. Failures are non-fatal.
      loadCalBirthdays(ac.signal)
        .then((b) => {
          if (!ac.signal.aborted) setBirthdays(() => b)
        })
        .catch(() => {})
      patchCalMemory({ warmed: true })
    } catch (e) {
      if (ac.signal.aborted) return
      setSyncError(describeCalError(e, 'Loading calendars'))
      logSyncFailure('calendar', e instanceof Error ? e.message : String(e))
    }
  }, [syncCalendar])

  useEffect(() => {
    void loadAll()
    return () => loadAbort.current?.abort()
  }, [loadAll])

  // VALARM reminders (roadmap U2). Idempotent + reads calstore, so it keeps
  // firing after this view unmounts; it's torn down on logout instead.
  useEffect(() => {
    startAlarmScheduler()
  }, [])

  // Subscription background refresh. On mount: fetch every subscription
  // that's stale (no `lastSyncedAt` or older than its `refreshMinutes`
  // window). Then poll every minute to catch any that age past the
  // threshold while the calendar stays open. `refreshMinutes <= 0`
  // means "manual only" — skip.
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      for (const sub of subscriptions) {
        if (sub.refreshMinutes <= 0) continue
        if (syncingSubIds.has(sub.id)) continue
        const age =
          sub.lastSyncedAt === null
            ? Infinity
            : (now - sub.lastSyncedAt) / 60_000
        if (age >= sub.refreshMinutes) {
          void fetchSubscription(sub.id)
        }
      }
    }
    tick()
    const handle = window.setInterval(tick, 60_000)
    return () => window.clearInterval(handle)
    // syncingSubIds intentionally excluded — it churns once per fetch
    // and would cause the interval to be rebuilt repeatedly; the tick
    // re-reads the latest value through the closure each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions, fetchSubscription])

  // Inline-rename a calendar from the sidebar.
  const handleRenameCalendar = useCallback(
    async (uid: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      // Optimistic: update the local list immediately so the rename feels
      // instant; reconcile from the server response.
      setCalendars((cur) =>
        cur
          ? cur.map((c) => (c.uid === uid ? { ...c, name: trimmed } : c))
          : cur,
      )
      try {
        const updated = await updateCollectionMeta(uid, { name: trimmed })
        setCalendars((cur) =>
          cur ? cur.map((c) => (c.uid === uid ? updated : c)) : cur,
        )
      } catch (e) {
        setNotice(
          `Rename failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },
    [],
  )

  // Recolour a calendar (EteSync stores `color` in collection meta). Pass
  // undefined to clear it back to the app accent. Optimistic, like rename.
  const handleSetCalendarColor = useCallback(
    async (uid: string, color: string | undefined) => {
      setCalendars((cur) =>
        cur ? cur.map((c) => (c.uid === uid ? { ...c, color } : c)) : cur,
      )
      try {
        const updated = await updateCollectionMeta(uid, { color })
        setCalendars((cur) =>
          cur ? cur.map((c) => (c.uid === uid ? updated : c)) : cur,
        )
      } catch (e) {
        setNotice(
          `Couldn't change colour: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },
    [],
  )

  // ICS export (roadmap U3): merge a calendar's events into one .ics and
  // write it wherever the user picks.
  const handleExportCalendar = useCallback(
    async (uid: string) => {
      if (ioBusy.current) return
      const cal = calendars?.find((c) => c.uid === uid)
      const events = eventsByCal.get(uid) ?? []
      try {
        ioBusy.current = true
        const safeName =
          (cal?.name ?? 'calendar').replace(/[^\w.-]+/g, '_') || 'calendar'
        const path = await saveDialog({
          defaultPath: `${safeName}.ics`,
          filters: [{ name: 'iCalendar', extensions: ['ics'] }],
        })
        if (!path) return
        await writeTextFile(path, buildIcs(events))
        setNotice(
          `Exported ${events.length} event${events.length === 1 ? '' : 's'}`,
        )
      } catch (e) {
        setNotice(
          `Export failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        ioBusy.current = false
      }
    },
    [calendars, eventsByCal],
  )

  // ICS import (roadmap U3): split a picked .ics into per-event VCALENDARs
  // and upload each into the target calendar, then resync so they appear.
  const handleImportCalendar = useCallback(
    async (uid: string) => {
      if (ioBusy.current) return
      if (isCalLocked(uid)) {
        setNotice('This calendar is locked. Unlock it to import events.')
        return
      }
      try {
        ioBusy.current = true
        const picked = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: 'iCalendar', extensions: ['ics', 'ical', 'ifb'] }],
        })
        const path = Array.isArray(picked) ? picked[0] : picked
        if (!path) return
        const parts = splitIcs(await readTextFile(path))
        if (parts.length === 0) {
          setNotice('No events found in that file')
          return
        }
        importCancelRef.current = false
        let added = 0
        let failed = 0
        const log: ImportLogEntry[] = []
        setImportState({
          total: parts.length,
          done: 0,
          added: 0,
          updated: 0,
          failed: 0,
          log: [],
          expanded: false,
          status: 'running',
        })
        for (const part of parts) {
          if (importCancelRef.current) break
          const ev = parseVEvent(part)
          const summary = ev?.summary || '(no title)'
          const when = fmtImportWhen(ev?.start, ev?.allDay ?? false)
          try {
            await createEventRaw(uid, part)
            added++
            log.push({ summary, when, outcome: 'added' })
          } catch (err) {
            failed++
            log.push({
              summary,
              when,
              outcome: 'failed',
              error: err instanceof Error ? err.message : String(err),
            })
          }
          setImportState((s) =>
            s
              ? {
                  ...s,
                  done: added + failed,
                  added,
                  failed,
                  log: [...log],
                }
              : s,
          )
        }
        const cancelled = importCancelRef.current
        try {
          await syncCalendar(
            uid,
            new AbortController().signal,
            eventsByCal.get(uid) ?? [],
          )
        } catch {
          // A failed resync only delays visibility until the next sync.
        }
        setImportState((s) =>
          s
            ? { ...s, status: cancelled ? 'cancelled' : 'finished' }
            : s,
        )
      } catch (e) {
        setImportState(null)
        setNotice(
          `Import failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        ioBusy.current = false
      }
    },
    [eventsByCal, syncCalendar, isCalLocked],
  )

  // Quick-add commit: writes each candidate from the drag-drop /
  // paste flows into the target calendar, replacing existing items
  // when the UID already lives there (iTIP UPDATE semantics) and
  // inserting otherwise.
  const handleImportCandidates = useCallback(
    async (target: string, plan: ImportPlanEntry[]): Promise<void> => {
      if (isCalLocked(target)) {
        setImporting(null)
        setNotice('This calendar is locked. Unlock it to import events.')
        return
      }
      // Close the picker up front so the progress panel is visible, then
      // walk the plan one event at a time, updating progress as we go.
      setImporting(null)
      importCancelRef.current = false
      let added = 0
      let updated = 0
      let failed = 0
      const log: ImportLogEntry[] = []
      setImportState({
        total: plan.length,
        done: 0,
        added: 0,
        updated: 0,
        failed: 0,
        log: [],
        expanded: false,
        status: 'running',
      })
      for (const entry of plan) {
        if (importCancelRef.current) break
        const ev = entry.candidate.event
        const summary = ev.summary || '(no title)'
        const when = fmtImportWhen(ev.start, ev.allDay)
        try {
          if (entry.replacesItemUid) {
            await replaceEventRaw(
              target,
              entry.replacesItemUid,
              entry.candidate.raw,
            )
            updated++
            log.push({ summary, when, outcome: 'updated' })
          } else {
            await createEventRaw(target, entry.candidate.raw)
            added++
            log.push({ summary, when, outcome: 'added' })
          }
        } catch (err) {
          failed++
          log.push({
            summary,
            when,
            outcome: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        }
        setImportState((s) =>
          s
            ? {
                ...s,
                done: added + updated + failed,
                added,
                updated,
                failed,
                log: [...log],
              }
            : s,
        )
      }
      const cancelled = importCancelRef.current
      try {
        await syncCalendar(
          target,
          new AbortController().signal,
          eventsByCal.get(target) ?? [],
        )
      } catch {
        // A failed resync only delays visibility until the next sync.
      }
      setImportState((s) =>
        s ? { ...s, status: cancelled ? 'cancelled' : 'finished' } : s,
      )
    },
    [eventsByCal, syncCalendar, isCalLocked],
  )

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  // Mirror render state into the process-lifetime cache so an unmount
  // (module switch) doesn't lose it. Not a setState — safe in an effect.
  useEffect(() => {
    patchCalMemory({
      calendars,
      eventsByCal,
      stokenByCal: stokenRef.current,
      hidden,
      lockedCals,
      view,
      anchorMs: anchor.getTime(),
      tasks,
      showTasks,
      birthdays,
      showBirthdays,
      hiddenBdayCategories,
      subscriptions,
      eventsBySub,
      hiddenSubs,
    })
  }, [
    calendars,
    eventsByCal,
    hidden,
    lockedCals,
    view,
    anchor,
    tasks,
    showTasks,
    birthdays,
    showBirthdays,
    hiddenBdayCategories,
    subscriptions,
    eventsBySub,
    hiddenSubs,
  ])

  const colorByCal = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of calendars ?? []) map.set(c.uid, c.color ?? ACCENT)
    return map
  }, [calendars])

  const { visibleEvents, colorByItem, calByItem } = useMemo(() => {
    const evs: EventItem[] = []
    const colors = new Map<string, string>()
    const cals = new Map<string, string>()
    // Tombstoned calendars (deleted in this or another client) must not
    // render their events on the grid even while their cached events
    // linger in eventsByCal or the "show deleted" toggle surfaces the row.
    const deletedUids = new Set(
      (calendars ?? []).filter((c) => c.isDeleted).map((c) => c.uid),
    )
    for (const [uid, list] of eventsByCal) {
      if (hidden.has(uid) || deletedUids.has(uid)) continue
      const col = colorByCal.get(uid) ?? ACCENT
      for (const it of list) {
        evs.push(it)
        colors.set(it.itemUid, col)
        cals.set(it.itemUid, uid)
      }
    }
    // Subscriptions live in their own map but render alongside
    // etebase events. Per-source colour comes from the subscription
    // itself (defaulting to the app accent). Subscription event uids
    // collide with etebase uids only if both stores include the same
    // VEVENT UID — unlikely in practice and the visual is the same
    // either way (events are read-only from the subscription side).
    for (const sub of subscriptions) {
      if (hiddenSubs.has(sub.id)) continue
      const list = eventsBySub.get(sub.id)
      if (!list) continue
      const col = sub.color || ACCENT
      for (const it of list) {
        evs.push(it)
        colors.set(it.itemUid, col)
        cals.set(it.itemUid, sub.id)
      }
    }
    return { visibleEvents: evs, colorByItem: colors, calByItem: cals }
  }, [
    eventsByCal,
    hidden,
    colorByCal,
    subscriptions,
    eventsBySub,
    hiddenSubs,
    calendars,
  ])

  const colorFor = useCallback(
    (item: EventItem) => colorByItem.get(item.itemUid) ?? ACCENT,
    [colorByItem],
  )

  const today = startOfDay(new Date())

  const { rangeStart, rangeEnd, dayRange, monthDays } = useMemo(() => {
    if (view === 'year') {
      const y = anchor.getFullYear()
      return {
        rangeStart: new Date(y, 0, 1),
        rangeEnd: new Date(y + 1, 0, 1),
        dayRange: [] as Date[],
        monthDays: [] as Date[],
      }
    }
    if (view === 'month') {
      const md = monthGridDays(anchor)
      return {
        rangeStart: md[0],
        rangeEnd: addDays(md[md.length - 1], 1),
        dayRange: [] as Date[],
        monthDays: md,
      }
    }
    const r = viewDayRange(view, anchor)
    return {
      rangeStart: r.start,
      rangeEnd: r.end,
      dayRange: r.days,
      monthDays: [] as Date[],
    }
  }, [view, anchor])

  // Per-day visible window + union range for the day/week/3day views. Each
  // day shows [startH, endH] (endH past 24 extends into the next day). The
  // union across displayed days defines the time-grid's band; the per-day
  // zigzag overlay shades the parts of that band outside each day's own
  // window. `wakeH`/`sleepH` mirror the window's start/end so TimeGrid's
  // existing overlay code reads them unchanged.
  const { nightByDay, visibleStartH, visibleEndH } = useMemo(() => {
    const empty = {
      nightByDay: [] as { wakeH: number; sleepH: number }[],
      visibleStartH: 0,
      visibleEndH: 24,
    }
    if (!dayWindowOn || dayRange.length === 0) return empty
    const perDay = dayRange.map((d) => {
      const dow = d.getDay()
      const weekend = dow === 0 || dow === 6
      const w = weekendWindowOn && weekend ? weekendWindow : dayWindow
      const wakeH = Math.max(0, Math.min(23, w.startH))
      const sleepH = Math.max(wakeH + 1, Math.min(MAX_END_H, w.endH))
      return { wakeH, sleepH }
    })
    // Union across the displayed days so no day's events are ever hidden:
    // show from the earliest start to the latest end.
    let vs = MAX_END_H
    let ve = 0
    for (const a of perDay) {
      if (a.wakeH < vs) vs = a.wakeH
      if (a.sleepH > ve) ve = a.sleepH
    }
    if (vs >= ve) return empty
    // A day contributes a shaded band when its own window is narrower than
    // the union (morning before its start, or evening after its end).
    const hasBands = perDay.some((a) => a.wakeH > vs || a.sleepH < ve)
    // Nothing trimmed, nothing extended, and every day shares the window →
    // no clip and no overlay needed.
    if (vs <= 0 && ve <= 24 && !hasBands) return empty
    return { nightByDay: perDay, visibleStartH: vs, visibleEndH: ve }
  }, [dayRange, dayWindowOn, dayWindow, weekendWindowOn, weekendWindow])
  // Hours past midnight currently shown below each day column.
  const extendH = Math.max(0, visibleEndH - 24)

  // Expand recurring events into per-occurrence instances within the
  // visible range, then bucket by day.
  const expanded = useMemo(
    () => expandEvents(visibleEvents, rangeStart, rangeEnd),
    [visibleEvents, rangeStart, rangeEnd],
  )
  const byDay = useMemo(
    () => bucketByDay(expanded, rangeStart, rangeEnd),
    [expanded, rangeStart, rangeEnd],
  )

  // Tasks-with-due bucketed by their due day (when the overlay is on).
  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalTask[]>()
    if (!showTasks) return map
    for (const t of tasks) {
      const k = dayKey(startOfDay(t.due))
      const arr = map.get(k)
      if (arr) arr.push(t)
      else map.set(k, [t])
    }
    return map
  }, [tasks, showTasks])

  // Birthdays projected onto each calendar day in the visible range.
  // Each BDAY has a recurring month/day; we instantiate it once per
  // visible year so a multi-month grid shows the right entries on the
  // right cells. Hidden categories filtered out here so the grid
  // doesn't even know they exist.
  const birthdaysByDay = useMemo(() => {
    const map = new Map<string, CalBirthday[]>()
    if (!showBirthdays || birthdays.length === 0) return map
    const visible = birthdays.filter((b) =>
      isBdayVisible(b, hiddenBdayCategories),
    )
    if (visible.length === 0) return map
    // Collect the distinct years the grid actually shows. Month / year
    // views span at most two calendar years; this is a small set.
    const years = new Set<number>()
    let cursor = new Date(rangeStart)
    while (cursor.getTime() < rangeEnd.getTime()) {
      years.add(cursor.getFullYear())
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000 * 28)
    }
    years.add(new Date(rangeEnd.getTime() - 1).getFullYear())
    for (const year of years) {
      for (const b of visible) {
        const d = new Date(year, b.month - 1, b.day)
        // JS rolls Feb 29 of non-leap years over to Mar 1; if so, skip
        // (better than silently moving the birthday).
        if (d.getMonth() !== b.month - 1 || d.getDate() !== b.day) continue
        if (d.getTime() < rangeStart.getTime()) continue
        if (d.getTime() >= rangeEnd.getTime()) continue
        const k = dayKey(d)
        const arr = map.get(k)
        if (arr) arr.push(b)
        else map.set(k, [b])
      }
    }
    return map
  }, [
    birthdays,
    showBirthdays,
    hiddenBdayCategories,
    rangeStart,
    rangeEnd,
  ])

  // Categories present in the loaded birthdays — used by the calendar
  // settings popover to render the per-category checklist.
  const bdayCategories = useMemo(
    () => bdayCategoriesIndex(birthdays),
    [birthdays],
  )

  const openBirthday = useCallback((b: CalBirthday) => {
    window.dispatchEvent(
      new CustomEvent<ContactOpenDetail>(CONTACT_OPEN_EVENT, {
        detail: {
          bookUid: b.bookUid,
          contactItemUid: b.contactItemUid,
        },
      }),
    )
  }, [])

  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), [])
  const step = useCallback(
    (dir: 1 | -1) => setAnchor((a) => stepAnchor(view, a, dir)),
    [view],
  )
  const pickDay = useCallback((d: Date) => {
    setAnchor(startOfDay(d))
    setView('day')
  }, [])
  const pickMonth = useCallback(
    (mo: number) => {
      setAnchor(new Date(anchor.getFullYear(), mo, 1))
      setView('month')
    },
    [anchor],
  )
  const toggleCal = useCallback((uid: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  // Batch visibility ops surfaced by the sidebar's "Show all" / "Hide
  // all" buttons. Hide-all puts every uid into `hidden`; show-all
  // clears the set. Both are local state — the etebase collections
  // themselves don't carry a "hidden" flag.
  const showAllCalendars = useCallback(() => {
    setHidden(new Set())
  }, [])
  const hideAllCalendars = useCallback(() => {
    setHidden(new Set((calendars ?? []).map((c) => c.uid)))
  }, [calendars])

  // Create a new local calendar from the sidebar "+ New" affordance.
  // Reuses the same refresh path as the initial list load so the new
  // row appears once the server confirms — no optimistic placeholder
  // for now (mirrors the calendar module's existing simpler model;
  // tasks does the optimistic dance but the calendar doesn't have
  // the same scaffolding yet).
  const handleCreateCalendar = useCallback(
    async (name: string) => {
      try {
        await createCalendar(name)
        const next = await listCalendars({ includeDeleted: showDeletedCals })
        setCalendars(next)
      } catch (e) {
        setNotice(
          `Couldn't create calendar: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },
    [showDeletedCals],
  )

  // Flip the "show deleted" pref and re-list with/without tombstones.
  // A lightweight re-list (no resync) — deleted calendars carry no
  // events to pull, and live calendars are already in eventsByCal.
  const toggleShowDeletedCals = useCallback(() => {
    setShowDeletedCals((v) => {
      const next = !v
      writeBool(SHOW_DELETED_CALS_KEY, next)
      listCalendars({ includeDeleted: next })
        .then(setCalendars)
        .catch((e) =>
          setNotice(
            `Couldn't refresh calendars: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        )
      return next
    })
  }, [])

  // Open the delete confirmation for a calendar (soft delete → tombstone,
  // matching the tasks module and other EteSync clients).
  const handleDeleteCalendar = useCallback(
    (uid: string) => {
      const cal = (calendars ?? []).find((c) => c.uid === uid)
      if (!cal || cal.isDeleted) return
      setDeletingCal({ uid, name: cal.name })
    },
    [calendars],
  )

  const confirmDeleteCalendar = useCallback(async () => {
    const target = deletingCal
    setDeletingCal(null)
    if (!target) return
    const uid = target.uid
    try {
      await deleteCollection(uid)
      // Drop the deleted calendar's cached events so they vanish from the
      // grid immediately (the isDeleted guard in visibleEvents is a
      // belt-and-braces backstop for tombstones surfaced via the toggle).
      setEventsByCal((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Map(prev)
        next.delete(uid)
        return next
      })
      // Re-list so the row either disappears (toggle off) or flips to a
      // read-only tombstone (toggle on).
      const next = await listCalendars({ includeDeleted: showDeletedCals })
      setCalendars(next)
    } catch (e) {
      setNotice(
        `Couldn't delete calendar: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }, [deletingCal, showDeletedCals])

  // Quick-complete a task from the calendar (optimistic).
  const toggleTask = useCallback(async (t: CalTask) => {
    const nextStatus =
      t.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED'
    setTasks((prev) =>
      prev.map((x) =>
        x.itemUid === t.itemUid ? { ...x, status: nextStatus } : x,
      ),
    )
    try {
      await toggleComplete(t.colUid, t.itemUid, t.status)
    } catch {
      // Roll back on failure.
      setTasks((prev) =>
        prev.map((x) =>
          x.itemUid === t.itemUid ? { ...x, status: t.status } : x,
        ),
      )
    }
  }, [])

  // Keyboard shortcuts. Disabled while a modal owns the keyboard or focus
  // is in a form field. Arrow keys move the selected day and the view
  // pages to keep it visible; Shift+arrow pages by the view's unit.
  useEffect(() => {
    if (composer || conflict) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      // Command shortcuts are Ctrl-prefixed across the app so bare letters
      // can be reserved for future typeahead (e.g. event search).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault()
          const td = startOfDay(new Date())
          setSelected(td)
          setAnchor(td)
          return
        }
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault()
          setComposer({ mode: 'new', date: selected })
          return
        }
        // Ctrl/Cmd+←/→ pages by the current view's unit — next/prev week in
        // week view, day in day view, month in month view, etc. (mirrors
        // Shift+←/→, just on the modifier the user reaches for).
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          const dir = e.key === 'ArrowLeft' ? -1 : 1
          setAnchor((a) => stepAnchor(view, a, dir))
          return
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return

      const viewByKey: Record<string, CalView> = {
        '1': 'day',
        '2': '3day',
        '3': 'week',
        '4': 'month',
        '5': 'year',
      }
      if (viewByKey[e.key]) {
        setView(viewByKey[e.key])
        return
      }

      const arrows: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      }
      const delta = arrows[e.key]
      if (delta === undefined) return
      e.preventDefault()

      if (e.shiftKey) {
        setAnchor((a) => stepAnchor(view, a, delta < 0 ? -1 : 1))
        return
      }

      const next = addDays(selected, delta)
      setSelected(next)
      // Page so `next` stays visible.
      if (view === 'year') {
        if (next.getFullYear() !== anchor.getFullYear())
          setAnchor(new Date(next.getFullYear(), 0, 1))
      } else if (view === 'month') {
        if (
          next.getMonth() !== anchor.getMonth() ||
          next.getFullYear() !== anchor.getFullYear()
        )
          setAnchor(new Date(next.getFullYear(), next.getMonth(), 1))
      } else {
        const r = viewDayRange(view, anchor)
        if (next < r.start || next >= r.end) setAnchor(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, anchor, selected, composer, conflict])

  // Calendars the user can write to, in the same order as the sidebar
  // (so the composer's "Add to" dropdown follows the chosen sort). Locked
  // and deleted calendars are excluded — neither is a valid target.
  const writableCalendars = useMemo(
    () =>
      (sortedCalendars ?? []).filter(
        (c) => !c.isDeleted && !isCalLocked(c.uid),
      ),
    [sortedCalendars, isCalLocked],
  )

  // Target for new events: the user's chosen default if it's writable,
  // otherwise the first visible writable calendar, otherwise the first
  // writable one. Locked calendars never qualify.
  const defaultCalUid =
    (defaultCalPref &&
      writableCalendars.find((c) => c.uid === defaultCalPref)?.uid) ||
    writableCalendars.find((c) => !hidden.has(c.uid))?.uid ||
    writableCalendars[0]?.uid ||
    ''

  const handleCreate = useCallback(
    async (calUid: string, args: NewVEventArgs) => {
      if (isCalLocked(calUid)) {
        setCreateErr('This calendar is locked. Unlock it to add events.')
        return
      }
      setCreating(true)
      setCreateErr(null)
      try {
        const created = await createEvent(calUid, args)
        // Optimistic insert. The disk snapshot picks this up on the next
        // background delta sync (the item comes back under its stoken);
        // the in-memory cache retains it immediately via the mirror effect.
        setEventsByCal((prev) => {
          const next = new Map(prev)
          next.set(calUid, [...(next.get(calUid) ?? []), created])
          return next
        })
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [isCalLocked],
  )

  // Replace (or, with null, remove) an event in a calendar's list.
  const spliceEvent = useCallback(
    (calUid: string, itemUid: string, next: EventItem | null) => {
      setEventsByCal((prev) => {
        const list = prev.get(calUid) ?? []
        const updated = next
          ? list.map((e) => (e.itemUid === itemUid ? next : e))
          : list.filter((e) => e.itemUid !== itemUid)
        return new Map(prev).set(calUid, updated)
      })
    },
    [],
  )

  // Click an event → quick popover at the click point.
  const openEvent = useCallback(
    (item: EventItem, coords: { x: number; y: number }) => {
      const calUid = calByItem.get(item.itemUid)
      if (!calUid) return
      const isSub = subscriptions.some((s) => s.id === calUid)
      const locked = isCalLocked(calUid)
      setPopover({
        item,
        calUid,
        readOnly: isSub || locked,
        readOnlyReason: locked
          ? '🔒 Read-only — this calendar is locked.'
          : undefined,
        x: coords.x,
        y: coords.y,
      })
    },
    [calByItem, subscriptions, isCalLocked],
  )

  const editFromPopover = useCallback(() => {
    setPopover((p) => {
      if (p) {
        setCreateErr(null)
        editBaseRef.current = {
          itemUid: p.item.itemUid,
          raw: p.item.event.raw,
        }
        setServerChanged(false)
        setComposer({ mode: 'edit', item: p.item, calUid: p.calUid })
      }
      return null
    })
  }, [])

  // Stop tracking the edit baseline once the editor isn't in edit mode
  // (ref-only; safe in an effect).
  useEffect(() => {
    if (composer?.mode !== 'edit') editBaseRef.current = null
  }, [composer])

  // Discard local edits and reopen the editor on the server's version.
  const reloadEditing = useCallback(() => {
    const eb = editBaseRef.current
    if (!eb) return
    const calUid = calByItem.get(eb.itemUid)
    if (!calUid) return
    const fresh = (eventsByCal.get(calUid) ?? []).find(
      (e) => e.itemUid === eb.itemUid,
    )
    if (!fresh) return
    editBaseRef.current = { itemUid: fresh.itemUid, raw: fresh.event.raw }
    setServerChanged(false)
    setComposer({ mode: 'edit', item: fresh, calUid })
  }, [calByItem, eventsByCal])

  const closeComposer = useCallback(() => {
    editBaseRef.current = null
    setServerChanged(false)
    setCreateErr(null)
    setComposer(null)
  }, [])

  const handleUpdate = useCallback(
    async (calUid: string, itemUid: string, patch: VEventPatch) => {
      if (isCalLocked(calUid)) {
        setCreateErr('This calendar is locked. Unlock it to edit events.')
        return
      }
      setCreating(true)
      setCreateErr(null)
      try {
        const updated = await updateEvent(calUid, itemUid, patch)
        spliceEvent(calUid, itemUid, updated)
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        if (e instanceof EventConflictError) {
          setComposer(null)
          setConflict({
            calUid,
            itemUid,
            localRaw: e.localRaw,
            serverRaw: e.serverRaw,
          })
          return
        }
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [spliceEvent, isCalLocked],
  )

  // Edit-save: if the calendar changed, move the event first, then apply
  // field edits to the moved copy.
  const handleEditSave = useCallback(
    async (
      origCalUid: string,
      itemUid: string,
      patch: VEventPatch,
      newCalUid: string,
    ) => {
      if (!newCalUid || newCalUid === origCalUid) {
        await handleUpdate(origCalUid, itemUid, patch)
        return
      }
      if (isCalLocked(origCalUid) || isCalLocked(newCalUid)) {
        setCreateErr(
          'A locked calendar is involved. Unlock it to move this event.',
        )
        return
      }
      setCreating(true)
      setCreateErr(null)
      try {
        const moved = await moveEventToCollection(
          origCalUid,
          newCalUid,
          itemUid,
        )
        spliceEvent(origCalUid, itemUid, null)
        setEventsByCal((prev) =>
          new Map(prev).set(newCalUid, [
            ...(prev.get(newCalUid) ?? []),
            moved,
          ]),
        )
        const updated = await updateEvent(newCalUid, moved.itemUid, patch)
        spliceEvent(newCalUid, moved.itemUid, updated)
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [handleUpdate, spliceEvent, isCalLocked],
  )

  const handleDelete = useCallback(
    async (calUid: string, itemUid: string) => {
      if (isCalLocked(calUid)) {
        setCreateErr('This calendar is locked. Unlock it to delete events.')
        return
      }
      setCreating(true)
      setCreateErr(null)
      try {
        await deleteEvent(calUid, itemUid)
        spliceEvent(calUid, itemUid, null)
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [spliceEvent, isCalLocked],
  )

  // Drag move/resize → patch start+end on the series base.
  const handleMoveResize = useCallback(
    async (item: EventItem, start: Date, end: Date) => {
      const calUid = calByItem.get(item.itemUid)
      if (!calUid) return
      if (isCalLocked(calUid)) {
        setNotice('This calendar is locked — event not moved.')
        return
      }
      await handleUpdate(calUid, item.itemUid, { start, end })
    },
    [calByItem, handleUpdate, isCalLocked],
  )

  const addToCal = useCallback((calUid: string, item: EventItem) => {
    setEventsByCal((prev) =>
      new Map(prev).set(calUid, [...(prev.get(calUid) ?? []), item]),
    )
  }, [])

  // Apply a recurring edit/delete at the chosen scope.
  const runRecurScope = useCallback(
    async (scope: RecurScope) => {
      const op = recurOp
      if (!op) return
      if (isCalLocked(op.calUid)) {
        setRecurOp(null)
        setNotice('This calendar is locked.')
        return
      }
      setCreating(true)
      setCreateErr(null)
      try {
        if (op.action === 'delete') {
          if (scope === 'all') {
            await deleteEvent(op.calUid, op.itemUid)
            spliceEvent(op.calUid, op.itemUid, null)
          } else {
            const raw =
              scope === 'this'
                ? addExdate(op.baseRaw, op.occStart, op.allDay)
                : truncateUntil(op.baseRaw, op.occStart, op.allDay)
            const updated = await replaceEventRaw(
              op.calUid,
              op.itemUid,
              raw,
            )
            spliceEvent(op.calUid, op.itemUid, updated)
          }
        } else {
          const { patch } = op
          if (scope === 'all') {
            // Shift the whole series by the time delta the user applied
            // to this occurrence; non-time fields set directly.
            const base = parseVEvent(op.baseRaw)
            const bStart = base?.start ?? patch.start ?? op.occStart
            const bEnd =
              base?.end ?? patch.end ?? new Date(op.occStart.getTime())
            const delta =
              (patch.start?.getTime() ?? op.occStart.getTime()) -
              op.occStart.getTime()
            const updated = await updateEvent(op.calUid, op.itemUid, {
              summary: patch.summary,
              location: patch.location,
              description: patch.description,
              allDay: patch.allDay,
              start: new Date(bStart.getTime() + delta),
              end: new Date(bEnd.getTime() + delta),
            })
            spliceEvent(op.calUid, op.itemUid, updated)
          } else if (scope === 'this') {
            const updatedBase = await replaceEventRaw(
              op.calUid,
              op.itemUid,
              addExdate(op.baseRaw, op.occStart, op.allDay),
            )
            spliceEvent(op.calUid, op.itemUid, updatedBase)
            addToCal(
              op.calUid,
              await createEventRaw(
                op.calUid,
                detachedEvent(op.baseRaw, patch),
              ),
            )
          } else {
            const updatedBase = await replaceEventRaw(
              op.calUid,
              op.itemUid,
              truncateUntil(op.baseRaw, op.occStart, op.allDay),
            )
            spliceEvent(op.calUid, op.itemUid, updatedBase)
            addToCal(
              op.calUid,
              await createEventRaw(
                op.calUid,
                newSeriesFrom(op.baseRaw, patch),
              ),
            )
          }
        }
        setCreating(false)
        setRecurOp(null)
      } catch (e) {
        setCreating(false)
        setRecurOp(null)
        if (e instanceof EventConflictError) {
          setConflict({
            calUid: op.calUid,
            itemUid: op.itemUid,
            localRaw: e.localRaw,
            serverRaw: e.serverRaw,
          })
          return
        }
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [recurOp, spliceEvent, addToCal, isCalLocked],
  )

  const resolveConflict = useCallback(
    async (keep: 'local' | 'cloud') => {
      if (!conflict) return
      const { calUid, itemUid, localRaw, serverRaw } = conflict
      setConflictBusy(true)
      try {
        if (keep === 'local') {
          const forced = await forceUpdateEvent(calUid, itemUid, localRaw)
          spliceEvent(calUid, itemUid, forced)
        } else {
          const event = parseVEvent(serverRaw)
          if (event) spliceEvent(calUid, itemUid, { itemUid, event })
        }
        setConflictBusy(false)
        setConflict(null)
      } catch (e) {
        setConflictBusy(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
        setConflict(null)
      }
    },
    [conflict, spliceEvent],
  )

  if (calendars && calendars.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-text-faint">
          No calendars found in this account.
        </p>
      </div>
    )
  }

  const handleIcsDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!icsDragHover) setIcsDragHover(true)
  }

  const handleIcsDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIcsDragHover(false)
  }

  const handleIcsDrop = async (e: React.DragEvent) => {
    setIcsDragHover(false)
    const file = [...e.dataTransfer.files].find(isIcsFile)
    if (!file) return
    e.preventDefault()
    try {
      const text = await file.text()
      const candidates = parseIcsCandidates(text)
      if (candidates.length === 0) {
        setNotice('No events found in that file')
        return
      }
      setImporting(candidates)
    } catch (err) {
      setNotice(
        `Couldn't read .ics: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 bg-bg text-text"
      onDragOver={handleIcsDragOver}
      onDragLeave={handleIcsDragLeave}
      onDrop={handleIcsDrop}
    >
      {icsDragHover && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-accent bg-accent-soft/40 text-sm font-medium text-accent"
        >
          Drop .ics to import
        </div>
      )}
      <CalendarSidebar
        key={`${anchor.getFullYear()}-${anchor.getMonth()}`}
        anchor={anchor}
        today={today}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        calendars={sortedCalendars}
        hidden={hidden}
        locked={lockedCals}
        onToggle={toggleCal}
        onToggleLock={toggleLock}
        onPickDay={(d) => setAnchor(startOfDay(d))}
        onExportCalendar={handleExportCalendar}
        onImportCalendar={handleImportCalendar}
        onRenameCalendar={handleRenameCalendar}
        onSetCalendarColor={handleSetCalendarColor}
        onDeleteCalendar={handleDeleteCalendar}
        onSyncCalendar={handleSyncCalendar}
        onSyncAllCalendars={handleSyncAllCalendars}
        lastSyncedAt={lastCalSync}
        anySyncing={syncingUids.size > 0 || loadingCount > 0}
        onCreateCalendar={handleCreateCalendar}
        onShowAllCalendars={showAllCalendars}
        onHideAllCalendars={hideAllCalendars}
        showDeleted={showDeletedCals}
        onToggleShowDeleted={toggleShowDeletedCals}
        syncingUids={syncingUids}
        showWeekNum={showWeekNum}
        defaultCalUid={defaultCalUid}
        onSetDefaultCal={chooseDefaultCal}
        subscriptions={subscriptions}
        hiddenSubs={hiddenSubs}
        syncingSubIds={syncingSubIds}
        onToggleSub={toggleSub}
        onAddSubscription={handleAddSubscription}
        onRenameSubscription={handleRenameSubscription}
        onRemoveSubscription={handleRemoveSubscription}
        onSyncSubscription={fetchSubscription}
        onUpdateSubscription={updateSubscription}
        width={calSidebarWidth}
        zoom={calSidebarZoom}
        onResizeStart={handleCalSidebarResizeStart}
        isResizing={isResizingCalSidebar}
      />

      <div
        className="flex min-w-0 flex-1 flex-col"
        style={{ zoom: calMainZoom }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => step(-1)}
              className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              onClick={() => step(1)}
              className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
              aria-label="Next"
            >
              ›
            </button>
            <button
              onClick={goToday}
              className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2"
            >
              Today
            </button>
            <button
              onClick={() => setComposer({ mode: 'new', date: anchor })}
              className="ml-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg hover:opacity-90"
            >
              + New
            </button>
            <button
              onClick={() => setPastingIcs(true)}
              title="Paste an .ics / VCALENDAR block to import (Ctrl+V into the dialog)"
              className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2"
            >
              Paste invite
            </button>
            <input
              type="date"
              aria-label="Go to date"
              title="Go to date"
              value={`${anchor.getFullYear()}-${String(
                anchor.getMonth() + 1,
              ).padStart(2, '0')}-${String(anchor.getDate()).padStart(
                2,
                '0',
              )}`}
              onChange={(e) => {
                const [y, mo, d] = e.target.value.split('-').map(Number)
                if (!y || !mo || !d) return
                const nd = startOfDay(new Date(y, mo - 1, d))
                setAnchor(nd)
                setSelected(nd)
              }}
              className="ml-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted"
            />
          </div>
          <h1 className="truncate text-sm font-semibold">
            {rangeTitle(view, anchor)}
          </h1>

          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`rounded px-2 py-1 ${
                  view === v.id
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {loadingCount > 0 && (
            <span className="text-xs text-text-faint">syncing…</span>
          )}

          {/* Quick collapse/expand of the bed-time (night) hours, only in
              the time-grid views where it applies. Mirrors the settings
              toggle so the user doesn't have to dig into the popover. */}
          {(view === 'day' || view === '3day' || view === 'week') && (
            <button
              type="button"
              onClick={toggleDayWindow}
              aria-pressed={dayWindowOn}
              aria-label={
                dayWindowOn ? 'Show full day' : 'Limit visible hours'
              }
              title={
                dayWindowOn
                  ? 'Show full day (00:00–24:00)'
                  : 'Limit visible hours'
              }
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                dayWindowOn
                  ? 'border-accent/50 bg-accent-soft text-accent'
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
                <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7Z" />
              </svg>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-label="Calendar settings"
              title="Calendar settings (zoom, week numbers, overlay)"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
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
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
              </svg>
            </button>
            {settingsOpen && (
              <CalendarSettingsPopover
                showWeekNum={showWeekNum}
                onToggleWeekNum={toggleWeekNum}
                showTasks={showTasks}
                onToggleShowTasks={toggleShowTasks}
                showBirthdays={showBirthdays}
                onToggleShowBirthdays={toggleShowBirthdays}
                bdayCategories={bdayCategories}
                hiddenBdayCategories={hiddenBdayCategories}
                onToggleBdayCategory={toggleBdayCategory}
                weatherLocation={weatherLocation}
                onSetWeatherLocation={setWeatherLocation}
                weatherUnits={weatherUnits}
                onSetWeatherUnits={setWeatherUnits}
                weatherRefreshMin={weatherRefreshMin}
                onSetWeatherRefreshMin={setWeatherRefreshMin}
                weatherPastDays={weatherPastDays}
                onSetWeatherPastDays={setWeatherPastDays}
                weatherSyncing={weatherSyncing}
                weatherFetchedAt={weatherFetchedAt}
                weatherError={weatherError}
                onRefreshWeather={() => void refreshWeather()}
                mainZoomPct={Math.round(calMainZoom * 100)}
                onMainZoom={adjustCalMainZoom}
                sidebarZoomPct={Math.round(calSidebarZoom * 100)}
                onSidebarZoom={adjustCalSidebarZoom}
                hourPx={calHourPx}
                onHourPx={adjustCalHourPx}
                sortBy={calSort}
                onSortBy={setCalSort}
                sortReverse={calSortReverse}
                onToggleSortReverse={toggleCalSortReverse}
                dayWindowOn={dayWindowOn}
                onToggleDayWindow={toggleDayWindow}
                dayWindow={dayWindow}
                onSetDayWindow={setDayWindow}
                weekendWindowOn={weekendWindowOn}
                onToggleWeekendWindow={toggleWeekendWindow}
                weekendWindow={weekendWindow}
                onSetWeekendWindow={setWeekendWindow}
                onLogout={handleLogout}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Active view */}
        {view === 'year' ? (
          <YearGrid
            year={anchor.getFullYear()}
            byDay={byDay}
            birthdaysByDay={birthdaysByDay}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onPickMonth={pickMonth}
          />
        ) : view === 'month' ? (
          <MonthGrid
            days={monthDays}
            monthOf={anchor.getMonth()}
            byDay={byDay}
            colorFor={colorFor}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onNewEvent={(d) => setComposer({ mode: 'new', date: d })}
            onOpenEvent={openEvent}
            onShowMore={(d, coords) =>
              setDayPopover({ day: d, x: coords.x, y: coords.y })
            }
            tasksByDay={tasksByDay}
            onToggleTask={toggleTask}
            birthdaysByDay={birthdaysByDay}
            onOpenBirthday={openBirthday}
            weatherByDay={weatherByDay}
            weatherUnits={weatherUnits}
            showWeekNum={showWeekNum}
          />
        ) : (
          <TimeGrid
            days={dayRange}
            byDay={byDay}
            colorFor={colorFor}
            showWeekNum={showWeekNum}
            hourPx={calHourPx}
            visibleStartH={visibleStartH}
            visibleEndH={visibleEndH}
            extendH={extendH}
            nightByDay={nightByDay}
            onToggleNight={toggleDayWindow}
            nightActive={dayWindowOn}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onNewEvent={(d, hour) =>
              setComposer({ mode: 'new', date: d, hour })
            }
            onNewAllDay={(d) =>
              setComposer({ mode: 'new', date: d, allDay: true })
            }
            onOpenEvent={openEvent}
            onCreateRange={(start, end) =>
              setComposer({ mode: 'new', date: start, start, end })
            }
            onMoveResize={handleMoveResize}
            tasksByDay={tasksByDay}
            onToggleTask={toggleTask}
            birthdaysByDay={birthdaysByDay}
            onOpenBirthday={openBirthday}
            weatherByHour={weatherByHour}
            weatherUnits={weatherUnits}
          />
        )}
      </div>

      {pastingIcs && (
        <PasteIcsModal
          onCancel={() => setPastingIcs(false)}
          onParsed={(candidates) => {
            setPastingIcs(false)
            setImporting(candidates)
          }}
        />
      )}
      {importing && calendars && calendars.length > 0 && (
        <ImportIcsModal
          candidates={importing}
          calendars={calendars}
          eventsByCal={eventsByCal}
          defaultCalendarUid={
            // Default to the first non-hidden calendar so the user can
            // just hit Enter to import into "their" calendar.
            calendars.find((c) => !hidden.has(c.uid) && !c.isDeleted)?.uid
          }
          onCancel={() => setImporting(null)}
          onConfirm={handleImportCandidates}
        />
      )}
      {composer && writableCalendars.length > 0 && (
        <EventComposer
          date={
            composer.mode === 'new'
              ? composer.date
              : (composer.item.event.start ?? new Date())
          }
          defaultHour={composer.mode === 'new' ? composer.hour : undefined}
          initialStart={composer.mode === 'new' ? composer.start : undefined}
          initialEnd={composer.mode === 'new' ? composer.end : undefined}
          initialAllDay={composer.mode === 'new' ? composer.allDay : undefined}
          editing={composer.mode === 'edit' ? composer.item : undefined}
          calendars={writableCalendars}
          defaultCalUid={
            composer.mode === 'edit' ? composer.calUid : defaultCalUid
          }
          saving={creating}
          error={createErr}
          onCreate={handleCreate}
          onUpdate={
            composer.mode === 'edit'
              ? (patch, newCalUid) => {
                  const it =
                    composer.mode === 'edit' ? composer.item : null
                  if (it?.event.recurring && it.event.start) {
                    editBaseRef.current = null
                    setServerChanged(false)
                    setComposer(null)
                    setRecurOp({
                      action: 'edit',
                      calUid: composer.calUid,
                      itemUid: it.itemUid,
                      baseRaw: it.event.raw,
                      occStart: it.event.start,
                      allDay: patch.allDay ?? it.event.allDay,
                      patch,
                    })
                  } else {
                    handleEditSave(
                      composer.calUid,
                      composer.item.itemUid,
                      patch,
                      newCalUid,
                    )
                  }
                }
              : undefined
          }
          onDelete={
            composer.mode === 'edit'
              ? () => {
                  const it =
                    composer.mode === 'edit' ? composer.item : null
                  if (it?.event.recurring && it.event.start) {
                    setComposer(null)
                    setRecurOp({
                      action: 'delete',
                      calUid: composer.calUid,
                      itemUid: it.itemUid,
                      baseRaw: it.event.raw,
                      occStart: it.event.start,
                      allDay: it.event.allDay,
                    })
                  } else {
                    handleDelete(composer.calUid, composer.item.itemUid)
                  }
                }
              : undefined
          }
          serverChanged={composer.mode === 'edit' && serverChanged}
          onReload={composer.mode === 'edit' ? reloadEditing : undefined}
          onClose={closeComposer}
        />
      )}

      {conflict && (
        <ConflictModal
          localRaw={conflict.localRaw}
          serverRaw={conflict.serverRaw}
          busy={conflictBusy}
          onKeepLocal={() => resolveConflict('local')}
          onKeepCloud={() => resolveConflict('cloud')}
          onClose={() => setConflict(null)}
        />
      )}

      {recurOp && (
        <RecurrenceScopeModal
          action={recurOp.action}
          busy={creating}
          onPick={runRecurScope}
          onClose={() => setRecurOp(null)}
        />
      )}

      {deletingCal && (
        <ConfirmModal
          title={`Delete calendar "${deletingCal.name || '(untitled)'}"?`}
          body="It becomes a tombstone you can still see via “Show deleted”. Other EteSync clients will remove it on their next sync."
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteCalendar}
          onCancel={() => setDeletingCal(null)}
        />
      )}

      {popover && (
        <EventPopover
          item={popover.item}
          calName={
            calendars?.find((c) => c.uid === popover.calUid)?.name ??
            subscriptions.find((s) => s.id === popover.calUid)?.name
          }
          x={popover.x}
          y={popover.y}
          busy={creating}
          readOnly={popover.readOnly}
          readOnlyReason={popover.readOnlyReason}
          onEdit={editFromPopover}
          onDelete={() => {
            const it = popover.item
            if (it.event.recurring && it.event.start) {
              setRecurOp({
                action: 'delete',
                calUid: popover.calUid,
                itemUid: it.itemUid,
                baseRaw: it.event.raw,
                occStart: it.event.start,
                allDay: it.event.allDay,
              })
            } else {
              handleDelete(popover.calUid, it.itemUid)
            }
            setPopover(null)
          }}
          onClose={() => setPopover(null)}
        />
      )}

      {dayPopover && (
        <DayPopover
          day={dayPopover.day}
          events={byDay.get(dayKey(dayPopover.day)) ?? []}
          tasks={tasksByDay.get(dayKey(dayPopover.day)) ?? []}
          birthdays={birthdaysByDay.get(dayKey(dayPopover.day)) ?? []}
          colorFor={colorFor}
          x={dayPopover.x}
          y={dayPopover.y}
          onOpenEvent={(item, coords) => {
            setDayPopover(null)
            openEvent(item, coords)
          }}
          onToggleTask={toggleTask}
          onOpenBirthday={(b) => {
            setDayPopover(null)
            openBirthday(b)
          }}
          onClose={() => setDayPopover(null)}
        />
      )}

      {importState && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-1/2 z-50 w-80 -translate-x-1/2 rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-text">
              <button
                type="button"
                onClick={() =>
                  setImportState((s) =>
                    s ? { ...s, expanded: !s.expanded } : s,
                  )
                }
                aria-expanded={importState.expanded}
                className="flex min-w-0 items-center gap-1.5 text-left hover:text-accent"
                title={importState.expanded ? 'Hide details' : 'Show details'}
              >
                <span aria-hidden className="text-text-faint">
                  {importState.expanded ? '▾' : '▸'}
                </span>
                <span className="truncate">
                  {importState.status === 'running'
                    ? 'Importing…'
                    : importState.status === 'cancelled'
                      ? 'Import cancelled'
                      : 'Import complete'}
                </span>
              </button>
              <span className="shrink-0 tabular-nums text-text-faint">
                {importState.done} / {importState.total}
              </span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-150 ${
                  importState.status === 'cancelled'
                    ? 'bg-text-faint'
                    : 'bg-accent'
                }`}
                style={{
                  width: `${
                    importState.total > 0
                      ? (importState.done / importState.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-faint">
                {importState.added > 0 && `${importState.added} added`}
                {importState.updated > 0 &&
                  `${importState.added > 0 ? ' · ' : ''}${importState.updated} updated`}
                {importState.failed > 0 &&
                  `${importState.added > 0 || importState.updated > 0 ? ' · ' : ''}${importState.failed} failed`}
              </span>
              {importState.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => {
                    importCancelRef.current = true
                  }}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-danger hover:text-danger"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setImportState(null)}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  Close
                </button>
              )}
            </div>
          </div>

          {importState.expanded && (
            <ul className="max-h-56 overflow-y-auto border-t border-border text-[11px]">
              {importState.log.length === 0 ? (
                <li className="px-3 py-2 text-text-faint">No events yet…</li>
              ) : (
                importState.log
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 border-b border-border/50 px-3 py-1.5 last:border-b-0"
                    >
                      <span
                        aria-hidden
                        className={`mt-px shrink-0 ${
                          e.outcome === 'failed'
                            ? 'text-danger'
                            : 'text-accent'
                        }`}
                        title={e.outcome}
                      >
                        {e.outcome === 'failed'
                          ? '✕'
                          : e.outcome === 'updated'
                            ? '↻'
                            : '✓'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-text">
                          {e.summary}
                        </span>
                        <span className="block truncate text-text-faint">
                          {e.when}
                          {e.error ? ` · ${e.error}` : ''}
                        </span>
                      </span>
                    </li>
                  ))
              )}
            </ul>
          )}
        </div>
      )}

      {notice && !importState && (
        <div
          role="status"
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text shadow-lg"
        >
          {notice}
        </div>
      )}

      {/* Persistent, dismissible sync/network error. Bottom-right so it
          doesn't fight the centered info toast or the import progress bar.
          Stays until the user dismisses it or a sync succeeds — a flaky
          connection shouldn't silently vanish, but it also must never
          blank the calendar. */}
      {syncError && (
        <div
          role="alert"
          className="fixed bottom-3 right-3 z-50 flex max-w-sm items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger shadow-lg"
        >
          <span aria-hidden className="mt-px shrink-0">
            ⚠
          </span>
          <span className="min-w-0 flex-1">{syncError}</span>
          <button
            type="button"
            onClick={() => setSyncError(null)}
            aria-label="Dismiss error"
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-danger/70 hover:text-danger"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
