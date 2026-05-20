import { useEffect, useRef } from 'react'

interface Props {
  showWeekNum: boolean
  onToggleWeekNum: () => void
  showTasks: boolean
  onToggleShowTasks: () => void
  zoomPct: number
  onZoom: (delta: number | 'reset') => void
  hourPx: number
  onHourPx: (delta: number | 'reset') => void
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
  zoomPct,
  onZoom,
  hourPx,
  onHourPx,
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
      <Row label="Overall zoom">
        <Stepper
          label="Overall zoom"
          value={`${zoomPct}%`}
          onDec={() => onZoom(-0.1)}
          onReset={() => onZoom('reset')}
          onInc={() => onZoom(0.1)}
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
        Elongates the day / week grid only; the overall zoom scales
        everything (sidebar, month grid, headers).
      </p>
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
