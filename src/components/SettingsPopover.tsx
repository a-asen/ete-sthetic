import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../services/theme'

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
  taskZoomPct: number
  onZoom: (delta: number | 'reset') => void
  onClose: () => void
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
  taskZoomPct,
  onZoom,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hex, setHex] = useState(accent ?? '#2f8a6c')

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

      <Row label="Task card size">
        <span className="flex items-center rounded-md border border-border text-text-muted">
          <button
            type="button"
            onClick={() => onZoom(-0.1)}
            aria-label="Smaller task cards"
            className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => onZoom('reset')}
            aria-label="Reset task card size"
            title="Reset"
            className="h-6 min-w-[2.75rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
          >
            {taskZoomPct}%
          </button>
          <button
            type="button"
            onClick={() => onZoom(0.1)}
            aria-label="Larger task cards"
            className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text"
          >
            A+
          </button>
        </span>
      </Row>

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
    </div>
  )
}
