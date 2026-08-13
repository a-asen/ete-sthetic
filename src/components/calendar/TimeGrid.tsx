import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EventItem } from '../../types'
import type { CalBirthday } from '../../services/birthdays'
import type { CalTask } from '../../services/caltasks'
import type {
  HourlyForecast,
  WeatherUnits,
} from '../../services/weather'
import {
  unitSuffix,
  weatherIcon,
  weatherLabel,
} from '../../services/weather'
import {
  addDays,
  dayKey,
  isoWeek,
  layoutBars,
  sameDay,
  startOfDay,
  timeLabel,
} from '../../services/caldate'

const SNAP_MIN = 15
const GUTTER_PX = 48 // 3rem gutter before the day columns
// Empty strip kept on the right edge of each day column (the rightmost
// event in a cluster stops short of it) so there's always somewhere to
// press-and-drag a new event even when the day is otherwise full.
const EVENT_RIGHT_GUTTER_PX = 16

function snap(min: number, maxMin: number = 24 * 60): number {
  return Math.max(
    0,
    Math.min(maxMin, Math.round(min / SNAP_MIN) * SNAP_MIN),
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

function layoutDay(
  events: EventItem[],
  day: Date,
  hourPx: number,
  totalH: number = 24,
): Placed[] {
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    DAY_START_HOUR,
  ).getTime()
  const dayEnd = dayStart + totalH * 3_600_000
  // Everything timed (non-all-day) renders in the grid — including events
  // that cross midnight or span days. They appear on each day they touch
  // (bucketByDay maps them there) and are clamped to that day's [00:00,
  // 24:00] window below. Only true all-day events go to the bar row.
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
      const endMs = Math.min(
        Math.max(c.end, startMs + 15 * 60 * 1000),
        dayEnd,
      )
      const topPx = ((startMs - dayStart) / 3_600_000) * hourPx
      const heightPx = Math.max(
        16,
        ((endMs - startMs) / 3_600_000) * hourPx,
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
  onNewAllDay,
  onOpenEvent,
  onCreateRange,
  onMoveResize,
  tasksByDay,
  onToggleTask,
  birthdaysByDay,
  onOpenBirthday,
  weatherByHour,
  weatherUnits,
  showWeekNum,
  hourPx,
  visibleStartH,
  visibleEndH,
  extendH = 0,
  nightByDay,
  onToggleNight,
  nightActive,
}: {
  days: Date[]
  byDay: Map<string, EventItem[]>
  colorFor: (item: EventItem) => string
  today: Date
  selected: Date
  onPickDay: (d: Date) => void
  onNewEvent: (d: Date, hour: number) => void
  // Click the all-day row for a day → start a new all-day event there.
  onNewAllDay?: (d: Date) => void
  onOpenEvent: (item: EventItem, coords: { x: number; y: number }) => void
  onCreateRange: (start: Date, end: Date) => void
  onMoveResize: (item: EventItem, start: Date, end: Date) => void
  // Per-day map of birthdays — same data MonthGrid + DayPopover consume.
  // Empty map when the user has disabled the overlay or there's nothing
  // in the visible range.
  // Tasks-with-due-dates overlay (gated by the "Tasks with due dates"
  // toggle upstream — an empty map means the strip isn't shown).
  tasksByDay: Map<string, CalTask[]>
  onToggleTask: (t: CalTask) => void
  birthdaysByDay: Map<string, CalBirthday[]>
  onOpenBirthday: (b: CalBirthday) => void
  // Per-hour weather forecast keyed by `YYYY-MM-DD@HH`. Empty map
  // when the user has no weather location set or the visible range
  // has no overlap with the forecast horizon. TimeGrid renders one
  // strip per day showing 4 chips (every 6h) of icon + temp.
  weatherByHour: Map<string, HourlyForecast>
  weatherUnits: WeatherUnits
  showWeekNum: boolean
  hourPx: number
  // Visible vertical window in hours. When the night-hide feature
  // collapses pre-dawn / late-evening hours, visibleStartH > 0 and/or
  // visibleEndH < 24. The grid still positions everything in raw
  // 24-hour coords, but an outer wrapper clips to this window.
  visibleStartH: number
  visibleEndH: number
  // Hours past midnight to append at the bottom of each day column so
  // late-night activity that technically falls on the *next* calendar day
  // stays visible under the current day. 0 disables the extension; a
  // positive value (e.g. 3) shows through 03:00 of the following day.
  extendH?: number
  // Per-day awake window [wakeH, sleepH] — drives a striped + zigzag
  // overlay shading the parts of the shared visible window that are
  // bed-time for THIS day (shown only because another displayed day is
  // awake then). Empty array means no per-day overlay (night-hide off).
  nightByDay: { wakeH: number; sleepH: number }[]
  // Toggle night-hide on/off. Drives the clickable "hidden hours" strips
  // (when collapsed) and the "hide night hours" bar (when expanded).
  onToggleNight?: () => void
  // Whether night-hide is currently on. When off we still offer a bar to
  // turn it on, so the user isn't forced up to the toolbar button.
  nightActive?: boolean
}) {
  // Total rendered height in hours: a normal 24h day plus any next-day
  // extension. All grid coordinate math (hour lines, event positions,
  // pointer→minute mapping) works in this extended space.
  const totalH = 24 + extendH
  const hours = useMemo(
    () => Array.from({ length: totalH }, (_, i) => i),
    [totalH],
  )
  const single = days.length === 1

  // Live "now" for the current-time indicator; ticks each minute.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowTopPx =
    ((now.getHours() * 60 + now.getMinutes()) / 60) * hourPx

  // Only true all-day events get packed into spanning bars over the row.
  // Timed events that merely cross midnight render as blocks in the grid
  // (see layoutDay) rather than being banished to the all-day strip.
  const allDay = useMemo(() => {
    const seen = new Map<string, EventItem>()
    for (const d of days)
      for (const it of byDay.get(dayKey(d)) ?? [])
        if (it.event.allDay) seen.set(it.occId ?? it.itemUid, it)
    return layoutBars(days, [...seen.values()])
  }, [days, byDay])
  const ALLDAY_BAR_PX = 18
  // Breathing room above the first visible hour when the top is collapsed,
  // so its label (e.g. 06:00) isn't tucked behind the collapse strip.
  const TOP_PAD = visibleStartH > 0 ? 10 : 0

  // Scroll the body to the current hour on mount (kept on nav so paging
  // doesn't yank the user's scroll position).
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // The inner grid is shifted up by -visibleStartH*hourPx via margin,
    // so the "now" line's visible-coord top is nowTopPx minus that.
    const visibleNowTop = nowTopPx - visibleStartH * hourPx
    el.scrollTop = Math.max(0, visibleNowTop - el.clientHeight / 2)
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
    | {
        // Dragging an all-day bar sideways onto another day. Tracks the
        // grabbed vs current day column; the delta shifts the whole event.
        mode: 'allday'
        item: EventItem
        grabDayIdx: number
        curDayIdx: number
        moved: boolean
        x: number
        y: number
      }
  const gridRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const allDayRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const setDrag = useCallback((d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }, [])

  // Pointer math is done against the grid's *rendered* rect, which the
  // parent's CSS `zoom` (calMainZoom) has already scaled. Mixing the
  // layout-space constants `GUTTER_PX` / `hourPx` with that zoomed rect is
  // what dropped events away from the cursor at any zoom ≠ 100%. We derive
  // the zoom from rect.width vs offsetWidth (CSS zoom scales the former but
  // not the latter) and scale the gutter; the vertical math uses the rect's
  // own height, so it's zoom- and hourPx-independent by construction.
  const dayIdxAt = useCallback(
    (clientX: number): number => {
      const el = gridRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      // Measure the gutter's *rendered* width directly so this is correct
      // under CSS zoom without assuming how the engine reports offsetWidth.
      const gutter =
        gutterRef.current?.getBoundingClientRect().width ?? GUTTER_PX
      const colW = (r.width - gutter) / days.length
      if (colW <= 0) return 0
      return Math.max(
        0,
        Math.min(
          days.length - 1,
          Math.floor((clientX - r.left - gutter) / colW),
        ),
      )
    },
    [days.length],
  )
  // Day column under the cursor within the all-day row (no gutter — the
  // row's day band starts at its own left edge).
  const allDayDayIdxAt = useCallback(
    (clientX: number): number => {
      const el = allDayRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      const colW = r.width / days.length
      if (colW <= 0) return 0
      return Math.max(
        0,
        Math.min(days.length - 1, Math.floor((clientX - r.left) / colW)),
      )
    },
    [days.length],
  )
  const minAt = useCallback((clientY: number): number => {
    const el = gridRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    if (r.height <= 0) return 0
    // The grid div is exactly totalH hours tall, so position within it maps
    // linearly to minutes-from-midnight (which can exceed 24 h when a
    // next-day extension is shown) regardless of zoom or hourPx.
    const totalMin = totalH * 60
    return snap(((clientY - r.top) / r.height) * totalMin, totalMin)
  }, [totalH])

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
      } else if (d.mode === 'allday') {
        const cur = allDayDayIdxAt(e.clientX)
        setDrag({
          ...d,
          curDayIdx: cur,
          moved: d.moved || cur !== d.grabDayIdx,
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
        // Allow the move to reach into the past-midnight extension band so an
        // event can be dragged across the day boundary (its end then lands on
        // the next day). Clamp to the full visible span, not a hard 24 h.
        const totalMin = totalH * 60
        const clamped = Math.max(
          0,
          Math.min(newStart, Math.max(0, totalMin - d.durMin)),
        )
        const base = startOfDay(days[d.curDayIdx]).getTime()
        onMoveResize(
          d.item,
          new Date(base + clamped * 60000),
          new Date(base + (clamped + d.durMin) * 60000),
        )
      } else if (d.mode === 'allday') {
        // A bare click (no move) opens; a drag onto another day shifts the
        // whole all-day event by the day delta, preserving its span.
        const delta = d.curDayIdx - d.grabDayIdx
        if (!d.moved || delta === 0) {
          onOpenEvent(d.item, { x: d.x, y: d.y })
          return
        }
        const ev = d.item.event
        if (!ev.start) return
        const newStart = addDays(ev.start, delta)
        const end = ev.end ?? addDays(ev.start, 1)
        const newEnd = addDays(end, delta)
        onMoveResize(d.item, newStart, newEnd)
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
    allDayDayIdxAt,
    minAt,
    setDrag,
    onCreateRange,
    onMoveResize,
    onNewEvent,
    onOpenEvent,
    totalH,
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

      {/* Hourly weather strip — four chips per day (00/06/12/18) of
          icon + temp. Only rendered when at least one hour in the
          visible range has data. */}
      {(() => {
        const SAMPLE_HOURS = [0, 6, 12, 18]
        let any = false
        for (const d of days) {
          const k = dayKey(d)
          for (const h of SAMPLE_HOURS) {
            if (weatherByHour.has(`${k}@${String(h).padStart(2, '0')}`)) {
              any = true
              break
            }
          }
          if (any) break
        }
        if (!any) return null
        return (
          <div
            className="grid border-b border-border bg-surface/40"
            style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
          >
            <div
              className="py-1 pr-1 text-right text-[10px] text-text-faint"
              aria-hidden
            >
              wx
            </div>
            {days.map((d) => {
              const k = dayKey(d)
              return (
                <div
                  key={k}
                  className="grid grid-cols-4 gap-px border-l border-border"
                >
                  {SAMPLE_HOURS.map((h) => {
                    const w = weatherByHour.get(
                      `${k}@${String(h).padStart(2, '0')}`,
                    )
                    if (!w) {
                      return (
                        <div
                          key={h}
                          className="px-0.5 py-1 text-center text-[9px] text-text-faint/40"
                        >
                          {String(h).padStart(2, '0')}
                        </div>
                      )
                    }
                    return (
                      <div
                        key={h}
                        title={`${String(h).padStart(2, '0')}:00 · ${weatherLabel(w.code)} · ${Math.round(w.temp)}${unitSuffix(weatherUnits)}`}
                        className="flex flex-col items-center justify-center px-0.5 py-1 text-[10px] text-text-muted"
                      >
                        <span className="text-[11px] leading-none" aria-hidden>
                          {weatherIcon(w.code)}
                        </span>
                        <span className="tabular-nums leading-tight">
                          {Math.round(w.temp)}°
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* All-day / multi-day spanning bars */}
      <div
        className="grid border-b border-border bg-surface/40"
        style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
      >
        <div className="py-1 pr-1 text-right text-[10px] text-text-faint">
          all-day
        </div>
        <div
          ref={allDayRef}
          className="relative"
          style={{
            gridColumn: '2 / -1',
            height: Math.max(1, allDay.laneCount) * ALLDAY_BAR_PX + 4,
          }}
        >
          {/* Clickable per-day cells (behind the bars) — click an empty
              spot to start a new all-day event on that day. The bars
              stopPropagation so clicking one opens it instead. */}
          {days.map((d, i) => (
            <div
              key={dayKey(d)}
              onClick={() => onNewAllDay?.(d)}
              title="Add all-day event"
              className="absolute bottom-0 top-0 cursor-pointer border-l border-border transition-colors hover:bg-surface-2/50"
              style={{
                left: `${(i / days.length) * 100}%`,
                width: `${(1 / days.length) * 100}%`,
              }}
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
              // Live preview: while this bar is being dragged, slide it by
              // the day delta so the drop target is obvious.
              const dragDelta =
                drag?.mode === 'allday' &&
                (drag.item.occId ?? drag.item.itemUid) ===
                  (item.occId ?? item.itemUid)
                  ? drag.curDayIdx - drag.grabDayIdx
                  : 0
              return (
                <div
                  key={item.occId ?? item.itemUid}
                  onPointerDown={(e) => {
                    // Primary button only — right/middle click opens the
                    // edit/delete popover via onContextMenu, not a move.
                    if (e.button !== 0) return
                    e.stopPropagation()
                    const gi = allDayDayIdxAt(e.clientX)
                    setDrag({
                      mode: 'allday',
                      item,
                      grabDayIdx: gi,
                      curDayIdx: gi,
                      moved: false,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenEvent(item, { x: e.clientX, y: e.clientY })
                  }}
                  title={
                    (ev.recurring ? '↻ recurring · ' : '') + ev.summary
                  }
                  className="absolute flex cursor-grab items-center gap-1 overflow-hidden px-1 text-xs text-bg hover:brightness-110 active:cursor-grabbing"
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
                    transform: dragDelta
                      ? `translateX(${(dragDelta / days.length) * 100}%)`
                      : undefined,
                    opacity: dragDelta ? 0.85 : undefined,
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

      {/* Birthdays strip — single-day chips per column. Only rendered when
          at least one day in the visible range has a birthday so the
          empty row doesn't push the time body down. */}
      {days.some((d) => (birthdaysByDay.get(dayKey(d)) ?? []).length > 0) && (
        <div
          className="grid border-b border-border bg-surface/40"
          style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
        >
          <div
            className="py-1 pr-1 text-right text-[10px] text-text-faint"
            aria-hidden
          >
            🎂
          </div>
          {days.map((d) => {
            const list = birthdaysByDay.get(dayKey(d)) ?? []
            return (
              <div
                key={dayKey(d)}
                className="flex flex-col gap-0.5 border-l border-border px-1 py-1"
              >
                {list.map((b) => {
                  const age =
                    b.year !== null ? d.getFullYear() - b.year : null
                  return (
                    <button
                      key={`${b.bookUid}:${b.contactItemUid}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenBirthday(b)
                      }}
                      title={
                        age !== null
                          ? `${b.contactName} — turns ${age}`
                          : `${b.contactName}'s birthday`
                      }
                      className="flex w-full items-center gap-1 truncate rounded-sm px-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-accent"
                    >
                      <span aria-hidden>🎂</span>
                      <span className="truncate">{b.contactName}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Tasks-with-due-dates strip — per-day, checkable chips. Mirrors the
          month view's task rendering. Only shown when the toggle is on and a
          visible day has a due task (so the empty row doesn't take space). */}
      {days.some((d) => (tasksByDay.get(dayKey(d)) ?? []).length > 0) && (
        <div
          className="grid border-b border-border bg-surface/40"
          style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}
        >
          <div
            className="py-1 pr-1 text-right text-[10px] text-text-faint"
            aria-hidden
          >
            ☑
          </div>
          {days.map((d) => {
            const list = tasksByDay.get(dayKey(d)) ?? []
            return (
              <div
                key={dayKey(d)}
                className="flex flex-col gap-0.5 border-l border-border px-1 py-1"
              >
                {list.map((t) => {
                  const done = t.status === 'COMPLETED'
                  return (
                    <button
                      key={t.itemUid}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleTask(t)
                      }}
                      title={`Task: ${t.summary}`}
                      className="flex w-full items-center gap-1 truncate rounded-sm px-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-accent"
                    >
                      <span aria-hidden className="shrink-0">
                        {done ? '☑' : '☐'}
                      </span>
                      <span
                        className={`truncate ${
                          done ? 'text-text-faint line-through' : ''
                        }`}
                      >
                        {t.summary || '(untitled task)'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Scrollable time body. The inner grid is always 24 h tall; an
          inner clipping wrapper hides the night hours when active by
          shifting the grid up via a negative margin. */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        {visibleStartH > 0 ? (
          <button
            type="button"
            onClick={onToggleNight}
            title="Show full day"
            aria-label="Show full day"
            className="group flex w-full items-center gap-2 px-2 py-1.5 text-[10px] text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
          >
            <span className="shrink-0 tabular-nums">
              00:00–{String(visibleStartH).padStart(2, '0')}:00
            </span>
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              className="h-1.5 flex-1"
              aria-hidden
            >
              <polyline
                points="0,3 6,0 12,6 18,0 24,6 30,0 36,6 42,0 48,6 54,0 60,6 66,0 72,6 78,0 84,6 90,0 96,6 100,3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
              show
            </span>
          </button>
        ) : (
          // The window feature is off (full day shown): offer an inline bar
          // to limit the visible hours, so the user doesn't have to reach the
          // toolbar button.
          !nightActive && (
            <button
              type="button"
              onClick={onToggleNight}
              title="Limit visible hours"
              aria-label="Limit visible hours"
              className="group flex w-full items-center justify-center gap-1.5 px-2 py-1 text-[10px] text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
            >
              <span aria-hidden>🌙</span>
              <span>Limit visible hours</span>
            </button>
          )
        )}
        <div
          style={{
            height: `${(visibleEndH - visibleStartH) * hourPx + TOP_PAD}px`,
            overflow: 'hidden',
          }}
        >
        <div
          ref={gridRef}
          className="grid select-none"
          style={{
            gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`,
            height: `${totalH * hourPx}px`,
            // TOP_PAD nudges the grid down inside the clip so the first
            // visible hour label (e.g. 06:00) clears the collapse strip
            // instead of being half-hidden behind it.
            marginTop: `${TOP_PAD - visibleStartH * hourPx}px`,
          }}
        >
          {/* Hour gutter */}
          <div ref={gutterRef} className="relative">
            {hours.map((h) =>
              h === 24 ? (
                // Midnight boundary into the next day's extension.
                <div
                  key={h}
                  className="absolute right-1 -translate-y-1/2 text-[9px] font-semibold uppercase tracking-wide text-accent"
                  style={{ top: `${h * hourPx}px` }}
                >
                  +1d
                </div>
              ) : (
                <div
                  key={h}
                  className={`absolute right-1 -translate-y-1/2 text-[10px] ${
                    h > 24 ? 'text-accent/70' : 'text-text-faint'
                  }`}
                  style={{ top: `${h * hourPx}px` }}
                >
                  {h === 0
                    ? ''
                    : `${String(h > 24 ? h - 24 : h).padStart(2, '0')}:00`}
                </div>
              ),
            )}
          </div>
          {/* Day columns */}
          {days.map((d, dIdx) => {
            // When a next-day extension is shown, pull the following day's
            // early-morning timed events into this column so they render in
            // the extension band below midnight. They also appear in their
            // own day (at the top); here they're a dimmed, read-only peek.
            const ownEvents = byDay.get(dayKey(d)) ?? []
            const borrowed =
              extendH > 0
                ? (byDay.get(dayKey(addDays(d, 1))) ?? []).filter(
                    (e) =>
                      !e.event.allDay &&
                      e.event.start != null &&
                      minutesOf(e.event.start) < extendH * 60,
                  )
                : []
            const placed = layoutDay(
              [...ownEvents, ...borrowed],
              d,
              hourPx,
              totalH,
            )
            // Midnight boundary in absolute ms — events starting at/after it
            // are next-day events pulled into this column's extension (the
            // dimmed peek), distinct from events that merely span in from the
            // previous day (which legitimately render at the top).
            const dayEndMs = startOfDay(d).getTime() + 24 * 3_600_000
            return (
              <div
                key={dayKey(d)}
                onPointerDown={(e) => {
                  // Empty-area press starts a create drag (a press with no
                  // movement falls back to the click-to-add behaviour).
                  if (e.button !== 0) return
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
                {(() => {
                  // Per-day bed-time bands: a striped overlay with a
                  // zigzag at the inner boundary, shading the parts of the
                  // shared visible window that are bed-time for THIS day
                  // (shown only because another day is awake then).
                  const n = nightByDay[dIdx]
                  if (!n) return null
                  const bands: {
                    key: string
                    topPx: number
                    heightPx: number
                    zigAtTop: boolean
                  }[] = []
                  if (n.wakeH > visibleStartH) {
                    bands.push({
                      key: 'morning',
                      topPx: visibleStartH * hourPx,
                      heightPx: (n.wakeH - visibleStartH) * hourPx,
                      zigAtTop: false,
                    })
                  }
                  if (n.sleepH < visibleEndH) {
                    bands.push({
                      key: 'evening',
                      topPx: n.sleepH * hourPx,
                      heightPx: (visibleEndH - n.sleepH) * hourPx,
                      zigAtTop: true,
                    })
                  }
                  return bands.map((b) => (
                    <div
                      key={b.key}
                      className="pointer-events-none absolute inset-x-0 z-[1]"
                      style={{
                        top: `${b.topPx}px`,
                        height: `${b.heightPx}px`,
                        backgroundImage:
                          'repeating-linear-gradient(135deg, var(--color-text-faint) 0 1px, transparent 1px 7px)',
                        opacity: 0.3,
                      }}
                    >
                      <svg
                        viewBox="0 0 100 6"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute inset-x-0"
                        style={
                          b.zigAtTop
                            ? { top: 0, height: 6 }
                            : { bottom: 0, height: 6 }
                        }
                      >
                        <polyline
                          points="0,3 8,0 16,6 24,0 32,6 40,0 48,6 56,0 64,6 72,0 80,6 88,0 100,3"
                          fill="none"
                          stroke="var(--color-text-faint)"
                          strokeWidth="1"
                        />
                      </svg>
                    </div>
                  ))
                })()}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-b border-border/50"
                    style={{ top: `${h * hourPx}px`, height: `${hourPx}px` }}
                  />
                ))}
                {extendH > 0 && (
                  // Prominent dashed rule at midnight marking where the
                  // next day's extension begins.
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[2] border-t-2 border-dashed border-accent/50"
                    style={{ top: `${24 * hourPx}px` }}
                  />
                )}
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
                  // An event "borrowed" from the next day into this column's
                  // extension band. It's now fully editable here (drags/edits
                  // the same VEVENT it shows at the top of the next day); a
                  // lighter tint just hints that it belongs to tomorrow.
                  const borrowed =
                    !!ev.start && ev.start.getTime() >= dayEndMs
                  // Minutes measured from THIS column's midnight, so a
                  // borrowed (next-day) event sits in the extension band
                  // (≥ 24 h) and drags in the same coordinate space the rest
                  // of the column uses.
                  const colBase = startOfDay(d).getTime()
                  const colStartMin = ev.start
                    ? Math.round((ev.start.getTime() - colBase) / 60000)
                    : 0
                  const colEndMin =
                    ev.end && ev.start
                      ? Math.round((ev.end.getTime() - colBase) / 60000)
                      : colStartMin + 30
                  const isMoveSource =
                    drag?.mode === 'move' &&
                    drag.moved &&
                    (drag.item.occId ?? drag.item.itemUid) ===
                      (item.occId ?? item.itemUid)
                  return (
                    <div
                      key={item.occId ?? item.itemUid}
                      onPointerDown={(e) => {
                        // Only the primary button drags. Right/middle click
                        // falls through to onContextMenu, which opens the
                        // edit/delete popover instead of moving the event.
                        if (e.button !== 0) return
                        e.stopPropagation()
                        const box =
                          e.currentTarget.getBoundingClientRect()
                        const onHandle = e.clientY > box.bottom - 8
                        const sMin = colStartMin
                        if (onHandle) {
                          setDrag({
                            mode: 'resize',
                            item,
                            dayIdx: dIdx,
                            startMin: sMin,
                            curEndMin: colEndMin,
                            moved: false,
                          })
                        } else {
                          // Duration must match what's rendered so moving
                          // across days follows the event's time window
                          // instead of resizing it. Use the real span when
                          // present; fall back to 30 min — the same default
                          // layoutDay paints for a missing/zero-length end
                          // (a 60 min fallback here is what stretched a
                          // 30 min event to an hour on drop).
                          const startMs = ev.start ? ev.start.getTime() : 0
                          const endMs = ev.end ? ev.end.getTime() : 0
                          const dur = endMs > startMs ? (endMs - startMs) / 60000 : 30
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
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onOpenEvent(item, { x: e.clientX, y: e.clientY })
                      }}
                      title={
                        (ev.recurring ? '↻ recurring · ' : '') +
                        ev.summary +
                        (ev.location ? ` · ${ev.location}` : '') +
                        (borrowed ? ' · next day' : '')
                      }
                      className={`absolute overflow-hidden rounded-sm border-l-2 px-1 py-0.5 text-xs hover:brightness-125 ${
                        isMoveSource
                          ? 'cursor-grabbing opacity-30'
                          : borrowed
                            ? 'cursor-grab opacity-70'
                            : 'cursor-grab'
                      }`}
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - ${
                          col === cols - 1 ? 4 + EVENT_RIGHT_GUTTER_PX : 4
                        }px)`,
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
                        top: `${(a / 60) * hourPx}px`,
                        height: `${((b - a) / 60) * hourPx}px`,
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
        {visibleEndH < 24 && (
          <button
            type="button"
            onClick={onToggleNight}
            title="Show full day"
            aria-label="Show full day"
            className="group flex w-full items-center gap-2 px-2 py-1 text-[10px] text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
          >
            <span className="shrink-0 tabular-nums">
              {String(visibleEndH).padStart(2, '0')}:00–24:00
            </span>
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              className="h-1.5 flex-1"
              aria-hidden
            >
              <polyline
                points="0,3 6,0 12,6 18,0 24,6 30,0 36,6 42,0 48,6 54,0 60,6 66,0 72,6 78,0 84,6 90,0 96,6 100,3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
              show
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
