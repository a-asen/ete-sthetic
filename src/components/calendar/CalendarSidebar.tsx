import { useEffect, useRef, useState } from 'react'
import type { CollectionInfo } from '../../types'
import { ContextMenu, type ContextMenuState } from '../ContextMenu'
import { formatSyncAge } from '../../services/syncStatus'
import {
  REFRESH_OPTIONS,
  refreshLabel,
  type IcsSubscription,
} from '../../services/icsSubscriptions'
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
  locked,
  onToggle,
  onToggleLock,
  onPickDay,
  onExportCalendar,
  onImportCalendar,
  onRenameCalendar,
  onSetCalendarColor,
  onDeleteCalendar,
  onSyncCalendar,
  onSyncAllCalendars,
  lastSyncedAt,
  anySyncing,
  onCreateCalendar,
  onShowAllCalendars,
  onHideAllCalendars,
  showDeleted,
  onToggleShowDeleted,
  syncingUids,
  showWeekNum,
  defaultCalUid,
  onSetDefaultCal,
  subscriptions,
  hiddenSubs,
  syncingSubIds,
  onToggleSub,
  onAddSubscription,
  onRenameSubscription,
  onRemoveSubscription,
  onSyncSubscription,
  onUpdateSubscription,
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
  // Calendars locked against edits. Shown with a 🔒 indicator; the
  // hover-cluster toggle flips the lock.
  locked: ReadonlySet<string>
  onToggle: (uid: string) => void
  onToggleLock: (uid: string) => void
  onPickDay: (d: Date) => void
  onExportCalendar: (uid: string) => void
  onImportCalendar: (uid: string) => void
  onRenameCalendar: (uid: string, name: string) => void
  // Recolour a calendar; undefined clears back to the app accent.
  onSetCalendarColor: (uid: string, color: string | undefined) => void
  onDeleteCalendar: (uid: string) => void
  onSyncCalendar: (uid: string) => void
  // Module-level "sync all calendars" + last-synced time for the header.
  onSyncAllCalendars: () => void
  lastSyncedAt: number | null
  anySyncing: boolean
  onCreateCalendar: (name: string) => void
  onShowAllCalendars: () => void
  onHideAllCalendars: () => void
  // Surface server-side tombstones (deleted calendars) in the list,
  // badged and read-only. Mirrors the tasks sidebar.
  showDeleted: boolean
  onToggleShowDeleted: () => void
  syncingUids: ReadonlySet<string>
  showWeekNum: boolean
  defaultCalUid: string
  onSetDefaultCal: (uid: string) => void
  subscriptions: IcsSubscription[]
  hiddenSubs: ReadonlySet<string>
  syncingSubIds: ReadonlySet<string>
  onToggleSub: (id: string) => void
  onAddSubscription: (url: string) => void
  onRenameSubscription: (id: string, name: string) => void
  onRemoveSubscription: (id: string) => void
  onSyncSubscription: (id: string) => void
  // Patch arbitrary subscription fields (colour, refresh cadence).
  // Reuses the existing `updateSubscription` in CalendarView for the
  // localStorage write + state mirror.
  onUpdateSubscription: (
    id: string,
    patch: Partial<Pick<IcsSubscription, 'color' | 'refreshMinutes'>>,
  ) => void
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
  // Subscription rename runs through its own input ref so it doesn't
  // clash with calendar-rename when both panels render together.
  const [renamingSubId, setRenamingSubId] = useState<string | null>(null)
  const subRenameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renamingSubId) subRenameRef.current?.select()
  }, [renamingSubId])
  // Per-subscription inline editor — colour swatch + refresh cadence
  // dropdown. Opens via the row's hover-cluster ⚙ button. One row at a
  // time so the layout doesn't shift around the sidebar.
  const [editingSubId, setEditingSubId] = useState<string | null>(null)
  // Inline URL form for adding a new subscription. Mirrors the
  // "+ New calendar" affordance but takes a URL instead of a name —
  // the name is auto-suggested from the URL on commit.
  const [addingSub, setAddingSub] = useState(false)
  const addSubRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (addingSub) addSubRef.current?.focus()
  }, [addingSub])

  const commitSubRename = (id: string) => {
    const v = subRenameRef.current?.value.trim() ?? ''
    setRenamingSubId(null)
    if (!v) return
    const cur = subscriptions.find((s) => s.id === id)
    if (!cur || v === cur.name) return
    onRenameSubscription(id, v)
  }

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

  // Tick so the "Synced … ago" label stays current without a sync.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Per-calendar action menu. The row used to carry ~7 always-on hover
  // icons (sync / rename / lock / default / import / export / delete),
  // which got cramped and crowded the calendar name. They now live in a
  // right-click menu (also reachable via the row's ⋯ button), leaving the
  // row to its checkbox + status glyphs.
  const [calMenu, setCalMenu] = useState<ContextMenuState | null>(null)
  // Anchored colour picker for a calendar, opened from the action menu.
  const [colorEdit, setColorEdit] = useState<{
    uid: string
    x: number
    y: number
  } | null>(null)

  const openCalMenu = (e: React.MouseEvent, c: CollectionInfo) => {
    e.preventDefault()
    e.stopPropagation()
    const syncing = syncingUids.has(c.uid)
    const isLocked = locked.has(c.uid)
    const isDefault = c.uid === defaultCalUid
    setCalMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: syncing ? 'Syncing…' : 'Sync now',
          disabled: syncing,
          onSelect: () => onSyncCalendar(c.uid),
        },
        { label: 'Rename', onSelect: () => setRenamingUid(c.uid) },
        {
          label: 'Change colour…',
          onSelect: () =>
            setColorEdit({ uid: c.uid, x: e.clientX, y: e.clientY }),
        },
        ...(isDefault
          ? []
          : [
              {
                label: 'Make default',
                onSelect: () => onSetDefaultCal(c.uid),
              },
            ]),
        {
          label: isLocked ? 'Unlock (allow edits)' : 'Lock (read-only)',
          onSelect: () => onToggleLock(c.uid),
        },
        { label: 'Import .ics…', onSelect: () => onImportCalendar(c.uid) },
        { label: 'Export .ics…', onSelect: () => onExportCalendar(c.uid) },
        {
          label: 'Delete',
          danger: true,
          onSelect: () => onDeleteCalendar(c.uid),
        },
      ],
    })
  }

  // Resizable split between the mini-month and the calendar list. The
  // month grid is fixed-content, so dragging the divider sets a capped
  // height on it (overflow hidden) — drag up to shrink the month and give
  // the calendar list more room, down to reveal the full month. Persisted
  // to localStorage and seeded on init so it survives the per-month
  // remount (this component is re-keyed when the anchor month changes).
  const MONTH_H_KEY = 'cal.sidebarMonthHeight'
  const [monthH, setMonthH] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(MONTH_H_KEY)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      return null
    }
  })
  const monthRef = useRef<HTMLDivElement>(null)
  const startMonthResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = monthRef.current?.getBoundingClientRect().height ?? 240
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(110, Math.min(560, startH + (ev.clientY - startY)))
      setMonthH(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMonthH((h) => {
        if (h != null) {
          try {
            localStorage.setItem(MONTH_H_KEY, String(h))
          } catch {
            // Non-fatal — size just won't persist.
          }
        }
        return h
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

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
      <div
        ref={monthRef}
        className="shrink-0 overflow-y-auto border-b border-border p-3"
        style={monthH != null ? { height: monthH } : undefined}
      >
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

      {/* Drag handle to resize the month / calendar-list split. */}
      <div
        onMouseDown={startMonthResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize month / calendar list split"
        title="Drag to resize"
        className="group h-1.5 shrink-0 cursor-ns-resize"
      >
        <div className="h-px w-full bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>

      {/* Calendar list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-16">
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            Calendars
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onSyncAllCalendars}
              disabled={anySyncing}
              title={
                lastSyncedAt
                  ? `${formatSyncAge(lastSyncedAt, now)} · sync all calendars`
                  : 'Sync all calendars'
              }
              aria-label="Sync all calendars"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-text-faint hover:border-border-strong hover:text-text-muted disabled:cursor-not-allowed"
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-3 w-3 ${anySyncing ? 'animate-spin' : ''}`}
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
        </div>
        <p className="mb-2 text-[10px] text-text-faint">
          {anySyncing
            ? 'Syncing…'
            : lastSyncedAt
              ? formatSyncAge(lastSyncedAt, now)
              : 'Not synced yet'}
        </p>
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
              <button
                type="button"
                onClick={onToggleShowDeleted}
                title={
                  showDeleted
                    ? 'Hide deleted calendars'
                    : 'Show deleted calendars'
                }
                aria-pressed={showDeleted}
                className={`rounded px-1 py-0.5 hover:bg-surface-2 ${
                  showDeleted ? 'text-accent' : 'hover:text-text-muted'
                }`}
              >
                {showDeleted ? 'Hide deleted' : 'Show deleted'}
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
          const isLocked = locked.has(c.uid)
          // Tombstones are display-only: no visibility / lock / edit
          // affordances, just a badged, muted row so the user can see what
          // was deleted (mirrors the tasks sidebar).
          if (c.isDeleted) {
            return (
              <div
                key={c.uid}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-faint"
              >
                <span aria-hidden className="shrink-0 px-0.5">
                  🗑
                </span>
                <span className="min-w-0 flex-1 truncate line-through">
                  {c.name || '(untitled)'}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider">
                  deleted
                </span>
              </div>
            )
          }
          return (
            <div
              key={c.uid}
              onContextMenu={(e) => openCalMenu(e, c)}
              className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
            >
              {/* Visibility toggle as an explicit checkbox-role element.
                  Using onClick (primary-button only) instead of a
                  <label>+checkbox means a right/middle click never toggles
                  — it falls through to the row's context menu. */}
              <div
                role="checkbox"
                aria-checked={on}
                aria-label={`Toggle ${c.name}`}
                tabIndex={0}
                onClick={() => {
                  if (renamingUid !== c.uid) onToggle(c.uid)
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    renamingUid !== c.uid
                  ) {
                    e.preventDefault()
                    onToggle(c.uid)
                  }
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 outline-none"
              >
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
              </div>
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
              {/* Lock indicator. Status, not action — shown whenever the
                  calendar is locked so the read-only state is visible
                  without hovering. The toggle lives in the hover cluster. */}
              {isLocked && (
                <span
                  aria-hidden
                  title="Locked — events are read-only"
                  className="shrink-0 px-1 text-text-faint"
                >
                  🔒
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
              {/* All per-row actions now live in a right-click menu;
                  this ⋯ button (shown on hover / focus) is the
                  discoverable entry point for pointer users. */}
              <button
                type="button"
                onClick={(e) => openCalMenu(e, c)}
                title="Calendar actions (or right-click the row)"
                aria-label={`Actions for ${c.name}`}
                className="hidden shrink-0 rounded px-1 text-text-faint hover:bg-surface group-hover:block group-focus-within:block"
              >
                ⋯
              </button>
            </div>
          )
        })}

        {/* Subscriptions: read-only remote ICS feeds. Kept below the
            etebase calendar list so the user's editable calendars
            stay above the fold. */}
        <div className="mt-4 mb-2 flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            Subscriptions
          </span>
          <button
            type="button"
            onClick={() => setAddingSub(true)}
            title="Add subscription (ICS URL)"
            aria-label="Add subscription"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-[12px] leading-none text-text-faint hover:border-border-strong hover:text-text-muted"
          >
            +
          </button>
        </div>
        {addingSub && (
          <div className="mb-1 rounded-md border border-accent/60 bg-bg p-1.5">
            <input
              ref={addSubRef}
              type="url"
              placeholder="https://… (.ics URL)"
              aria-label="Subscription URL"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const v = addSubRef.current?.value.trim() ?? ''
                  if (v) onAddSubscription(v)
                  setAddingSub(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setAddingSub(false)
                }
              }}
              onBlur={() => {
                const v = addSubRef.current?.value.trim() ?? ''
                if (v) onAddSubscription(v)
                setAddingSub(false)
              }}
              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-text outline-none focus:border-accent/40"
            />
          </div>
        )}
        {subscriptions.length === 0 && !addingSub && (
          <p className="px-1.5 text-xs text-text-faint">
            None yet. Add a public ICS URL.
          </p>
        )}
        {subscriptions.map((s) => {
          const on = !hiddenSubs.has(s.id)
          const swatch = s.color || 'var(--color-accent)'
          const syncing = syncingSubIds.has(s.id)
          const editing = editingSubId === s.id
          return (
            <div
              key={s.id}
              className="group rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
            >
              <div className="flex items-center gap-1">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggleSub(s.id)}
                  className="sr-only"
                />
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                    on ? 'border-transparent' : 'border-border-strong'
                  }`}
                  style={{
                    backgroundColor: on ? swatch : 'transparent',
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
                {renamingSubId === s.id ? (
                  <input
                    ref={subRenameRef}
                    type="text"
                    defaultValue={s.name}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitSubRename(s.id)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setRenamingSubId(null)
                      }
                    }}
                    onBlur={() => commitSubRename(s.id)}
                    aria-label={`Rename ${s.name}`}
                    className="min-w-0 flex-1 rounded border border-accent/60 bg-bg px-1 py-0.5 text-sm text-text outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenamingSubId(s.id)
                    }}
                    title={s.url}
                    className={`truncate ${
                      on ? 'text-text' : 'text-text-faint'
                    }`}
                  >
                    {s.name || s.url}
                  </span>
                )}
              </label>
              {syncing && (
                <span
                  className="shrink-0 px-1 text-text-faint"
                  aria-label="Syncing subscription"
                  title="Fetching…"
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
              {s.lastError && !syncing && (
                <button
                  type="button"
                  onClick={() => onSyncSubscription(s.id)}
                  title={`Last fetch failed: ${s.lastError}. Click to retry.`}
                  aria-label={`Retry ${s.name}`}
                  className="shrink-0 px-1 text-danger hover:text-danger/80"
                >
                  ⚠
                </button>
              )}
              <div className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                {!syncing && (
                  <button
                    type="button"
                    onClick={() => onSyncSubscription(s.id)}
                    title="Refetch this subscription now"
                    aria-label={`Sync ${s.name}`}
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
                  onClick={() => setRenamingSubId(s.id)}
                  title="Rename subscription"
                  aria-label={`Rename ${s.name}`}
                  className="rounded px-1 text-text-faint hover:bg-surface"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditingSubId(editing ? null : s.id)
                  }
                  title="Subscription settings (colour, refresh cadence)"
                  aria-label={`Edit ${s.name}`}
                  aria-expanded={editing}
                  className={`rounded px-1 hover:bg-surface ${
                    editing ? 'text-accent' : 'text-text-faint'
                  }`}
                >
                  ⚙
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSubscription(s.id)}
                  title="Remove subscription"
                  aria-label={`Remove ${s.name}`}
                  className="rounded px-1 text-text-faint hover:bg-surface hover:text-danger"
                >
                  ×
                </button>
              </div>
              </div>
              {editing && (
                <SubEditor
                  sub={s}
                  onChange={(patch) => onUpdateSubscription(s.id, patch)}
                  onClose={() => setEditingSubId(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      {calMenu && (
        <ContextMenu menu={calMenu} onClose={() => setCalMenu(null)} />
      )}

      {colorEdit && (
        <CalendarColorPicker
          x={colorEdit.x}
          y={colorEdit.y}
          current={
            calendars?.find((c) => c.uid === colorEdit.uid)?.color
          }
          onPick={(color) => {
            onSetCalendarColor(colorEdit.uid, color)
            setColorEdit(null)
          }}
          onClose={() => setColorEdit(null)}
        />
      )}
    </aside>
  )
}

// Curated calendar swatches (muted to fit the theme), plus a custom hex
// field and a "clear to accent" option.
const CAL_COLORS = [
  '#d96f6f',
  '#d99a4e',
  '#d9c84e',
  '#6fb86f',
  '#4ea7a7',
  '#5e8fd9',
  '#9a7fd9',
  '#c97fb8',
  '#8a8f99',
] as const

function CalendarColorPicker({
  x,
  y,
  current,
  onPick,
  onClose,
}: {
  x: number
  y: number
  current: string | undefined
  onPick: (color: string | undefined) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hex, setHex] = useState(
    current && /^#[0-9a-fA-F]{6}$/.test(current) ? current : '#6fb86f',
  )
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  // Clamp into the viewport.
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 160)
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Calendar colour"
      style={{ left, top }}
      className="fixed z-[60] w-48 rounded-md border border-border bg-surface p-2 shadow-xl"
    >
      <div className="flex flex-wrap gap-1.5">
        {CAL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            title={c}
            aria-label={`Set colour ${c}`}
            className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
              current?.toLowerCase() === c ? 'border-text' : 'border-border'
            }`}
            style={{ background: c }}
          />
        ))}
        <button
          type="button"
          onClick={() => onPick(undefined)}
          title="Use accent default"
          aria-label="Clear colour"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] text-text-faint hover:border-border-strong hover:text-text-muted"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <input
          type="color"
          value={hexValid ? hex : '#6fb86f'}
          onChange={(e) => setHex(e.target.value)}
          aria-label="Custom calendar colour"
          className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        <input
          type="text"
          value={hex}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hexValid) onPick(hex.toLowerCase())
          }}
          aria-label="Custom colour hex"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-0.5 font-mono text-[11px] text-text outline-none focus:border-border-strong"
        />
        <button
          type="button"
          disabled={!hexValid}
          onClick={() => onPick(hex.toLowerCase())}
          className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Set
        </button>
      </div>
    </div>
  )
}


