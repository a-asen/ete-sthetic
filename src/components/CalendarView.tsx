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

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: '3day', label: '3 days' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

export function CalendarView() {
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeCal, setActiveCal] = useState<string | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [view, setView] = useState<CalView>('month')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const loadAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    listCalendars()
      .then((cals) => {
        if (cancelled) return
        setCalendars(cals)
        setActiveCal((cur) => cur ?? cals[0]?.uid ?? null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadEvents = useCallback(async (calUid: string) => {
    loadAbort.current?.abort()
    const ac = new AbortController()
    loadAbort.current = ac
    setLoadingEvents(() => true)
    setEvents(() => [])
    try {
      await listEventItems(calUid, {
        signal: ac.signal,
        onBatch: (batch) =>
          setEvents((prev) => (ac.signal.aborted ? prev : [...prev, ...batch])),
      })
      if (!ac.signal.aborted) setLoadingEvents(() => false)
    } catch (e) {
      if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError')
        return
      setError(() => (e instanceof Error ? e.message : String(e)))
      setLoadingEvents(() => false)
    }
  }, [])

  useEffect(() => {
    if (!activeCal) return
    void loadEvents(activeCal)
    return () => loadAbort.current?.abort()
  }, [activeCal, loadEvents])

  const today = startOfDay(new Date())

  // The day range the active view spans, used both to bucket events and
  // to feed the renderer.
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
    () => bucketByDay(events, rangeStart, rangeEnd),
    [events, rangeStart, rangeEnd],
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

  const activeColor =
    calendars?.find((c) => c.uid === activeCal)?.color ?? 'var(--color-accent)'

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
    <div className="flex h-screen flex-col bg-bg text-text">
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
        <h1 className="text-sm font-semibold">{rangeTitle(view, anchor)}</h1>

        {/* View switcher */}
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

        {loadingEvents && (
          <span className="text-xs text-text-faint">syncing…</span>
        )}
        {calendars && calendars.length > 0 && (
          <select
            value={activeCal ?? ''}
            onChange={(e) => setActiveCal(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
          >
            {calendars.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name}
              </option>
            ))}
          </select>
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
          color={activeColor}
          today={today}
          onPickDay={pickDay}
        />
      ) : (
        <TimeGrid
          days={dayRange}
          byDay={byDay}
          color={activeColor}
          today={today}
          onPickDay={pickDay}
        />
      )}
    </div>
  )
}
