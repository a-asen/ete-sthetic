import { useEffect, useRef } from 'react'
import { ModuleToggles } from '../ModuleToggles'

type CalSort = 'original' | 'name'

interface NightRange {
  startH: number
  endH: number
}

interface Props {
  showWeekNum: boolean
  onToggleWeekNum: () => void
  showTasks: boolean
  onToggleShowTasks: () => void
  // Independent zooms — sidebar (mini-month + calendar list) vs main
  // pane (toolbar + month/week grid).
  mainZoomPct: number
  onMainZoom: (delta: number | 'reset') => void
  sidebarZoomPct: number
  onSidebarZoom: (delta: number | 'reset') => void
  hourPx: number
  onHourPx: (delta: number | 'reset') => void
  // Calendar sort order in the sidebar list.
  sortBy: CalSort
  onSortBy: (v: CalSort) => void
  sortReverse: boolean
  onToggleSortReverse: () => void
  // Night-time hide. Ranges cross midnight (startH > endH means the
  // visible portion is [endH, startH]).
  nightHide: boolean
  onToggleNightHide: () => void
  nightWeekday: NightRange
  onSetNightWeekday: (v: NightRange) => void
  nightWeekend: NightRange
  onSetNightWeekend: (v: NightRange) => void
  onLogout: () => void
  onClose: () => void
}

// Display / sizing settings for the calendar — consolidates the toggles
// (week numbers, tasks overlay) and the two independent zooms (overall
// CSS zoom + time-grid elongation) in one popover. Mirrors the tasks
// SettingsPopover's structure and click-away / Esc behaviour.
export function CalendarSettingsPopover({
  showWeekNum,
  onToggleWeekNum,
  showTasks,
  onToggleShowTasks,
  mainZoomPct,
  onMainZoom,
  sidebarZoomPct,
  onSidebarZoom,
  hourPx,
  onHourPx,
  sortBy,
  onSortBy,
  sortReverse,
  onToggleSortReverse,
  nightHide,
  onToggleNightHide,
  nightWeekday,
  onSetNightWeekday,
  nightWeekend,
  onSetNightWeekend,
  onLogout,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Calendar settings"]')) return
      if (!ref.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Calendar settings popover"
      className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Display
      </p>
      <Row label="Week numbers">
        <Toggle
          on={showWeekNum}
          onClick={onToggleWeekNum}
          label="Week numbers"
        />
      </Row>
      <Row label="Tasks with due dates">
        <Toggle
          on={showTasks}
          onClick={onToggleShowTasks}
          label="Tasks with due dates"
        />
      </Row>

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Zoom
      </p>
      <Row label="Sidebar zoom">
        <Stepper
          label="Sidebar zoom"
          value={`${sidebarZoomPct}%`}
          onDec={() => onSidebarZoom(-0.1)}
          onReset={() => onSidebarZoom('reset')}
          onInc={() => onSidebarZoom(0.1)}
        />
      </Row>
      <Row label="Calendar zoom">
        <Stepper
          label="Calendar zoom"
          value={`${mainZoomPct}%`}
          onDec={() => onMainZoom(-0.1)}
          onReset={() => onMainZoom('reset')}
          onInc={() => onMainZoom(0.1)}
        />
      </Row>
      <Row label="Day / week height">
        <Stepper
          label="Day / week height"
          value={`${hourPx}px`}
          onDec={() => onHourPx(-6)}
          onReset={() => onHourPx('reset')}
          onInc={() => onHourPx(6)}
        />
      </Row>
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Day/week height elongates the time grid only. Sidebar and
        calendar zooms scale the rest independently.
      </p>

      <p className="px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Sort calendars
      </p>
      <Row label="Order">
        <select
          value={sortBy}
          onChange={(e) => onSortBy(e.target.value as CalSort)}
          aria-label="Sort calendars"
          className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          <option value="original">As listed</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </Row>
      <Row label="Reverse">
        <Toggle
          on={sortReverse}
          onClick={onToggleSortReverse}
          label="Reverse calendar sort"
        />
      </Row>

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Night hours
      </p>
      <Row label="Hide night in day/week view">
        <Toggle
          on={nightHide}
          onClick={onToggleNightHide}
          label="Hide night in day/week view"
        />
      </Row>
      <NightRangeRow
        label="Weekday (Mon–Fri)"
        value={nightWeekday}
        onChange={onSetNightWeekday}
      />
      <NightRangeRow
        label="Weekend (Sat–Sun)"
        value={nightWeekend}
        onChange={onSetNightWeekend}
      />
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Per-day overrides come later. A range must cross midnight
        (start later than end) to count.
      </p>

      <ModuleToggles />

      <div className="mt-1 border-t border-border">
        <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
          Account
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="block w-full px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

function NightRangeRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: NightRange
  onChange: (v: NightRange) => void
}) {
  const opts = Array.from({ length: 25 }, (_, i) => i)
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
        {label}
      </span>
      <select
        value={value.startH}
        onChange={(e) =>
          onChange({ ...value, startH: Number(e.target.value) })
        }
        aria-label={`${label} start`}
        className="rounded-md border border-border bg-surface-2 px-1 py-0.5 text-xs text-text outline-none focus:border-border-strong"
      >
        {opts.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </select>
      <span className="text-text-faint">→</span>
      <select
        value={value.endH}
        onChange={(e) => onChange({ ...value, endH: Number(e.target.value) })}
        aria-label={`${label} end`}
        className="rounded-md border border-border bg-surface-2 px-1 py-0.5 text-xs text-text outline-none focus:border-border-strong"
      >
        {opts.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </select>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on
          ? 'border-accent/50 bg-accent-soft'
          : 'border-border bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-4 bg-accent' : 'left-0.5 bg-text-faint'
        }`}
      />
    </button>
  )
}

function Stepper({
  label,
  value,
  onDec,
  onReset,
  onInc,
}: {
  label: string
  value: string
  onDec: () => void
  onReset: () => void
  onInc: () => void
}) {
  return (
    <span className="flex items-center rounded-md border border-border text-text-muted">
      <button
        type="button"
        onClick={onDec}
        aria-label={`Smaller ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={`Reset ${label}`}
        title="Reset"
        className="h-6 min-w-[3rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
      >
        {value}
      </button>
      <button
        type="button"
        onClick={onInc}
        aria-label={`Larger ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text"
      >
        +
      </button>
    </span>
  )
}
