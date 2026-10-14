import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  addMonths,
  fromIsoDate,
  monthGridDays,
  sameDay,
  startOfDay,
} from '../services/caldate'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface Props {
  // Current field value ("YYYY-MM-DD" or '') — softly highlighted.
  value: string
  // The grid cursor day; the grid always renders the cursor's month.
  cursor: Date
  onCursorChange: (d: Date) => void
  // A day was clicked — the field commits it and closes.
  onPick: (d: Date) => void
}

// Month grid for the date fields' popover (DateField). Presentational
// only: the owning field keeps keyboard focus in its text input and
// drives the cursor from there (arrows / PageUp/Down / t / Enter), so
// picking is one click or keystroke with no focus juggling. All buttons
// swallow mousedown so clicking around the grid never blurs the input
// mid-typing.
export function CalendarPopover({ value, cursor, onCursorChange, onPick }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => startOfDay(new Date()), [])
  const days = useMemo(() => monthGridDays(cursor), [cursor])
  const monthOf = cursor.getMonth()
  const selected = useMemo(() => fromIsoDate(value), [value])

  // Pull fully into view on mount (e.g. the Start field sits low in a
  // scrolling panel).
  useLayoutEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  // Keeping focus in the input beats native button focus.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div
      ref={rootRef}
      role="dialog"
      data-date-popover="true"
      aria-label="Pick a date"
      className="absolute left-0 top-full z-30 mt-1 w-60 rounded-md border border-border bg-surface p-2 shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => onCursorChange(addMonths(cursor, -1))}
          aria-label="Previous month"
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
        >
          ‹
        </button>
        <span className="text-xs font-semibold text-text">
          {MONTHS[monthOf]} {cursor.getFullYear()}
        </span>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => onCursorChange(addMonths(cursor, 1))}
          aria-label="Next month"
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[10px] font-medium text-text-faint"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = d.getMonth() === monthOf
          const isToday = sameDay(d, today)
          const isCursor = sameDay(d, cursor)
          const isSelected = selected != null && sameDay(d, selected)
          return (
            <button
              key={d.getTime()}
              type="button"
              tabIndex={-1}
              onMouseDown={keepFocus}
              onClick={() => onPick(d)}
              className={`flex h-7 items-center justify-center rounded text-xs tabular-nums transition-colors ${
                inMonth ? 'text-text' : 'text-text-faint'
              } ${
                isCursor
                  ? 'bg-accent font-semibold text-bg'
                  : isSelected
                    ? 'bg-accent-soft text-text'
                    : 'hover:bg-surface-2'
              } ${
                isToday && !isCursor ? 'ring-1 ring-inset ring-accent' : ''
              }`}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => onPick(today)}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          Today
        </button>
        <span className="text-[10px] text-text-faint">↵ pick · esc close</span>
      </div>
    </div>
  )
}