import { useEffect, useRef, useState } from 'react'
import type { ThemePref } from '../services/theme'
import {
  HINTS_CHANGED_EVENT,
  readHintsEnabled,
  setHintsEnabled,
} from '../services/hints'
import { KeybindingEditor } from './KeybindingEditor'
import { ModuleToggles } from './ModuleToggles'
import { InactiveOpacitySettings } from './InactiveOpacitySettings'
import { NavRow, PaneHeader } from './SettingsNav'
import { SettingsSection } from './SettingsSection'
import { SettingsWindow } from './SettingsWindow'
import {
  REORDER_STEP_MAX,
  REORDER_STEP_MIN,
  SCROLL_HEADROOM_MAX,
  SCROLL_HEADROOM_MIN,
  TASK_ROW_SETTINGS_CHANGED_EVENT,
  readReorderStep,
  readScrollHeadroom,
  readShowCompletedSubtaskCount,
  readShowSidebarSyncAge,
  readShowTaskDetails,
  readShowTotalSubtaskCount,
  setReorderStep,
  setScrollHeadroom,
  setShowCompletedSubtaskCount,
  setShowSidebarSyncAge,
  setShowTaskDetails,
  setShowTotalSubtaskCount,
} from '../services/taskRowSettings'

interface Props {
  hideCompleted: boolean
  onToggleHideCompleted: () => void
  phonePriority: boolean
  onTogglePhonePriority: () => void
  themePref: ThemePref
  onSetThemePref: (pref: ThemePref) => void
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
  // Lets the Advanced pane surface "Keyboard shortcuts" — the modal
  // itself lives in MainView, so the popover just asks for it.
  onShowKeybindings?: () => void
  onLogout: () => void
  onClose: () => void
}

