import { useEffect, useRef, useState } from 'react'
import type { CollectionInfo } from '../../types'
import {
  dayKey,
  isoWeek,
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
  showTasks,
  onToggleTasks,
  onExportCalendar,
  onImportCalendar,
  onRenameCalendar,
  showWeekNum,
  onToggleWeekNum,
  defaultCalUid,
  onSetDefaultCal,
}: {
  anchor: Date
  today: Date
  rangeStart: Date
  rangeEnd: Date
  calendars: CollectionInfo[] | null
  hidden: Set<string>
  onToggle: (uid: string) => void
  onPickDay: (d: Date) => void
  showTasks: boolean
  onToggleTasks: () => void
  onExportCalendar: (uid: string) => void
  onImportCalendar: (uid: string) => void
  onRenameCalendar: (uid: string, name: string) => void
  showWeekNum: boolean
  onToggleWeekNum: () => void
  defaultCalUid: string
  onSetDefaultCal: (uid: string) => void
}) {
  // The mini-month can be paged independently of the main view. The parent
  // remounts this component (via a year-month key) when the main anchor's
  // month changes, so it snaps back without a setState-in-effect.
  const [miniMonth, setMiniMonth] = useState(
    () => new Date(anchor.getFullYear(), anchor.getMonth(), 1),
  )
  const [renamingUid, setRenamingUid] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renamingUid) renameRef.current?.select()
  }, [renamingUid])

  const commitRename = (uid: string) => {
    const v = renameRef.current?.value.trim() ?? ''
    setRenamingUid(null)
    if (!v) return
    const current = calendars?.find((c) => c.uid === uid)
    if (!current || v === current.name) return
    onRenameCalendar(uid, v)
  }

  const days = monthGridDays(miniMonth)
  const lo = rangeStart.getTime()
  const hi = rangeEnd.getTime()
  // 6 weeks × 7 days; chunked here so we can render an optional
  // leading week-number cell per row when showWeekNum is on.
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

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
        <div
          className={`grid gap-px text-center text-[10px] text-text-faint ${
            showWeekNum ? 'grid-cols-8' : 'grid-cols-7'
          }`}
        >
          {showWeekNum && <div className="pb-1" />}
          {DOW.map((d, i) => (
            <div key={i} className="pb-1">
              {d}
            </div>
          ))}
          {weeks.flatMap((week) => [
            ...(showWeekNum
              ? [
                  <div
                    key={`wk-${dayKey(week[0])}`}
                    className="flex aspect-square items-center justify-center tabular-nums opacity-70"
                  >
                    {isoWeek(week[0])}
                  </div>,
                ]
              : []),
            ...week.map((day) => {
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
          }),
          ])}
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
          const isDefault = c.uid === defaultCalUid
          return (
            <div
              key={c.uid}
              className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
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
                {renamingUid === c.uid ? (
                  <input
                    ref={renameRef}
                    type="text"
                    defaultValue={c.name}
                    onClick={(e) => {
                      // Don't toggle the visibility checkbox while typing.
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename(c.uid)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setRenamingUid(null)
                      }
                    }}
                    onBlur={() => commitRename(c.uid)}
                    aria-label={`Rename ${c.name}`}
                    className="min-w-0 flex-1 rounded border border-accent/60 bg-bg px-1 py-0.5 text-sm text-text outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenamingUid(c.uid)
                    }}
                    title="Double-click to rename"
                    className={`truncate ${
                      isDefault
                        ? 'font-medium text-accent'
                        : on
                          ? 'text-text'
                          : 'text-text-faint'
                    }`}
                  >
                    {c.name}
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={() => setRenamingUid(c.uid)}
                title="Rename calendar"
                aria-label={`Rename ${c.name}`}
                className="shrink-0 rounded px-1 text-text-faint opacity-0 hover:bg-surface focus-visible:opacity-100 group-hover:opacity-100"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => onSetDefaultCal(c.uid)}
                title={
                  isDefault
                    ? 'New events default to this calendar'
                    : 'Make this the default calendar for new events'
                }
                aria-label={`Make ${c.name} the default calendar for new events`}
                aria-pressed={isDefault}
                className={`shrink-0 rounded px-1 hover:bg-surface ${
                  isDefault
                    ? 'text-accent'
                    : 'text-text-faint opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                }`}
              >
                {isDefault ? '★' : '☆'}
              </button>
              <button
                type="button"
                onClick={() => onImportCalendar(c.uid)}
                title="Import .ics into this calendar"
                aria-label={`Import into ${c.name}`}
                className="shrink-0 rounded px-1 text-text-faint opacity-0 hover:bg-surface focus-visible:opacity-100 group-hover:opacity-100"
              >
                ↧
              </button>
              <button
                type="button"
                onClick={() => onExportCalendar(c.uid)}
                title="Export this calendar to .ics"
                aria-label={`Export ${c.name}`}
                className="shrink-0 rounded px-1 text-text-faint opacity-0 hover:bg-surface focus-visible:opacity-100 group-hover:opacity-100"
              >
                ↥
              </button>
            </div>
          )
        })}

        <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          Overlays
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={onToggleTasks}
            className="sr-only"
          />
          <span
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
              showTasks ? 'border-transparent bg-accent' : 'border-border-strong'
            }`}
          >
            {showTasks && (
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
          <span className={showTasks ? 'text-text' : 'text-text-faint'}>
            Tasks with due dates
          </span>
        </label>

        <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          Display
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
          <input
            type="checkbox"
            checked={showWeekNum}
            onChange={onToggleWeekNum}
            className="sr-only"
          />
          <span
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
              showWeekNum
                ? 'border-transparent bg-accent'
                : 'border-border-strong'
            }`}
          >
            {showWeekNum && (
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
          <span className={showWeekNum ? 'text-text' : 'text-text-faint'}>
            Week numbers
          </span>
        </label>
      </div>
    </aside>
  )
}