// Curated colour swatches for subscription rows. Same palette mood as
// the accent presets — leans cool/saturated so the row reads as
// "subscription" rather than blending with the etebase calendars.
const SUB_COLOURS = [
  '#2f8a6c',
  '#4a8cff',
  '#d97757',
  '#b85ad9',
  '#d9b03a',
  '#5a7f9c',
  '#c0392b',
] as const

function SubEditor({
  sub,
  onChange,
  onClose,
}: {
  sub: IcsSubscription
  onChange: (
    patch: Partial<Pick<IcsSubscription, 'color' | 'refreshMinutes'>>,
  ) => void
  onClose: () => void
}) {
  const [hex, setHex] = useState(
    sub.color && /^#[0-9a-fA-F]{6}$/.test(sub.color) ? sub.color : '#2f8a6c',
  )
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex)
  return (
    <div className="mt-1 space-y-2 rounded-md border border-border bg-surface-2/60 p-2">
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-text-faint">
          Colour
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {SUB_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ color: c })}
              title={c}
              aria-label={`Set colour ${c}`}
              className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                sub.color === c ? 'border-text' : 'border-border'
              }`}
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange({ color: '' })}
            title="Use accent default"
            aria-label="Accent default colour"
            className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] transition-colors ${
              !sub.color
                ? 'border-text text-text'
                : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
            }`}
          >
            ✕
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            aria-label="Custom subscription colour"
            className="h-5 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
          />
          <input
            type="text"
            value={hex}
            spellCheck={false}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hexValid) {
                e.preventDefault()
                onChange({ color: hex.toLowerCase() })
              }
            }}
            aria-label="Custom subscription colour hex"
            className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-0.5 font-mono text-[11px] text-text outline-none focus:border-border-strong"
          />
          <button
            type="button"
            disabled={!hexValid}
            onClick={() => onChange({ color: hex.toLowerCase() })}
            className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-text-faint">
          Refresh every
        </p>
        <select
          value={sub.refreshMinutes}
          onChange={(e) =>
            onChange({ refreshMinutes: Number(e.target.value) })
          }
          aria-label="Subscription refresh cadence"
          className="w-full rounded border border-border bg-bg px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          {REFRESH_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {refreshLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface hover:text-text"
        >
          Done
        </button>
      </div>
    </div>
  )
}
