import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EventItem } from '../../types'
import {
  dayKey,
  isBarEvent,
  isoWeek,
  layoutBars,
  sameDay,
  startOfDay,
  timeLabel,
} from '../../services/caldate'

const SNAP_MIN = 15
const GUTTER_PX = 48 // 3rem gutter before the day columns

function snap(min: number): number {
  return Math.max(
    0,
    Math.min(24 * 60, Math.round(min / SNAP_MIN) * SNAP_MIN),
  )
}
function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}
// minutes-from-midnight → "HH:MM" (24h handled as 24:00 for an end edge).
function hhmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

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
    .filter((e) => !isBarEvent(e.event) && e.event.start)
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
  selected,
  onPickDay,
  onNewEvent,
  onOpenEvent,
  onCreateRange,
  onMoveResize,
  showWeekNum,
}: {
  days: Date[]
  byDay: Map<string, EventItem[]>
  colorFor: (item: EventItem) => string
  today: Date
  selected: Date
  onPickDay: (d: Date) => void
  onNewEvent: (d: Date, hour: number) => void
  onOpenEvent: (item: EventItem, coords: { x: number; y: number }) => void
  onCreateRange: (start: Date, end: Date) => void
  onMoveResize: (item: EventItem, start: Date, end: Date) => void
  showWeekNum: boolean
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

  // All-day / multi-day events packed into spanning bars over the row.
  const allDay = useMemo(() => {
    const seen = new Map<string, EventItem>()
    for (const d of days)
      for (const it of byDay.get(dayKey(d)) ?? [])
      seen.set(it.occId ?? it.itemUid, it)
    return layoutBars(days, [...seen.values()])
  }, [days, byDay])
  const ALLDAY_BAR_PX = 18

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

  // ---- Drag: create (empty area), move / resize (existing event) ----
  type Drag =
    | {
        mode: 'create'
        dayIdx: number
        startMin: number
        curMin: number
        moved: boolean
      }
    | {
        mode: 'move'
        item: EventItem
        evStartMin: number
        durMin: number
        grabMin: number
        curDayIdx: number
        curMin: number
        moved: boolean
        x: number
        y: number
      }
    | {
        mode: 'resize'
        item: EventItem
        dayIdx: number
        startMin: number
        curEndMin: number
        moved: boolean
      }
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const setDrag = useCallback((d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }, [])

  const dayIdxAt = useCallback(
    (clientX: number): number => {
      const el = gridRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      const colW = (r.width - GUTTER_PX) / days.length
      return Math.max(
        0,
        Math.min(
          days.length - 1,
          Math.floor((clientX - r.left - GUTTER_PX) / colW),
        ),
      )
    },
    [days.length],
  )
  const minAt = useCallback((clientY: number): number => {
    const el = gridRef.current
    if (!el) return 0
    const y = clientY - el.getBoundingClientRect().top
    return snap((y / HOUR_PX) * 60)
  }, [])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (d.mode === 'create') {
        setDrag({ ...d, curMin: minAt(e.clientY), moved: true })
      } else if (d.mode === 'move') {
        setDrag({
          ...d,
          curDayIdx: dayIdxAt(e.clientX),
          curMin: minAt(e.clientY),
          moved: true,
          x: e.clientX,
          y: e.clientY,
        })
      } else {
        setDrag({ ...d, curEndMin: minAt(e.clientY), moved: true })
      }
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      if (d.mode === 'create') {
        if (!d.moved) {
          onNewEvent(days[d.dayIdx], Math.floor(d.startMin / 60))
          return
        }
        const a = Math.min(d.startMin, d.curMin)
        const b = Math.max(d.startMin, d.curMin)
        const base = startOfDay(days[d.dayIdx]).getTime()
        onCreateRange(
          new Date(base + a * 60000),
          new Date(base + Math.max(b, a + SNAP_MIN) * 60000),
        )
      } else if (d.mode === 'move') {
        if (!d.moved) {
          onOpenEvent(d.item, { x: d.x, y: d.y })
          return
        }
        const newStart = snap(d.evStartMin + (d.curMin - d.grabMin))
        const clamped = Math.max(
          0,
          Math.min(newStart, 24 * 60 - d.durMin),
        )
        const base = startOfDay(days[d.curDayIdx]).getTime()
        onMoveResize(
          d.item,
          new Date(base + clamped * 60000),
          new Date(base + (clamped + d.durMin) * 60000),
        )
      } else {
        if (!d.moved) return
        const endMin = Math.max(d.startMin + SNAP_MIN, d.curEndMin)
        const base = startOfDay(days[d.dayIdx]).getTime()
        onMoveResize(
          d.item,
          new Date(base + d.startMin * 60000),
          new Date(base + endMin * 60000),
        )
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [
    drag,
    days,
    dayIdxAt,
    minAt,
    setDrag,
    onCreateRange,
    onMoveResize,
    onNewEvent,
    onOpenEvent,
  ])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Day headers */}
      <div
        className="grid border-b border-border"
        style={{
          gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`,
        }}
      >
        <div className="flex items-center justify-center text-[10px] tabular-nums text-text-faint">
          {showWeekNum && days[0] ? `W${isoWeek(days[0])}` : ''}
        </div>
        {days.map((d) => {
          const isToday = sameDay(d, today)
          return (
            <button
              key={dayKey(d)}
              onClick={() => onPickDay(d)}
              className={`border-l border-border py-1.5 text-center text-xs hover:bg-surface-2/60 ${
                sameDay(d, selected)
                  ? 'ring-1 ring-inset ring-accent'
                  : ''
              }`}
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

      {/* All-day / multi-day spanning bars */}
      <div
        className="grid border-b border-border bg-surface/40"
        style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
      >
        <div className="py-1 pr-1 text-right text-[10px] text-text-faint">
          all-day
        </div>
        <div
          className="relative"
          style={{
            gridColumn: '2 / -1',
            height: Math.max(1, allDay.laneCount) * ALLDAY_BAR_PX + 4,
          }}
        >
          {days.map((d, i) => (
            <div
              key={dayKey(d)}
              className="absolute bottom-0 top-0 border-l border-border"
              style={{ left: `${(i / days.length) * 100}%` }}
            />
          ))}
          {allDay.segments.map(
            ({
              item,
              startIdx,
              endIdx,
              lane,
              continuesLeft,
              continuesRight,
            }) => {
              const ev = item.event
              const span = endIdx - startIdx + 1
              return (
                <div
                  key={item.occId ?? item.itemUid}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenEvent(item, { x: e.clientX, y: e.clientY })
                  }}
                  title={
                    (ev.recurring ? '↻ recurring · ' : '') + ev.summary
                  }
                  className="absolute flex cursor-pointer items-center gap-1 overflow-hidden px-1 text-xs text-bg hover:brightness-110"
                  style={{
                    left: `calc(${(startIdx / days.length) * 100}% + 2px)`,
                    width: `calc(${(span / days.length) * 100}% - 4px)`,
                    top: 2 + lane * ALLDAY_BAR_PX,
                    height: ALLDAY_BAR_PX - 2,
                    backgroundColor: colorFor(item),
                    borderRadius: 3,
                    borderTopLeftRadius: continuesLeft ? 0 : 3,
                    borderBottomLeftRadius: continuesLeft ? 0 : 3,
                    borderTopRightRadius: continuesRight ? 0 : 3,
                    borderBottomRightRadius: continuesRight ? 0 : 3,
                  }}
                >
                  {continuesLeft && <span>◀</span>}
                  <span className="truncate font-medium">
                    {ev.recurring && '↻ '}
                    {ev.summary || '(no title)'}
                  </span>
                  {continuesRight && <span className="ml-auto">▶</span>}
                </div>
              )
            },
          )}
        </div>
      </div>

      {/* Scrollable time body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="grid select-none"
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
          {days.map((d, dIdx) => {
            const placed = layoutDay(byDay.get(dayKey(d)) ?? [], d)
            return (
              <div
                key={dayKey(d)}
                onPointerDown={(e) => {
                  // Empty-area press starts a create drag (a press with no
                  // movement falls back to the click-to-add behaviour).
                  const m = minAt(e.clientY)
                  setDrag({
                    mode: 'create',
                    dayIdx: dIdx,
                    startMin: m,
                    curMin: m,
                    moved: false,
                  })
                }}
                title="Drag to add an event"
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
                  const isMoveSource =
                    drag?.mode === 'move' &&
                    drag.moved &&
                    (drag.item.occId ?? drag.item.itemUid) ===
                      (item.occId ?? item.itemUid)
                  return (
                    <div
                      key={item.occId ?? item.itemUid}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        const box =
                          e.currentTarget.getBoundingClientRect()
                        const onHandle = e.clientY > box.bottom - 8
                        const sMin = ev.start ? minutesOf(ev.start) : 0
                        if (onHandle) {
                          setDrag({
                            mode: 'resize',
                            item,
                            dayIdx: dIdx,
                            startMin: sMin,
                            curEndMin:
                              ev.end && ev.start
                                ? minutesOf(ev.end)
                                : sMin + 30,
                            moved: false,
                          })
                        } else {
                          const dur =
                            ev.start && ev.end
                              ? Math.max(
                                  SNAP_MIN,
                                  (ev.end.getTime() -
                                    ev.start.getTime()) /
                                    60000,
                                )
                              : 60
                          setDrag({
                            mode: 'move',
                            item,
                            evStartMin: sMin,
                            durMin: dur,
                            grabMin: minAt(e.clientY),
                            curDayIdx: dIdx,
                            curMin: minAt(e.clientY),
                            moved: false,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                      }}
                      title={
                        (ev.recurring ? '↻ recurring · ' : '') +
                        ev.summary +
                        (ev.location ? ` · ${ev.location}` : '')
                      }
                      className={`absolute overflow-hidden rounded-sm border-l-2 px-1 py-0.5 text-xs hover:brightness-125 ${
                        isMoveSource
                          ? 'cursor-grabbing opacity-30'
                          : 'cursor-grab'
                      }`}
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
                      <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                    </div>
                  )
                })}
                {(() => {
                  if (!drag) return null
                  let a: number, b: number
                  if (drag.mode === 'create' && drag.dayIdx === dIdx) {
                    a = Math.min(drag.startMin, drag.curMin)
                    b = Math.max(drag.startMin, drag.curMin, a + SNAP_MIN)
                  } else if (
                    drag.mode === 'move' &&
                    drag.curDayIdx === dIdx
                  ) {
                    a = Math.max(
                      0,
                      Math.min(
                        snap(
                          drag.evStartMin + (drag.curMin - drag.grabMin),
                        ),
                        24 * 60 - drag.durMin,
                      ),
                    )
                    b = a + drag.durMin
                  } else if (
                    drag.mode === 'resize' &&
                    drag.dayIdx === dIdx
                  ) {
                    a = drag.startMin
                    b = Math.max(drag.startMin + SNAP_MIN, drag.curEndMin)
                  } else {
                    return null
                  }
                  const label =
                    drag.mode === 'create'
                      ? 'New event'
                      : drag.item.event.summary || '(no title)'
                  return (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-20 flex flex-col overflow-hidden rounded-sm border-2 border-accent bg-accent/25 px-1 py-0.5 text-xs text-text shadow-lg ring-1 ring-accent"
                      style={{
                        top: `${(a / 60) * HOUR_PX}px`,
                        height: `${((b - a) / 60) * HOUR_PX}px`,
                      }}
                    >
                      <span className="truncate font-medium">{label}</span>
                      <span className="truncate tabular-nums text-text-muted">
                        {hhmm(a)}–{hhmm(b)}
                      </span>
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
