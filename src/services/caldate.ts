import type { EventItem } from '../types'

// Shared date math for the calendar views. Week starts Monday.

export type CalView = 'day' | '3day' | 'week' | 'month' | 'year'

export const MS_DAY = 24 * 60 * 60 * 1000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return startOfDay(r)
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Monday-based weekday index (0 = Mon … 6 = Sun).
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -mondayIndex(d))
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// 42 day-cells (6×7, Mon-aligned) covering the month of `anchor`.
export function monthGridDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gridStart = addDays(first, -mondayIndex(first))
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

// The contiguous day span a view renders, as [start, endExclusive).
// month/year callers use monthGridDays / per-month grids instead.
export function viewDayRange(view: CalView, anchor: Date): {
  start: Date
  end: Date
  days: Date[]
} {
  let start: Date
  let count: number
  if (view === 'day') {
    start = startOfDay(anchor)
    count = 1
  } else if (view === '3day') {
    start = startOfDay(anchor)
    count = 3
  } else {
    // week
    start = startOfWeek(anchor)
    count = 7
  }
  const days = Array.from({ length: count }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, count), days }
}

// Step the anchor by one "page" in the given view's natural unit.
export function stepAnchor(view: CalView, anchor: Date, dir: 1 | -1): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, dir)
    case '3day':
      return addDays(anchor, 3 * dir)
    case 'week':
      return addDays(anchor, 7 * dir)
    case 'month':
      return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
    case 'year':
      return new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1)
  }
}

// Bucket events by dayKey across [rangeStart, rangeEnd). Multi-day events
// land in every day they span; DTEND is exclusive (RFC 5545). Recurring
// events are placed at their base DTSTART only (no expansion yet).
export function bucketByDay(
  events: EventItem[],
  rangeStart: Date,
  rangeEnd: Date,
): Map<string, EventItem[]> {
  const map = new Map<string, EventItem[]>()
  const lo = rangeStart.getTime()
  const hi = rangeEnd.getTime()
  for (const item of events) {
    const s = item.event.start
    if (!s) continue
    const e = item.event.end && item.event.end > s ? item.event.end : s
    if (e.getTime() < lo || s.getTime() >= hi) continue
    let cur = startOfDay(new Date(Math.max(s.getTime(), lo)))
    const lastMs = Math.min(
      item.event.allDay ? e.getTime() - 1 : e.getTime(),
      hi - 1,
    )
    let guard = 0
    while (cur.getTime() <= lastMs && guard++ < 400) {
      const k = dayKey(cur)
      const arr = map.get(k)
      if (arr) arr.push(item)
      else map.set(k, [item])
      cur = addDays(cur, 1)
    }
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1
      return (a.event.start?.getTime() ?? 0) - (b.event.start?.getTime() ?? 0)
    })
  }
  return map
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Toolbar title for the current view + anchor.
export function rangeTitle(view: CalView, anchor: Date): string {
  if (view === 'year') return String(anchor.getFullYear())
  if (view === 'month') {
    return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
  }
  const { days } = viewDayRange(view, anchor)
  const first = days[0]
  const last = days[days.length - 1]
  if (view === 'day') {
    return first.toLocaleDateString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  const sameMonth =
    first.getMonth() === last.getMonth() &&
    first.getFullYear() === last.getFullYear()
  const f = first.toLocaleDateString([], { day: 'numeric', month: 'short' })
  const l = last.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return sameMonth
    ? `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString([], { month: 'long', year: 'numeric' })}`
    : `${f} – ${l}`
}
