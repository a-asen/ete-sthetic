import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listCalendars, listEventItems } from '../services/etebase'
import type { CollectionInfo, EventItem } from '../types'
import {
  type CalView,
  addDays,
  bucketByDay,
  monthGridDays,
  rangeTitle,
  startOfDay,
  stepAnchor,
  viewDayRange,
} from '../services/caldate'
import { MonthGrid } from './calendar/MonthGrid'
import { TimeGrid } from './calendar/TimeGrid'
import { YearGrid } from './calendar/YearGrid'
import { CalendarSidebar } from './calendar/CalendarSidebar'

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: '3day', label: '3 days' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

const ACCENT = 'var(--color-accent)'

export function CalendarView() {
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Events keyed by calendar uid so visibility toggles are pure filtering
  // (no refetch).
  const [eventsByCal, setEventsByCal] = useState<Map<string, EventItem[]>>(
    () => new Map(),
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [loadingCount, setLoadingCount] = useState(0)
  const [view, setView] = useState<CalView>('month')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const loadAbort = useRef<AbortController | null>(null)

  // Load calendars, then all their events in parallel.
  useEffect(() => {
    let cancelled = false
    loadAbort.current?.abort()
    const ac = new AbortController()
    loadAbort.current = ac
    listCalendars()
      .then((cals) => {
        if (cancelled) return
        setCalendars(cals)
        setLoadingCount(() => cals.length)
        for (const c of cals) {
          listEventItems(c.uid, {
            signal: ac.signal,
            onBatch: (batch) =>
              setEventsByCal((prev) => {
                if (ac.signal.aborted) return prev
                const next = new Map(prev)
                next.set(c.uid, [...(next.get(c.uid) ?? []), ...batch])
                return next
              }),
          })
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
            })
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [])

  const colorByCal = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of calendars ?? []) m.set(c.uid, c.color ?? ACCENT)
    return m
  }, [calendars])

  // Flatten visible calendars; remember each item's calendar colour.
  const { visibleEvents, colorByItem } = useMemo(() => {
    const evs: EventItem[] = []
    const colors = new Map<string, string>()
    for (const [uid, list] of eventsByCal) {
      if (hidden.has(uid)) continue
      const col = colorByCal.get(uid) ?? ACCENT
      for (const it of list) {
        evs.push(it)
        colors.set(it.itemUid, col)
      }
    }
    return { visibleEvents: evs, colorByItem: colors }
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

  const byDay = useMemo(
    () => bucketByDay(visibleEvents, rangeStart, rangeEnd),
    [visibleEvents, rangeStart, rangeEnd],
  )

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
    (m: number) => {
      setAnchor(new Date(anchor.getFullYear(), m, 1))
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
        calendars={calendars}
        hidden={hidden}
        onToggle={toggleCal}
        onPickDay={(d) => setAnchor(startOfDay(d))}
      />

      <div className="flex min-w-0 flex-1 flex-col">
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
        </div>

        {/* Active view */}
        {view === 'year' ? (
          <YearGrid
            year={anchor.getFullYear()}
            byDay={byDay}
            today={today}
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
            onPickDay={pickDay}
          />
        ) : (
          <TimeGrid
            days={dayRange}
            byDay={byDay}
            colorFor={colorFor}
            today={today}
            onPickDay={pickDay}
          />
        )}
      </div>
    </div>
  )
}
