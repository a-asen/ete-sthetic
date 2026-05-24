import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EventConflictError,
  createEvent,
  createEventRaw,
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
const NIGHT_HIDE_KEY = 'cal.nightHide'
const NIGHT_WEEKDAY_KEY = 'cal.nightWeekday'
const NIGHT_WEEKEND_KEY = 'cal.nightWeekend'

// "Night" is the contiguous late-evening → early-morning span that
// crosses midnight, expressed as [startH, endH] with startH > endH
// (eg {23, 7} means 23:00 → 07:00). startH may be 24 to mean "no night
// in the evening side". A sentinel of {0, 0} disables night for that
// row.
interface NightRange {
  startH: number
  endH: number
}
const NIGHT_WEEKDAY_DEFAULT: NightRange = { startH: 23, endH: 7 }
const NIGHT_WEEKEND_DEFAULT: NightRange = { startH: 1, endH: 9 }

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_DEFAULT_WIDTH = 240
const HOUR_PX_MIN = 28
const HOUR_PX_MAX = 96
const HOUR_PX_DEFAULT = 44
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.6
const ZOOM_DEFAULT = 1

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

function readNight(key: string, fallback: NightRange): NightRange {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<NightRange>
    const startH = Math.max(0, Math.min(24, Number(parsed.startH ?? 0)))
    const endH = Math.max(0, Math.min(24, Number(parsed.endH ?? 0)))
    if (!Number.isFinite(startH) || !Number.isFinite(endH)) return fallback
    return { startH, endH }
  } catch {
    return fallback
  }
}
function writeNight(key: string, v: NightRange): void {
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
}

