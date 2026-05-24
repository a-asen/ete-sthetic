import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../services/theme'
import {
  HINTS_CHANGED_EVENT,
  readHintsEnabled,
  setHintsEnabled,
} from '../services/hints'
import { ModuleToggles } from './ModuleToggles'
import { InactiveOpacitySettings } from './InactiveOpacitySettings'
import {
  TASK_ROW_SETTINGS_CHANGED_EVENT,
  readShowCompletedSubtaskCount,
  readShowTotalSubtaskCount,
  setShowCompletedSubtaskCount,
  setShowTotalSubtaskCount,
} from '../services/taskRowSettings'

interface Props {
  hideCompleted: boolean
  onToggleHideCompleted: () => void
  phonePriority: boolean
  onTogglePhonePriority: () => void
  theme: Theme
  onToggleTheme: () => void
  accent: string | null
  accentPresets: readonly string[]
  onSetAccent: (hex: string | null) => void
  sidebarZoomPct: number
  onSidebarZoom: (delta: number | 'reset') => void
  taskZoomPct: number
  onZoom: (delta: number | 'reset') => void
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

// Settings popover — consolidates the low-frequency view controls that
// were cluttering the task header. Owns its own Esc / click-away
// dismissal (matches SortPopover).
export function SettingsPopover({
  hideCompleted,
  onToggleHideCompleted,
  phonePriority,
  onTogglePhonePriority,
  theme,
  onToggleTheme,
  accent,
  accentPresets,
  onSetAccent,
  sidebarZoomPct,
  onSidebarZoom,
  taskZoomPct,
  onZoom,
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
  const [hex, setHex] = useState(accent ?? '#2f8a6c')
  const [hintsOn, setHintsOn] = useState(readHintsEnabled)
  const [showDoneCount, setShowDoneCount] = useState(
    readShowCompletedSubtaskCount,
  )
  const [showTotalCount, setShowTotalCount] = useState(
    readShowTotalSubtaskCount,
  )
  // Reflect changes made from the contacts settings popover (or any
  // future surface that flips hints).
  useEffect(() => {
    const refresh = () => setHintsOn(readHintsEnabled())
    window.addEventListener(HINTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(HINTS_CHANGED_EVENT, refresh)
  }, [])
  // Mirror row-setting flips so the toggles stay in sync if changed
  // from another surface (none today, but the contract is consistent).
  useEffect(() => {
    const refresh = () => {
      setShowDoneCount(readShowCompletedSubtaskCount())
      setShowTotalCount(readShowTotalSubtaskCount())
    }
    window.addEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Settings"]')) return
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

  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Settings"
      className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Settings
      </p>

      <Row label="Hide completed">
        <Toggle
          on={hideCompleted}
          onClick={onToggleHideCompleted}
          label="Hide completed"
        />
      </Row>
      <Row label="Phone-friendly priority">
        <Toggle
          on={phonePriority}
          onClick={onTogglePhonePriority}
          label="Phone-friendly priority"
        />
      </Row>
      <Row label="Dark theme">
        <Toggle
          on={theme === 'dark'}
          onClick={onToggleTheme}
          label="Dark theme"
        />
      </Row>

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Zoom
      </p>
      <ZoomRow
        label="Sidebar zoom"
        pct={sidebarZoomPct}
        onZoom={onSidebarZoom}
      />
      <ZoomRow label="Task pane zoom" pct={taskZoomPct} onZoom={onZoom} />
      <ZoomRow
        label="Detail zoom"
        pct={detailZoomPct}
        onZoom={onDetailZoom}
      />
      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Sync
      </p>
      <SyncRow
        label="Active list every"
        value={activeSyncMin}
        options={activeSyncOptions}
        onChange={onSetActiveSync}
        labelFn={durLabel}
      />
      <SyncRow
        label="Other lists every"
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

      <div className="mt-1 border-t border-border px-3 py-2">
        <p className="mb-1.5 text-xs text-text-muted">Accent colour</p>
        <div className="flex flex-wrap gap-1.5">
          {accentPresets.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onSetAccent(c)}
              title={c}
              aria-label={`Accent ${c}`}
              className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                accent === c ? 'border-text' : 'border-border'
              }`}
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            onClick={() => onSetAccent(null)}
            title="Theme default"
            aria-label="Default accent"
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
              accent === null
                ? 'border-text text-text'
                : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
            }`}
          >
            ✕
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            aria-label="Custom accent picker"
            className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
          />
          <input
            type="text"
            value={hex}
            spellCheck={false}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hexValid) {
                e.preventDefault()
                onSetAccent(hex.toLowerCase())
              }
            }}
            aria-label="Custom accent hex"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 font-mono text-xs text-text outline-none focus:border-border-strong"
          />
          <button
            type="button"
            disabled={!hexValid}
            onClick={() => onSetAccent(hex.toLowerCase())}
            className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </div>

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

      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Task row
      </p>
      <Row label="Show completed subtask count">
        <Toggle
          on={showDoneCount}
          onClick={() => setShowCompletedSubtaskCount(!showDoneCount)}
          label="Show completed subtask count"
        />
      </Row>
      <Row label="Show total subtask count">
        <Toggle
          on={showTotalCount}
          onClick={() => setShowTotalSubtaskCount(!showTotalCount)}
          label="Show total subtask count"
        />
      </Row>

      <InactiveOpacitySettings />

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
