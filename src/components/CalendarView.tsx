import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listCalendars, listEventItems } from '../services/etebase'
import type { CollectionInfo, EventItem } from '../types'

// Basic Thunderbird-style month view. Read-only (calendar-contacts-plan.md
// phases 0–2): no recurrence expansion, no editing yet. Recurring events
// are shown at their base DTSTART and flagged.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS_PER_DAY = 3
const MS_DAY = 24 * 60 * 60 * 1000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Monday-based weekday index (0 = Mon … 6 = Sun).
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

// The 42 day-cells covering the month containing `viewDate`, padded to
// whole weeks (Mon-aligned), so the grid is always 6×7.
function buildGrid(viewDate: Date): Date[] {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - mondayIndex(first))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function CalendarView() {
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeCal, setActiveCal] = useState<string | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [viewDate, setViewDate] = useState<Date>(() => startOfDay(new Date()))
  const loadAbort = useRef<AbortController | null>(null)

  // Load the list of calendar collections once.
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

  // Load all events for a calendar. v1 loads the whole collection and
  // filters client-side; windowed expansion is a later phase. Kept in a
  // useCallback (mirrors MainView.fetchCollection) so the effect body
  // stays free of synchronous setState.
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

  const grid = useMemo(() => buildGrid(viewDate), [viewDate])

  // Bucket events by day key (YYYY-M-D) across the grid range. Multi-day
  // events land in every day they span; DTEND is exclusive (RFC 5545).
  const byDay = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    const rangeStart = grid[0].getTime()
    const rangeEnd = grid[grid.length - 1].getTime() + MS_DAY
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    for (const item of events) {
      const s = item.event.start
      if (!s) continue
      const e = item.event.end && item.event.end > s ? item.event.end : s
      // Clamp the span to the visible range so a stray multi-year event
      // can't blow up the loop.
      let cur = startOfDay(new Date(Math.max(s.getTime(), rangeStart)))
      const last = Math.min(
        item.event.allDay ? e.getTime() - 1 : e.getTime(),
        rangeEnd,
      )
      let guard = 0
      while (cur.getTime() <= last && guard++ < 60) {
        const k = key(cur)
        const arr = map.get(k)
        if (arr) arr.push(item)
        else map.set(k, [item])
        cur = new Date(cur.getTime() + MS_DAY)
      }
    }
    // Stable order: timed events by start, all-day first.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1
        return (
          (a.event.start?.getTime() ?? 0) - (b.event.start?.getTime() ?? 0)
        )
      })
    }
    return map
  }, [events, grid])

  const goMonth = useCallback((delta: number) => {
    setViewDate(
      (d) => new Date(d.getFullYear(), d.getMonth() + delta, 1),
    )
  }, [])

  const today = startOfDay(new Date())
  const monthLabel = viewDate.toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
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
            onClick={() => goMonth(-1)}
            className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => goMonth(1)}
            className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
            aria-label="Next month"
          >
            ›
          </button>
          <button
            onClick={() => setViewDate(startOfDay(new Date()))}
            className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2"
          >
            Today
          </button>
        </div>
        <h1 className="text-sm font-semibold">{monthLabel}</h1>
        <div className="ml-auto flex items-center gap-2">
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
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-center text-xs font-medium text-text-faint"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {grid.map((day) => {
          const inMonth = day.getMonth() === viewDate.getMonth()
          const isToday = sameDay(day, today)
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          const dayEvents = byDay.get(key) ?? []
          const shown = dayEvents.slice(0, MAX_CHIPS_PER_DAY)
          const overflow = dayEvents.length - shown.length
          return (
            <div
              key={key}
              className={`min-h-0 overflow-hidden border-b border-r border-border p-1 ${
                inMonth ? '' : 'bg-surface/40 text-text-faint'
              }`}
            >
              <div className="mb-0.5 flex justify-end">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? 'bg-accent font-semibold text-bg'
                      : inMonth
                        ? 'text-text-muted'
                        : 'text-text-faint'
                  }`}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {shown.map((item) => {
                  const ev = item.event
                  return (
                    <div
                      key={item.itemUid + key}
                      title={
                        (ev.recurring ? '↻ recurring · ' : '') +
                        ev.summary +
                        (ev.location ? ` · ${ev.location}` : '')
                      }
                      className="flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-xs"
                      style={{
                        backgroundColor: 'var(--color-accent-soft)',
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: activeColor }}
                      />
                      <span className="truncate">
                        {ev.recurring && '↻ '}
                        {!ev.allDay && ev.start && (
                          <span className="text-text-faint">
                            {timeLabel(ev.start)}{' '}
                          </span>
                        )}
                        {ev.summary || '(no title)'}
                      </span>
                    </div>
                  )
                })}
                {overflow > 0 && (
                  <div className="px-1 text-xs text-text-faint">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
