import type { EventItem } from '../../types'
import type { CalBirthday } from '../../services/birthdays'
import { dayKey, monthGridDays, sameDay } from '../../services/caldate'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function MiniMonth({
  year,
  month,
  byDay,
  birthdaysByDay,
  today,
  selected,
  onPickDay,
  onPickMonth,
}: {
  year: number
  month: number
  byDay: Map<string, EventItem[]>
  birthdaysByDay: Map<string, CalBirthday[]>
  today: Date
  selected: Date
  onPickDay: (d: Date) => void
  onPickMonth: (month: number) => void
}) {
  const anchor = new Date(year, month, 1)
  const days = monthGridDays(anchor)
  // Birthday count: only the days that actually fall in *this* month
  // (monthGridDays returns the leading/trailing days from the
  // neighbouring months for grid alignment; those would double-count).
  let bdayCount = 0
  for (const d of days) {
    if (d.getMonth() !== month) continue
    bdayCount += birthdaysByDay.get(dayKey(d))?.length ?? 0
  }
  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-1 flex items-center justify-between gap-1">
        <button
          onClick={() => onPickMonth(month)}
          className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-text-muted hover:text-accent"
        >
          {anchor.toLocaleDateString([], { month: 'long' })}
        </button>
        {bdayCount > 0 && (
          <span
            title={`${bdayCount} birthday${bdayCount === 1 ? '' : 's'} this month`}
            className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] tabular-nums text-text-muted"
          >
            <span aria-hidden>🎂</span> {bdayCount}
          </span>
        )}
      </div>
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
              } ${
                !isToday && sameDay(day, selected)
                  ? 'ring-1 ring-inset ring-accent'
                  : ''
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
  birthdaysByDay,
  today,
  selected,
  onPickDay,
  onPickMonth,
}: {
  year: number
  byDay: Map<string, EventItem[]>
  birthdaysByDay: Map<string, CalBirthday[]>
  today: Date
  selected: Date
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
          birthdaysByDay={birthdaysByDay}
          today={today}
          selected={selected}
          onPickDay={onPickDay}
          onPickMonth={onPickMonth}
        />
      ))}
    </div>
  )
}
