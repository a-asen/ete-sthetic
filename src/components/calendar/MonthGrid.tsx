import type { EventItem } from '../../types'
import type { CalTask } from '../../services/caltasks'
import {
  dayKey,
  isBarEvent,
  isoWeek,
  layoutBars,
  sameDay,
} from '../../services/caldate'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DATE_ROW_PX = 24
const BAR_PX = 18
const MAX_CHIPS = 2

export function MonthGrid({
  days,
  monthOf,
  byDay,
  colorFor,
  today,
  selected,
  onPickDay,
  onNewEvent,
  onOpenEvent,
  onShowMore,
  tasksByDay,
  onToggleTask,
  showWeekNum,
}: {
  days: Date[]
  monthOf: number
  byDay: Map<string, EventItem[]>
  colorFor: (item: EventItem) => string
  today: Date
  selected: Date
  onPickDay: (d: Date) => void
  onNewEvent: (d: Date) => void
  onOpenEvent: (item: EventItem, coords: { x: number; y: number }) => void
  onShowMore: (d: Date, coords: { x: number; y: number }) => void
  tasksByDay: Map<string, CalTask[]>
  onToggleTask: (t: CalTask) => void
  showWeekNum: boolean
}) {
  const WK = 'w-8 shrink-0'
  // 6 weeks of 7 days.
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  // Heatmap: tint each day with accent-soft scaled by how many events
  // are on it relative to the busiest visible day. Subtle (cap ~22%) so
  // it reads as a gradient rather than competing with chips/bars.
  const HEAT_MAX_PCT = 22
  let busiest = 0
  for (const d of days) {
    const n = byDay.get(dayKey(d))?.length ?? 0
    if (n > busiest) busiest = n
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex border-b border-border">
        {showWeekNum && (
          <div
            className={`${WK} py-1.5 text-center text-[10px] font-medium text-text-faint`}
          >
            Wk
          </div>
        )}
        <div className="grid flex-1 grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="px-2 py-1.5 text-center text-xs font-medium text-text-faint"
            >
              {w}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {weeks.map((week) => {
          // Dedupe events overlapping this week, then pack into bar lanes.
          const seen = new Map<string, EventItem>()
          for (const d of week)
            for (const it of byDay.get(dayKey(d)) ?? [])
              seen.set(it.occId ?? it.itemUid, it)
          const { segments, laneCount } = layoutBars(week, [...seen.values()])
          const barArea = laneCount * BAR_PX

          return (
            <div key={dayKey(week[0])} className="flex min-h-0 flex-1">
              {showWeekNum && (
                <div
                  className={`${WK} flex items-start justify-center border-b border-r border-border pt-1 text-[10px] tabular-nums text-text-faint`}
                >
                  {isoWeek(week[0])}
                </div>
              )}
              <div className="relative grid min-h-0 flex-1 grid-cols-7">
                {week.map((day) => {
                const inMonth = day.getMonth() === monthOf
                const isToday = sameDay(day, today)
                const k = dayKey(day)
                const dayCount = byDay.get(k)?.length ?? 0
                const heatPct =
                  busiest > 0 ? (dayCount / busiest) * HEAT_MAX_PCT : 0
                const heatBg =
                  heatPct > 0
                    ? `color-mix(in srgb, var(--color-accent) ${heatPct.toFixed(1)}%, transparent)`
                    : undefined
                const chips = (byDay.get(k) ?? []).filter(
                  (it) => !isBarEvent(it.event),
                )
                const shown = chips.slice(0, MAX_CHIPS)
                const overflow = chips.length - shown.length
                return (
                  <div
                    key={k}
                    onClick={() => onNewEvent(day)}
                    title={
                      dayCount > 0
                        ? `${dayCount} event${dayCount === 1 ? '' : 's'} — click to add another`
                        : 'Click to add an event'
                    }
                    style={heatBg ? { backgroundColor: heatBg } : undefined}
                    className={`relative flex min-h-0 cursor-pointer flex-col overflow-hidden border-b border-r border-border p-1 hover:bg-surface-2/60 ${
                      inMonth ? '' : 'bg-surface/40 text-text-faint'
                    } ${
                      sameDay(day, selected)
                        ? 'ring-1 ring-inset ring-accent'
                        : ''
                    }`}
                  >
                    <div
                      className="flex justify-end"
                      style={{ height: DATE_ROW_PX }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onPickDay(day)
                        }}
                        title="Open day"
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs hover:ring-1 hover:ring-accent ${
                          isToday
                            ? 'bg-accent font-semibold text-bg'
                            : inMonth
                              ? 'text-text-muted'
                              : 'text-text-faint'
                        }`}
                      >
                        {day.getDate()}
                      </button>
                    </div>
                    {/* Reserve vertical space for the bar overlay. */}
                    <div style={{ height: barArea }} />
                    <div className="min-h-0 space-y-0.5 overflow-hidden">
                      {shown.map((item) => {
                        const ev = item.event
                        return (
                          <div
                            key={(item.occId ?? item.itemUid) + k}
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenEvent(item, { x: e.clientX, y: e.clientY })
                            }}
                            title={
                              (ev.recurring ? '↻ recurring · ' : '') +
                              ev.summary +
                              (ev.location ? ` · ${ev.location}` : '')
                            }
                            className="flex cursor-pointer items-center gap-1 truncate rounded-sm px-1 text-xs hover:brightness-125"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: colorFor(item) }}
                            />
                            <span className="truncate">
                              {ev.start && (
                                <span className="text-text-faint">
                                  {ev.start.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}{' '}
                                </span>
                              )}
                              {ev.summary || '(no title)'}
                            </span>
                          </div>
                        )
                      })}
                      {overflow > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onShowMore(day, {
                              x: e.clientX,
                              y: e.clientY,
                            })
                          }}
                          className="px-1 text-xs text-text-faint hover:text-accent"
                        >
                          +{overflow} more
                        </button>
                      )}
                      {(tasksByDay.get(k) ?? []).map((t) => {
                        const done = t.status === 'COMPLETED'
                        return (
                          <button
                            key={t.itemUid}
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleTask(t)
                            }}
                            title={`Task: ${t.summary}`}
                            className="flex w-full items-center gap-1 truncate px-1 text-xs text-text-muted hover:text-accent"
                          >
                            <span className="shrink-0">
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
                  </div>
                )
              })}

              {/* Spanning-bar overlay for this week. */}
              <div className="pointer-events-none absolute inset-0">
                {segments.map(
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
                        key={(item.occId ?? item.itemUid) + dayKey(week[0])}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenEvent(item, { x: e.clientX, y: e.clientY })
                        }}
                        title={
                          (ev.recurring ? '↻ recurring · ' : '') + ev.summary
                        }
                        className="pointer-events-auto absolute flex cursor-pointer items-center gap-1 overflow-hidden px-1 text-xs text-bg hover:brightness-110"
                        style={{
                          left: `calc(${(startIdx / 7) * 100}% + 2px)`,
                          width: `calc(${(span / 7) * 100}% - 4px)`,
                          top: DATE_ROW_PX + lane * BAR_PX,
                          height: BAR_PX - 2,
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
                        {continuesRight && (
                          <span className="ml-auto">▶</span>
                        )}
                      </div>
                    )
                  },
                )}
              </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
