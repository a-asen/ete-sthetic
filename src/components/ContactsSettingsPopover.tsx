import { useEffect, useRef, useState } from 'react'
import {
  HINTS_CHANGED_EVENT,
  readHintsEnabled,
  setHintsEnabled,
} from '../services/hints'

interface Props {
  booksZoomPct: number
  onBooksZoom: (delta: number | 'reset') => void
  listZoomPct: number
  onListZoom: (delta: number | 'reset') => void
  detailZoomPct: number
  onDetailZoom: (delta: number | 'reset') => void
  activeSyncMin: number
  activeSyncOptions: readonly number[]
  onSetActiveSync: (min: number) => void
  bgSyncMin: number
  bgSyncOptions: readonly number[]
  onSetBgSync: (min: number) => void
  switchFreshMin: number
  switchFreshOptions: readonly number[]
  onSetSwitchFresh: (min: number) => void
  onLogout: () => void
  onClose: () => void
}

function durLabel(min: number): string {
  if (min <= 0) return 'Off'
  if (min < 60) return `${min} min`
  const h = min / 60
  return `${h} h`
}

function freshLabel(min: number): string {
  if (min <= 0) return 'Always'
  return durLabel(min)
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

function SyncRow({
  label,
  value,
  options,
  onChange,
  labelFn,
}: {
  label: string
  value: number
  options: readonly number[]
  onChange: (n: number) => void
  labelFn: (n: number) => string
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {labelFn(m)}
          </option>
        ))}
      </select>
    </Row>
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

function ZoomRow({
  label,
  pct,
  onZoom,
}: {
  label: string
  pct: number
  onZoom: (delta: number | 'reset') => void
}) {
  return (
    <Row label={label}>
      <span className="flex items-center rounded-md border border-border text-text-muted">
        <button
          type="button"
          onClick={() => onZoom(-0.1)}
          aria-label={`Smaller ${label}`}
          className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text"
        >
          A−
        </button>
        <button
          type="button"
          onClick={() => onZoom('reset')}
          aria-label={`Reset ${label}`}
          title="Reset"
          className="h-6 min-w-[2.75rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
        >
          {pct}%
        </button>
        <button
          type="button"
          onClick={() => onZoom(0.1)}
          aria-label={`Larger ${label}`}
          className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text"
        >
          A+
        </button>
      </span>
    </Row>
  )
}

// Settings popover for the contacts module. Mirrors the tasks-pane
// SettingsPopover's layout — owns its own Esc / click-away dismissal —
// but starts narrow: just the three per-zone zoom rows. Adaptive-sync
// cadence and other contacts controls can slot in as later rows.
export function ContactsSettingsPopover({
  booksZoomPct,
  onBooksZoom,
  listZoomPct,
  onListZoom,
  detailZoomPct,
  onDetailZoom,
  activeSyncMin,
  activeSyncOptions,
  onSetActiveSync,
  bgSyncMin,
  bgSyncOptions,
  onSetBgSync,
  switchFreshMin,
  switchFreshOptions,
  onSetSwitchFresh,
  onLogout,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hintsOn, setHintsOn] = useState(readHintsEnabled)
  // Keep this popover's toggle in sync if hints get flipped elsewhere
  // (e.g. the tasks-module settings popover) while this one is open.
  useEffect(() => {
    const refresh = () => setHintsOn(readHintsEnabled())
    window.addEventListener(HINTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(HINTS_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Contacts settings"]')) return
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
      aria-label="Contacts settings"
      className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Zoom
      </p>
      <ZoomRow
        label="Address books"
        pct={booksZoomPct}
        onZoom={onBooksZoom}
      />
      <ZoomRow label="Contact list" pct={listZoomPct} onZoom={onListZoom} />
      <ZoomRow label="Detail" pct={detailZoomPct} onZoom={onDetailZoom} />

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Sync
      </p>
      <SyncRow
        label="Active book every"
        value={activeSyncMin}
        options={activeSyncOptions}
        onChange={onSetActiveSync}
        labelFn={durLabel}
      />
      <SyncRow
        label="Other books every"
        value={bgSyncMin}
        options={bgSyncOptions}
        onChange={onSetBgSync}
        labelFn={durLabel}
      />
      <SyncRow
        label="On open if older than"
        value={switchFreshMin}
        options={switchFreshOptions}
        onChange={onSetSwitchFresh}
        labelFn={freshLabel}
      />

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Help
      </p>
      <Row label="Show usage hints">
        <Toggle
          on={hintsOn}
          onClick={() => setHintsEnabled(!hintsOn)}
          label="Show usage hints"
        />
      </Row>

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
