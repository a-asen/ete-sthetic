import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventItem } from '../../types'
import { dayKey, sameDay, timeLabel } from '../../services/caldate'

const HOUR_PX = 44
const DAY_START_HOUR = 0

// Greedy overlap layout: events that overlap in time are split into
// side-by-side columns within their day.
interface Placed {
  item: EventItem
  topPx: number
  heightPx: number
  col: number
  cols: number
}

function layoutDay(events: EventItem[], day: Date): Placed[] {
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    DAY_START_HOUR,
  ).getTime()
  const timed = events
    .filter((e) => !e.event.allDay && e.event.start)
    .sort(
      (a, b) =>
        (a.event.start?.getTime() ?? 0) - (b.event.start?.getTime() ?? 0),
    )
  // Assign columns within clusters of mutually-overlapping events.
  const placed: Placed[] = []
  let cluster: { item: EventItem; start: number; end: number; col: number }[] =
    []
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    for (const c of cluster) {
      const startMs = Math.max(c.start, dayStart)
      const endMs = Math.max(c.end, startMs + 15 * 60 * 1000)
      const topPx = ((startMs - dayStart) / 3_600_000) * HOUR_PX
      const heightPx = Math.max(
        16,
        ((endMs - startMs) / 3_600_000) * HOUR_PX,
      )
      placed.push({ item: c.item, topPx, heightPx, col: c.col, cols })
    }
    cluster = []
  }
  let clusterEnd = -Infinity
  for (const e of timed) {
    const s = e.event.start!.getTime()
    const en =
      e.event.end && e.event.end > e.event.start!
        ? e.event.end.getTime()
        : s + 30 * 60 * 1000
    if (s >= clusterEnd && cluster.length) flush()
    // First free column not occupied by a still-open event in the cluster.
    const used = new Set(
      cluster.filter((c) => c.end > s).map((c) => c.col),
    )
    let col = 0
    while (used.has(col)) col++
    cluster.push({ item: e, start: s, end: en, col })
    clusterEnd = Math.max(clusterEnd, en)
  }
  if (cluster.length) flush()
  return placed
}

export function TimeGrid({
  days,
  byDay,
  colorFor,
  today,
  onPickDay,
  onNewEvent,
  onOpenEvent,
}: {
  days: Date[]
  byDay: Map<string, EventItem[]>
  colorFor: (item: EventItem) => string
  today: Date
  onPickDay: (d: Date) => void
  onNewEvent: (d: Date, hour: number) => void
  onOpenEvent: (item: EventItem) => void
}) {
  const hours = useMemo(
    () => Array.from({ length: 24 }, (_, i) => i),
    [],
  )
  const single = days.length === 1

  // Live "now" for the current-time indicator; ticks each minute.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowTopPx =
    ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX

  // Scroll the body to the current hour on mount (kept on nav so paging
  // doesn't yank the user's scroll position).
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = Math.max(0, nowTopPx - el.clientHeight / 2)
    // mount-only: intentionally not re-running on nowTopPx changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Day headers */}
      <div
        className="grid border-b border-border"
        style={{
          gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`,
        }}
      >
        <div />
        {days.map((d) => {
          const isToday = sameDay(d, today)
          return (
            <button
              key={dayKey(d)}
              onClick={() => onPickDay(d)}
              className="border-l border-border py-1.5 text-center text-xs hover:bg-surface-2/60"
            >
              <span className="text-text-faint">
                {d.toLocaleDateString([], { weekday: single ? 'long' : 'short' })}
              </span>{' '}
              <span
                className={
                  isToday
                    ? 'rounded-full bg-accent px-1.5 font-semibold text-bg'
                    : 'text-text-muted'
                }
              >
                {d.getDate()}
              </span>
            </button>
          )
        })}
      </div>

      {/* All-day row */}
      <div
        className="grid border-b border-border bg-surface/40"
        style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
      >
        <div className="py-1 pr-1 text-right text-[10px] text-text-faint">
          all-day
        </div>
        {days.map((d) => {
          const evs = (byDay.get(dayKey(d)) ?? []).filter(
            (e) => e.event.allDay,
          )
          return (
            <div
              key={dayKey(d)}
              className="min-h-[1.5rem] space-y-0.5 border-l border-border p-0.5"
            >
              {evs.map((item) => (
                <div
                  key={item.itemUid}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenEvent(item)
                  }}
                  title={item.event.summary}
                  className="cursor-pointer truncate rounded-sm px-1 text-xs hover:brightness-125"
                  style={{ backgroundColor: 'var(--color-accent-soft)' }}
                >
                  {item.event.recurring && '↻ '}
                  {item.event.summary || '(no title)'}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Scrollable time body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`,
            height: `${24 * HOUR_PX}px`,
          }}
        >
          {/* Hour gutter */}
          <div className="relative">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-text-faint"
                style={{ top: `${h * HOUR_PX}px` }}
              >
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((d) => {
            const placed = layoutDay(byDay.get(dayKey(d)) ?? [], d)
            return (
              <div
                key={dayKey(d)}
                onClick={(e) => {
                  const y =
                    e.clientY -
                    e.currentTarget.getBoundingClientRect().top
                  onNewEvent(d, Math.max(0, Math.min(23, Math.floor(y / HOUR_PX))))
                }}
                title="Click to add an event"
                className="relative cursor-pointer border-l border-border"
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-b border-border/50"
                    style={{ top: `${h * HOUR_PX}px`, height: `${HOUR_PX}px` }}
                  />
                ))}
                {sameDay(d, now) && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: `${nowTopPx}px` }}
                    aria-label={`Now ${timeLabel(now)}`}
                  >
                    <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}
                {placed.map(({ item, topPx, heightPx, col, cols }) => {
                  const ev = item.event
                  return (
                    <div
                      key={item.itemUid}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenEvent(item)
                      }}
                      title={
                        (ev.recurring ? '↻ recurring · ' : '') +
                        ev.summary +
                        (ev.location ? ` · ${ev.location}` : '')
                      }
                      className="absolute cursor-pointer overflow-hidden rounded-sm border-l-2 px-1 py-0.5 text-xs hover:brightness-125"
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                        borderLeftColor: colorFor(item),
                        backgroundColor: 'var(--color-accent-soft)',
                      }}
                    >
                      <div className="truncate font-medium">
                        {ev.recurring && '↻ '}
                        {ev.summary || '(no title)'}
                      </div>
                      {ev.start && (
                        <div className="truncate text-text-faint">
                          {timeLabel(ev.start)}
                          {ev.end && ev.end > ev.start
                            ? `–${timeLabel(ev.end)}`
                            : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
