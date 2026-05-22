import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  addDays,
  mondayIndex,
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Date ⇄ "YYYY-MM-DD" — the value an <input type="date"> carries.
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fromIso(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

// Shift `d` by `n` whole months, clamping the day to the target month's
// length so Jan 31 → Feb 28 instead of overflowing into March.
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate()
  target.setDate(Math.min(d.getDate(), lastDay))
  return target
}

interface Props {
  // Current field value ("YYYY-MM-DD" or '').
  value: string
  // Fired with a "YYYY-MM-DD" string when the user commits a day.
  onPick: (iso: string) => void
  onClose: () => void
  // Clicks inside this element don't dismiss the popover — pass the field
  // row so the trigger button / inputs don't fight the outside-click.
  ignoreRef?: RefObject<HTMLElement | null>
  // Focused after an Enter/click pick or Esc (but not an outside-click
  // close, where focus should follow the click).
  returnFocusRef?: RefObject<HTMLElement | null>
}

// An arrow-key month grid layered on top of the native date input. The
// cursor lands on the current value, or today when unset — so a
// near-future deadline (the common case) is one or two keystrokes away.
export function CalendarPopover({
  value,
  onPick,
  onClose,
  ignoreRef,
  returnFocusRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => startOfDay(new Date()), [])
  // Cursor = the focused day. The grid always renders the cursor's
  // month, so crossing a month edge with the arrows scrolls the grid.
  const [cursor, setCursor] = useState<Date>(() => fromIso(value) ?? today)
  const days = useMemo(() => monthGridDays(cursor), [cursor])
  const monthOf = cursor.getMonth()
  const selected = useMemo(() => fromIso(value), [value])

  // Focus the grid on mount so the arrows drive it immediately, and pull
  // it fully into view (the Start field sits low in a scrolling panel).
  useLayoutEffect(() => {
    rootRef.current?.focus()
    rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  // Dismiss on outside click or window blur. Not on scroll: the popover
  // is absolutely positioned within the panel's scroll content, so it
  // stays anchored to its field as the panel scrolls.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (ignoreRef?.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, ignoreRef])

  function pick(d: Date) {
    onPick(toIso(d))
    returnFocusRef?.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const move = (d: Date) => {
      e.preventDefault()
      setCursor(d)
    }
    switch (e.key) {
      case 'ArrowLeft':
        return move(addDays(cursor, -1))
      case 'ArrowRight':
        return move(addDays(cursor, 1))
      case 'ArrowUp':
        return move(addDays(cursor, -7))
      case 'ArrowDown':
        return move(addDays(cursor, 7))
      case 'Home':
        return move(addDays(cursor, -mondayIndex(cursor)))
      case 'End':
        return move(addDays(cursor, 6 - mondayIndex(cursor)))
      case 'PageUp':
        return move(addMonths(cursor, e.shiftKey ? -12 : -1))
      case 'PageDown':
        return move(addMonths(cursor, e.shiftKey ? 12 : 1))
      case 't':
      case 'T':
        return move(today)
      case 'Enter':
        e.preventDefault()
        pick(cursor)
        return
      case 'Escape':
        e.preventDefault()
        returnFocusRef?.current?.focus()
        onClose()
        return
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Pick a date"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute left-0 top-full z-30 mt-1 w-60 rounded-md border border-border bg-surface p-2 shadow-xl outline-none"
    >
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setCursor(addMonths(cursor, -1))
            rootRef.current?.focus()
          }}
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
          onClick={() => {
            setCursor(addMonths(cursor, 1))
            rootRef.current?.focus()
          }}
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
              onClick={() => pick(d)}
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
          onClick={() => pick(today)}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          Today
        </button>
        <span className="text-[10px] text-text-faint">↵ pick · esc close</span>
      </div>
    </div>
  )
}
