import type { EventItem } from '../../types'
import { dayKey, monthGridDays, sameDay } from '../../services/caldate'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function MiniMonth({
  year,
  month,
  byDay,
  today,
  onPickDay,
  onPickMonth,
}: {
  year: number
  month: number
  byDay: Map<string, EventItem[]>
  today: Date
  onPickDay: (d: Date) => void
  onPickMonth: (month: number) => void
}) {
  const anchor = new Date(year, month, 1)
  const days = monthGridDays(anchor)
  return (
    <div className="rounded-md border border-border p-2">
      <button
        onClick={() => onPickMonth(month)}
        className="mb-1 w-full text-left text-xs font-semibold text-text-muted hover:text-accent"
      >
        {anchor.toLocaleDateString([], { month: 'long' })}
      </button>
      <div className="grid grid-cols-7 gap-px text-center text-[9px] text-text-faint">
        {DOW.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === month
          const isToday = sameDay(day, today)
          const has = (byDay.get(dayKey(day))?.length ?? 0) > 0
          return (
            <button
              key={dayKey(day)}
              onClick={() => onPickDay(day)}
              className={`relative aspect-square rounded-[3px] text-[10px] hover:bg-surface-2 ${
                isToday
                  ? 'bg-accent font-semibold text-bg'
                  : inMonth
                    ? 'text-text-muted'
                    : 'text-text-faint/50'
              }`}
            >
              {day.getDate()}
              {has && !isToday && (
                <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function YearGrid({
  year,
  byDay,
  today,
  onPickDay,
  onPickMonth,
}: {
  year: number
  byDay: Map<string, EventItem[]>
  today: Date
  onPickDay: (d: Date) => void
  onPickMonth: (month: number) => void
}) {
  return (
    <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth
          key={m}
          year={year}
          month={m}
          byDay={byDay}
          today={today}
          onPickDay={onPickDay}
          onPickMonth={onPickMonth}
        />
      ))}
    </div>
  )
}
