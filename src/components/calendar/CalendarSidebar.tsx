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
  onExportCalendar,
  onImportCalendar,
  onRenameCalendar,
  onSyncCalendar,
  onCreateCalendar,
  onShowAllCalendars,
  onHideAllCalendars,
  syncingUids,
  showWeekNum,
  defaultCalUid,
  onSetDefaultCal,
  width,
  zoom,
  onResizeStart,
  isResizing,
}: {
  anchor: Date
  today: Date
  rangeStart: Date
  rangeEnd: Date
  calendars: CollectionInfo[] | null
  hidden: Set<string>
  onToggle: (uid: string) => void
  onPickDay: (d: Date) => void
  onExportCalendar: (uid: string) => void
  onImportCalendar: (uid: string) => void
  onRenameCalendar: (uid: string, name: string) => void
  onSyncCalendar: (uid: string) => void
  onCreateCalendar: (name: string) => void
  onShowAllCalendars: () => void
  onHideAllCalendars: () => void
  syncingUids: ReadonlySet<string>
  showWeekNum: boolean
  defaultCalUid: string
  onSetDefaultCal: (uid: string) => void
  width: number
  zoom: number
  onResizeStart: (e: React.MouseEvent) => void
  isResizing: boolean
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

  // Inline "+ New" for creating a calendar from the sidebar (mirrors
  // the tasks sidebar's affordance). When true, a name input appears
  // at the top of the calendar list; Enter commits via
  // onCreateCalendar, Esc / blur on empty cancels.
  const [creatingNew, setCreatingNew] = useState(false)
  const createRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (creatingNew) createRef.current?.focus()
  }, [creatingNew])

  // Typeahead filter for the calendar list. Stays empty by default; on
  // typing, only matching rows render. Case-insensitive substring.
  const [filter, setFilter] = useState('')

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
    <aside
      style={{ width, zoom }}
      className={`relative flex shrink-0 flex-col border-r border-border bg-surface ${
        isResizing ? 'select-none' : 'transition-[width] duration-200 ease-out'
      }`}
    >
      {/* Right-edge drag handle. Mirrors the task sidebar's resize. */}
      <div
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize calendar sidebar"
        title="Drag to resize"
        className="group absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
      >
        <div className="ml-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>
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
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            Calendars
          </span>
          <button
            type="button"
            onClick={() => setCreatingNew(true)}
            title="New calendar"
            aria-label="New calendar"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-[12px] leading-none text-text-faint hover:border-border-strong hover:text-text-muted"
          >
            +
          </button>
        </div>
        {calendars && calendars.length > 0 && (
          <div className="mb-2 space-y-1">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter calendars"
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text outline-none placeholder:text-text-faint focus:border-border-strong"
            />
            <div className="flex items-center justify-between text-[10px] text-text-faint">
              <button
                type="button"
                onClick={onShowAllCalendars}
                title="Show every calendar"
                className="rounded px-1 py-0.5 hover:bg-surface-2 hover:text-text-muted"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={onHideAllCalendars}
                title="Hide every calendar"
                className="rounded px-1 py-0.5 hover:bg-surface-2 hover:text-text-muted"
              >
                Hide all
              </button>
            </div>
          </div>
        )}
        {creatingNew && (
          <div className="mb-1 rounded-md border border-accent/60 bg-bg p-1.5">
            <input
              ref={createRef}
              type="text"
              placeholder="Calendar name"
              aria-label="New calendar name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const v = createRef.current?.value.trim() ?? ''
                  if (v) onCreateCalendar(v)
                  setCreatingNew(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCreatingNew(false)
                }
              }}
              onBlur={() => {
                const v = createRef.current?.value.trim() ?? ''
                if (v) onCreateCalendar(v)
                setCreatingNew(false)
              }}
              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-text outline-none focus:border-accent/40"
            />
          </div>
        )}
        {calendars === null && (
          <div className="text-xs text-text-faint">Loading…</div>
        )}
        {calendars
          ?.filter(
            (c) =>
              !filter.trim() ||
              c.name.toLowerCase().includes(filter.trim().toLowerCase()),
          )
          .map((c) => {
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
              {syncingUids.has(c.uid) && (
                <span
                  className="shrink-0 px-1 text-text-faint"
                  aria-label="Syncing"
                  title="Syncing…"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3 animate-spin"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                    <path d="M13.5 2.5v3h-3" />
                  </svg>
                </span>
              )}
              {/* Default-calendar indicator. Always shown when set,
                  since it's status not action — the toggle lives in
                  the hover cluster below. */}
              {isDefault && (
                <span
                  aria-hidden
                  title="Default calendar for new events"
                  className="shrink-0 px-1 text-accent"
                >
                  ★
                </span>
              )}
              {/* Per-row action cluster. Hidden entirely (no reserved
                  layout space) until the row is hovered or one of its
                  buttons gets keyboard focus — otherwise the cluster
                  ate ~120 px and the calendar name had to truncate
                  very aggressively. */}
              <div className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                {!syncingUids.has(c.uid) && (
                  <button
                    type="button"
                    onClick={() => onSyncCalendar(c.uid)}
                    title="Sync this calendar now"
                    aria-label={`Sync ${c.name}`}
                    className="rounded px-1 text-text-faint hover:bg-surface"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                      <path d="M13.5 2.5v3h-3" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRenamingUid(c.uid)}
                  title="Rename calendar"
                  aria-label={`Rename ${c.name}`}
                  className="rounded px-1 text-text-faint hover:bg-surface"
                >
                  ✎
                </button>
                {!isDefault && (
                  <button
                    type="button"
                    onClick={() => onSetDefaultCal(c.uid)}
                    title="Make this the default calendar for new events"
                    aria-label={`Make ${c.name} the default calendar for new events`}
                    aria-pressed={false}
                    className="rounded px-1 text-text-faint hover:bg-surface"
                  >
                    ☆
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onImportCalendar(c.uid)}
                  title="Import .ics into this calendar"
                  aria-label={`Import into ${c.name}`}
                  className="rounded px-1 text-text-faint hover:bg-surface"
                >
                  ↧
                </button>
                <button
                  type="button"
                  onClick={() => onExportCalendar(c.uid)}
                  title="Export this calendar to .ics"
                  aria-label={`Export ${c.name}`}
                  className="rounded px-1 text-text-faint hover:bg-surface"
                >
                  ↥
                </button>
              </div>
            </div>
          )
        })}

      </div>
    </aside>
  )
}