// Compact-popover pane ids. The wide SettingsWindow shows every
// section at once (forced-open SettingsSection blocks), so this
// navigator state only affects the small floating popover.
type Pane = 'root' | 'display' | 'zoom' | 'sync' | 'advanced' | 'account'

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
  themePref,
  onSetThemePref,
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
  onShowKeybindings,
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
  const [showDetails, setShowDetailsState] = useState(readShowTaskDetails)
  const [scrollHeadroom, setScrollHeadroomState] =
    useState(readScrollHeadroom)
  const [showSidebarSyncAge, setShowSidebarSyncAgeState] = useState(
    readShowSidebarSyncAge,
  )
  const [reorderStep, setReorderStepState] = useState(readReorderStep)
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
      setShowDetailsState(readShowTaskDetails())
      setScrollHeadroomState(readScrollHeadroom())
      setShowSidebarSyncAgeState(readShowSidebarSyncAge())
      setReorderStepState(readReorderStep())
    }
    window.addEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(TASK_ROW_SETTINGS_CHANGED_EVENT, refresh)
  }, [])

  // When true, the popover swaps its small frame for the larger
  // SettingsWindow modal. The popover stays mounted so the close
  // handler still works and the user can toggle back to the compact
  // view without losing local state (hex draft, etc).
  const [windowOpen, setWindowOpen] = useState(false)
  // Drill-down navigator state for the compact popover. The wide
  // window mode (`windowOpen=true`) shows every section at once, so
  // this only matters when the popover is in its small frame.
  const [pane, setPane] = useState<Pane>('root')

  useEffect(() => {
    // Outside-click + Esc dismissal only apply to the compact popover
    // — SettingsWindow owns its own dismissal (backdrop click + Esc)
    // and we'd otherwise double-fire onClose / close the window the
    // moment the user clicked inside it.
    if (windowOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Settings"]')) return
      if (!ref.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Drill back up first so Esc inside a leaf returns the user
        // to the root pane instead of closing the whole popover.
        if (pane !== 'root') setPane('root')
        else onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, windowOpen, pane])

  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex)

  // Sections list — left-nav order in the SettingsWindow + the section
  // ids that match each `<SettingsSection id=...>` below. Kept in sync
  // by hand so the nav reflects the popover layout exactly.
  const SECTIONS = [
    { id: 'tasks.display', label: 'Display' },
    { id: 'tasks.zoom', label: 'Zoom' },
    { id: 'tasks.sync', label: 'Sync' },
    { id: 'tasks.accent', label: 'Accent colour' },
    { id: 'tasks.help', label: 'Help' },
    { id: 'tasks.row', label: 'Task row' },
    { id: 'shared.inactiveOpacity', label: 'Inactive-zone fade' },
    { id: 'shared.modules', label: 'Modules' },
    { id: 'shared.account', label: 'Account' },
  ] as const

  // Per-pane row fragments. Composed both into the wide
  // SettingsWindow body (each wrapped in a SettingsSection) and into
  // the compact popover's leaf panes (no section wrapper since the
  // PaneHeader already names the pane).
  const displayRows = (
    <>
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
      <Row label="Theme">
        <span className="flex items-center rounded-md border border-border text-[11px] text-text-muted">
          {(['system', 'light', 'dark'] as const).map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => onSetThemePref(p)}
              aria-pressed={themePref === p}
              className={`h-6 px-2 capitalize transition-colors ${
                i === 0 ? 'rounded-l-md' : ''
              } ${i === 2 ? 'rounded-r-md' : 'border-r border-border'} ${
                themePref === p
                  ? 'bg-accent-soft text-accent'
                  : 'hover:bg-surface-2 hover:text-text'
              }`}
            >
              {p}
            </button>
          ))}
        </span>
      </Row>
      <Row label="Sidebar: show last-sync age">
        <Toggle
          on={showSidebarSyncAge}
          onClick={() => setShowSidebarSyncAge(!showSidebarSyncAge)}
          label="Show last-sync age on sidebar list rows"
        />
      </Row>
    </>
  )

  const zoomRows = (
    <>
      <ZoomRow
        label="Sidebar zoom"
        pct={sidebarZoomPct}
        onZoom={onSidebarZoom}
      />
      <ZoomRow label="Task pane zoom" pct={taskZoomPct} onZoom={onZoom} />
      <ZoomRow label="Detail zoom" pct={detailZoomPct} onZoom={onDetailZoom} />
    </>
  )

  const syncRows = (
    <>
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
    </>
  )

  const accentRows = (
    <div className="px-3 py-2">
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
  )

  const helpRows = (
    <Row label="Show usage hints">
      <Toggle
        on={hintsOn}
        onClick={() => setHintsEnabled(!hintsOn)}
        label="Show usage hints"
      />
    </Row>
  )

  const taskRowRows = (
    <>
      <Row label="Show task details">
        <Toggle
          on={showDetails}
          onClick={() => setShowTaskDetails(!showDetails)}
          label="Show task details"
        />
      </Row>
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
      <Row label="Scroll headroom (rows)">
        <span className="flex items-center rounded-md border border-border text-text-muted">
          <button
            type="button"
            onClick={() => setScrollHeadroom(scrollHeadroom - 1)}
            disabled={scrollHeadroom <= SCROLL_HEADROOM_MIN}
            aria-label="Less scroll headroom"
            className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <span className="h-6 min-w-[2.5rem] border-x border-border px-1 text-center text-[11px] leading-6 tabular-nums">
            {scrollHeadroom}
          </span>
          <button
            type="button"
            onClick={() => setScrollHeadroom(scrollHeadroom + 1)}
            disabled={scrollHeadroom >= SCROLL_HEADROOM_MAX}
            aria-label="More scroll headroom"
            className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </span>
      </Row>
      <p className="px-3 pb-2 pt-0 text-[11px] text-text-faint">
        Rows of context kept above/below the selected task when the
        view auto-scrolls (priority change, arrow navigation, drag).
      </p>
      <Row label="Reorder step (rows)">
        <span className="flex items-center rounded-md border border-border text-text-muted">
          <button
            type="button"
            onClick={() => setReorderStep(reorderStep - 1)}
            disabled={reorderStep <= REORDER_STEP_MIN}
            aria-label="Smaller reorder step"
            className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <span className="h-6 min-w-[2.5rem] border-x border-border px-1 text-center text-[11px] leading-6 tabular-nums">
            {reorderStep}
          </span>
          <button
            type="button"
            onClick={() => setReorderStep(reorderStep + 1)}
            disabled={reorderStep >= REORDER_STEP_MAX}
            aria-label="Larger reorder step"
            className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </span>
      </Row>
      <p className="px-3 pb-2 pt-0 text-[11px] text-text-faint">
        How many rows <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> shifts the
        selected task within its group (manual sort only).
      </p>
    </>
  )

  const accountRows = (
    <button
      type="button"
      onClick={onLogout}
      className="block w-full px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      Sign out
    </button>
  )

  // Wide-window body: every section laid out at once with the
  // forced-open SettingsSection style so the left-nav can scroll to
  // each anchor.
  const body = (
    <>
      <SettingsSection
        id="tasks.display"
        label="Display"
        forceOpen={windowOpen}
      >
        {displayRows}
      </SettingsSection>
      <SettingsSection id="tasks.zoom" label="Zoom" forceOpen={windowOpen}>
        {zoomRows}
      </SettingsSection>
      <SettingsSection id="tasks.sync" label="Sync" forceOpen={windowOpen}>
        {syncRows}
      </SettingsSection>
      <SettingsSection
        id="tasks.accent"
        label="Accent colour"
        forceOpen={windowOpen}
      >
        {accentRows}
      </SettingsSection>
      <SettingsSection id="tasks.help" label="Help" forceOpen={windowOpen}>
        {helpRows}
      </SettingsSection>
      <SettingsSection id="tasks.row" label="Task row" forceOpen={windowOpen}>
        {taskRowRows}
      </SettingsSection>
      <InactiveOpacitySettings forceOpen={windowOpen} />
      <ModuleToggles forceOpen={windowOpen} />
      <div className="mt-1 border-t border-border">
        <SettingsSection
          id="shared.account"
          label="Account"
          forceOpen={windowOpen}
        >
          {accountRows}
        </SettingsSection>
      </div>
    </>
  )

  if (windowOpen) {
    return (
      <SettingsWindow
        title="Settings"
        sections={SECTIONS}
        onClose={() => {
          setWindowOpen(false)
          onClose()
        }}
      >
        {body}
      </SettingsWindow>
    )
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Settings"
      className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      {pane === 'root' ? (
        <>
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              Settings
            </p>
            <button
              type="button"
              onClick={() => setWindowOpen(true)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              More settings…
            </button>
          </div>
          <NavRow label="Display" onClick={() => setPane('display')} />
          <NavRow label="Zoom" onClick={() => setPane('zoom')} />
          <NavRow label="Sync" onClick={() => setPane('sync')} />
          <NavRow label="Advanced" onClick={() => setPane('advanced')} />
          <div className="mt-1 border-t border-border">
            <NavRow label="Account" onClick={() => setPane('account')} />
          </div>
        </>
      ) : pane === 'display' ? (
        <>
          <PaneHeader title="Display" onBack={() => setPane('root')} />
          {displayRows}
        </>
      ) : pane === 'zoom' ? (
        <>
          <PaneHeader title="Zoom" onBack={() => setPane('root')} />
          {zoomRows}
        </>
      ) : pane === 'sync' ? (
        <>
          <PaneHeader title="Sync" onBack={() => setPane('root')} />
          {syncRows}
        </>
      ) : pane === 'account' ? (
        <>
          <PaneHeader title="Account" onBack={() => setPane('root')} />
          {accountRows}
        </>
      ) : (
        // Advanced — stacks the rare/power-user settings under their
        // own collapsible SettingsSection blocks so the user can hide
        // groups they're not adjusting. The pane scrolls if all are
        // open and exceed the popover's height.
        <div className="max-h-[70vh] overflow-y-auto">
          <PaneHeader title="Advanced" onBack={() => setPane('root')} />
          <SettingsSection id="tasks.accent" label="Accent colour">
            {accentRows}
          </SettingsSection>
          <SettingsSection id="tasks.row" label="Task row">
            {taskRowRows}
          </SettingsSection>
          <SettingsSection id="tasks.help" label="Help">
            {helpRows}
          </SettingsSection>
          <InactiveOpacitySettings />
          <ModuleToggles />
          <SettingsSection
            id="tasks.keybindings"
            label="Keyboard shortcuts"
          >
            <KeybindingEditor />
            {onShowKeybindings && (
              <button
                type="button"
                onClick={() => {
                  onShowKeybindings()
                  onClose()
                }}
                className="block w-full px-3 py-2 text-left text-[11px] text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
              >
                Cheat-sheet (all shortcuts, including non-rebindable
                ones)…
              </button>
            )}
          </SettingsSection>
        </div>
      )}
    </div>
  )
}