export function CalendarView({ onLoggedOut }: CalendarViewProps) {
  // Seed all state from the process-lifetime memory cache, so switching
  // back into the calendar is instant (no spinner, no refetch).
  const m0 = getCalMemory()
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(
    () => m0.calendars,
  )
  const [error, setError] = useState<string | null>(null)
  // Transient bottom toast for ICS import/export feedback — kept separate
  // from `error` (which is a full-screen takeover).
  const [notice, setNotice] = useState<string | null>(null)
  const ioBusy = useRef(false)
  const [eventsByCal, setEventsByCal] = useState<Map<string, EventItem[]>>(
    () => new Map(m0.eventsByCal),
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(m0.hidden))
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

  // Night-time hide: when on, hours inside the configured night range
  // collapse into a zigzag overlay in the time grid. Weekday range
  // (Mon–Fri) and weekend range (Sat–Sun) are configured separately.
  const [nightHide, setNightHideState] = useState<boolean>(() =>
    readBool(NIGHT_HIDE_KEY),
  )
  const [nightWeekday, setNightWeekdayState] = useState<NightRange>(() =>
    readNight(NIGHT_WEEKDAY_KEY, NIGHT_WEEKDAY_DEFAULT),
  )
  const [nightWeekend, setNightWeekendState] = useState<NightRange>(() =>
    readNight(NIGHT_WEEKEND_KEY, NIGHT_WEEKEND_DEFAULT),
  )
  const toggleNightHide = useCallback(() => {
    setNightHideState((v) => {
      writeBool(NIGHT_HIDE_KEY, !v)
      return !v
    })
  }, [])
  const setNightWeekday = useCallback((v: NightRange) => {
    setNightWeekdayState(v)
    writeNight(NIGHT_WEEKDAY_KEY, v)
  }, [])
  const setNightWeekend = useCallback((v: NightRange) => {
    setNightWeekendState(v)
    writeNight(NIGHT_WEEKEND_KEY, v)
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
  // Composer is either creating (date/hour prefill) or editing an event.
  const [composer, setComposer] = useState<
    | {
        mode: 'new'
        date: Date
        hour?: number
        start?: Date
        end?: Date
      }
    | { mode: 'edit'; item: EventItem; calUid: string }
    | null
  >(null)
  const [creating, setCreating] = useState(false)
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
      await saveCalSnapshot({
        version: 1,
        uid,
        events: finalList,
        stoken: res.stoken,
        lastSyncedAt: Date.now(),
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
      } catch {
        // Per-row failure is non-fatal; ignore.
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

  const loadAll = useCallback(async () => {
    loadAbort.current?.abort()
    const ac = new AbortController()
    loadAbort.current = ac
    try {
      const mem = getCalMemory()
      let cals = mem.calendars
      if (!cals) {
        cals = await listCalendars()
        if (ac.signal.aborted) return
        setCalendars(() => cals)
      }
      setLoadingCount(() => cals.length)
      await Promise.all(
        cals.map((c) =>
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
              setError(() => (e instanceof Error ? e.message : String(e)))
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
      patchCalMemory({ warmed: true })
    } catch (e) {
      if (ac.signal.aborted) return
      setError(() => (e instanceof Error ? e.message : String(e)))
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
        let ok = 0
        let failed = 0
        for (const part of parts) {
          try {
            await createEventRaw(uid, part)
            ok++
          } catch {
            failed++
          }
        }
        try {
          await syncCalendar(
            uid,
            new AbortController().signal,
            eventsByCal.get(uid) ?? [],
          )
        } catch {
          // A failed resync only delays visibility until the next sync.
        }
        setNotice(
          failed === 0
            ? `Imported ${ok} event${ok === 1 ? '' : 's'}`
            : `Imported ${ok}, ${failed} failed`,
        )
      } catch (e) {
        setNotice(
          `Import failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        ioBusy.current = false
      }
    },
    [eventsByCal, syncCalendar],
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
      view,
      anchorMs: anchor.getTime(),
      tasks,
      showTasks,
    })
  }, [calendars, eventsByCal, hidden, view, anchor, tasks, showTasks])

  const colorByCal = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of calendars ?? []) map.set(c.uid, c.color ?? ACCENT)
    return map
  }, [calendars])

  const { visibleEvents, colorByItem, calByItem } = useMemo(() => {
    const evs: EventItem[] = []
    const colors = new Map<string, string>()
    const cals = new Map<string, string>()
    for (const [uid, list] of eventsByCal) {
      if (hidden.has(uid)) continue
      const col = colorByCal.get(uid) ?? ACCENT
      for (const it of list) {
        evs.push(it)
        colors.set(it.itemUid, col)
        cals.set(it.itemUid, uid)
      }
    }
    return { visibleEvents: evs, colorByItem: colors, calByItem: cals }
  }, [eventsByCal, hidden, colorByCal])

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

  // Per-day night range + union visible range for the day/week/3day views.
  // A range crossing midnight (startH > endH) means the day's visible
  // portion is [endH, startH]. The union across displayed days defines
  // the time-grid's visible band; per-day zigzag overlay surfaces each
  // day's *own* night extension within that band.
  const { nightByDay, visibleStartH, visibleEndH } = useMemo(() => {
    const empty = {
      nightByDay: [] as NightRange[],
      visibleStartH: 0,
      visibleEndH: 24,
    }
    if (!nightHide || dayRange.length === 0) return empty
    const nByDay = dayRange.map((d) => {
      const dow = d.getDay()
      const weekend = dow === 0 || dow === 6
      return weekend ? nightWeekend : nightWeekday
    })
    let vs = 24
    let ve = 0
    for (const n of nByDay) {
      // Only midnight-crossing ranges count; anything else means
      // "night disabled for this day".
      if (n.startH > n.endH) {
        if (n.endH < vs) vs = n.endH
        if (n.startH > ve) ve = n.startH
      } else {
        return empty
      }
    }
    if (vs >= ve) return empty
    return { nightByDay: nByDay, visibleStartH: vs, visibleEndH: ve }
  }, [dayRange, nightHide, nightWeekday, nightWeekend])

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

  // Target for new events: the user's chosen default if it still exists,
  // otherwise the first visible calendar, otherwise the first calendar.
  const defaultCalUid =
    (defaultCalPref &&
      calendars?.find((c) => c.uid === defaultCalPref)?.uid) ||
    calendars?.find((c) => !hidden.has(c.uid))?.uid ||
    calendars?.[0]?.uid ||
    ''

  const handleCreate = useCallback(
    async (calUid: string, args: NewVEventArgs) => {
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
    [],
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
      setPopover({ item, calUid, x: coords.x, y: coords.y })
    },
    [calByItem],
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
    [spliceEvent],
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
    [handleUpdate, spliceEvent],
  )

  const handleDelete = useCallback(
    async (calUid: string, itemUid: string) => {
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
    [spliceEvent],
  )

  // Drag move/resize → patch start+end on the series base.
  const handleMoveResize = useCallback(
    async (item: EventItem, start: Date, end: Date) => {
      const calUid = calByItem.get(item.itemUid)
      if (!calUid) return
      await handleUpdate(calUid, item.itemUid, { start, end })
    },
    [calByItem, handleUpdate],
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
    [recurOp, spliceEvent, addToCal],
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

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="max-w-md text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (calendars && calendars.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="text-sm text-text-faint">
          No calendars found in this account.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-bg text-text">
      <CalendarSidebar
        key={`${anchor.getFullYear()}-${anchor.getMonth()}`}
        anchor={anchor}
        today={today}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        calendars={sortedCalendars}
        hidden={hidden}
        onToggle={toggleCal}
        onPickDay={(d) => setAnchor(startOfDay(d))}
        onExportCalendar={handleExportCalendar}
        onImportCalendar={handleImportCalendar}
        onRenameCalendar={handleRenameCalendar}
        onSyncCalendar={handleSyncCalendar}
        syncingUids={syncingUids}
        showWeekNum={showWeekNum}
        defaultCalUid={defaultCalUid}
        onSetDefaultCal={chooseDefaultCal}
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
                nightHide={nightHide}
                onToggleNightHide={toggleNightHide}
                nightWeekday={nightWeekday}
                onSetNightWeekday={setNightWeekday}
                nightWeekend={nightWeekend}
                onSetNightWeekend={setNightWeekend}
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
            nightByDay={nightByDay}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onNewEvent={(d, hour) =>
              setComposer({ mode: 'new', date: d, hour })
            }
            onOpenEvent={openEvent}
            onCreateRange={(start, end) =>
              setComposer({ mode: 'new', date: start, start, end })
            }
            onMoveResize={handleMoveResize}
          />
        )}
      </div>

      {composer && calendars && calendars.length > 0 && (
        <EventComposer
          date={
            composer.mode === 'new'
              ? composer.date
              : (composer.item.event.start ?? new Date())
          }
          defaultHour={composer.mode === 'new' ? composer.hour : undefined}
          initialStart={composer.mode === 'new' ? composer.start : undefined}
          initialEnd={composer.mode === 'new' ? composer.end : undefined}
          editing={composer.mode === 'edit' ? composer.item : undefined}
          calendars={calendars}
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

      {popover && (
        <EventPopover
          item={popover.item}
          calName={
            calendars?.find((c) => c.uid === popover.calUid)?.name
          }
          x={popover.x}
          y={popover.y}
          busy={creating}
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
          colorFor={colorFor}
          x={dayPopover.x}
          y={dayPopover.y}
          onOpenEvent={(item, coords) => {
            setDayPopover(null)
            openEvent(item, coords)
          }}
          onToggleTask={toggleTask}
          onClose={() => setDayPopover(null)}
        />
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text shadow-lg"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
