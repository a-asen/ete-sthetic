import { useState } from 'react'
import type { CollectionInfo } from '../../types'
import {
  dayKey,
  monthGridDays,
  sameDay,
  startOfDay,
} from '../../services/caldate'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Left rail: a compact month picker that drives the main view, plus the
// calendar list with per-calendar show/hide.
export function CalendarSidebar({
  anchor,
  today,
  rangeStart,
  rangeEnd,
  calendars,
  hidden,
  onToggle,
  onPickDay,
}: {
  anchor: Date
  today: Date
  rangeStart: Date
  rangeEnd: Date
  calendars: CollectionInfo[] | null
  hidden: Set<string>
  onToggle: (uid: string) => void
  onPickDay: (d: Date) => void
}) {
  // The mini-month can be paged independently of the main view. The parent
  // remounts this component (via a year-month key) when the main anchor's
  // month changes, so it snaps back without a setState-in-effect.
  const [miniMonth, setMiniMonth] = useState(
    () => new Date(anchor.getFullYear(), anchor.getMonth(), 1),
  )

  const days = monthGridDays(miniMonth)
  const lo = rangeStart.getTime()
  const hi = rangeEnd.getTime()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      {/* Mini-month */}
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() =>
              setMiniMonth(
                (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1),
              )
            }
            className="rounded px-1.5 text-text-muted hover:bg-surface-2"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="text-xs font-semibold text-text-muted">
            {miniMonth.toLocaleDateString([], {
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <button
            onClick={() =>
              setMiniMonth(
                (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1),
              )
            }
            className="rounded px-1.5 text-text-muted hover:bg-surface-2"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-px text-center text-[10px] text-text-faint">
          {DOW.map((d, i) => (
            <div key={i} className="pb-1">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.getMonth() === miniMonth.getMonth()
            const isToday = sameDay(day, today)
            const t = day.getTime()
            const inRange = t >= lo && t < hi
            return (
              <button
                key={dayKey(day)}
                onClick={() => onPickDay(startOfDay(day))}
                className={`aspect-square rounded-[3px] text-[11px] ${
                  isToday
                    ? 'bg-accent font-semibold text-bg'
                    : inRange
                      ? 'bg-accent-soft text-accent'
                      : inMonth
                        ? 'text-text-muted hover:bg-surface-2'
                        : 'text-text-faint/50 hover:bg-surface-2'
                }`}
              >
                {day.getDate()}
              </button>
            )
          })}
        </div>
      </div>

      {/* Calendar list */}
      <div className="flex-1 overflow-y-auto p-3 pb-16">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          Calendars
        </div>
        {calendars === null && (
          <div className="text-xs text-text-faint">Loading…</div>
        )}
        {calendars?.map((c) => {
          const on = !hidden.has(c.uid)
          return (
            <label
              key={c.uid}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(c.uid)}
                className="sr-only"
              />
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                  on ? 'border-transparent' : 'border-border-strong'
                }`}
                style={{
                  backgroundColor: on
                    ? (c.color ?? 'var(--color-accent)')
                    : 'transparent',
                }}
              >
                {on && (
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="var(--color-bg)"
                    strokeWidth="2.5"
                  >
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                  </svg>
                )}
              </span>
              <span
                className={`truncate ${on ? 'text-text' : 'text-text-faint'}`}
              >
                {c.name}
              </span>
            </label>
          )
        })}
      </div>
    </aside>
  )
}
