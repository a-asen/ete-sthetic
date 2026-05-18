import type { EventItem } from '../../types'
import { dayKey, sameDay } from '../../services/caldate'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS = 3

export function MonthGrid({
  days,
  monthOf,
  byDay,
  colorFor,
  today,
  onPickDay,
}: {
  days: Date[]
  monthOf: number
  byDay: Map<string, EventItem[]>
  colorFor: (item: EventItem) => string
  today: Date
  onPickDay: (d: Date) => void
}) {
  return (
    <div className="flex flex-1 flex-col">
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
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const inMonth = day.getMonth() === monthOf
          const isToday = sameDay(day, today)
          const k = dayKey(day)
          const evs = byDay.get(k) ?? []
          const shown = evs.slice(0, MAX_CHIPS)
          const overflow = evs.length - shown.length
          return (
            <button
              key={k}
              onClick={() => onPickDay(day)}
              className={`min-h-0 overflow-hidden border-b border-r border-border p-1 text-left hover:bg-surface-2/60 ${
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
                      key={item.itemUid + k}
                      title={
                        (ev.recurring ? '↻ recurring · ' : '') +
                        ev.summary +
                        (ev.location ? ` · ${ev.location}` : '')
                      }
                      className="flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-xs"
                      style={{ backgroundColor: 'var(--color-accent-soft)' }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorFor(item) }}
                      />
                      <span className="truncate">
                        {ev.recurring && '↻ '}
                        {!ev.allDay && ev.start && (
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
                  <div className="px-1 text-xs text-text-faint">
                    +{overflow} more
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
