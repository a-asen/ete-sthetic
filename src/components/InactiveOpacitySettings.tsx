import { useEffect, useState } from 'react'
import {
  INACTIVE_OPACITY_CHANGED_EVENT,
  INACTIVE_OPACITY_DEFAULTS,
  INACTIVE_OPACITY_MAX,
  INACTIVE_OPACITY_MIN,
  INACTIVE_OPACITY_STEP,
  readInactiveOpacity,
  resetInactiveOpacity,
  setInactiveOpacity,
  type InactiveScope,
  type InactiveZone,
} from '../services/inactiveOpacity'
import { SettingsSection } from './SettingsSection'

// "Inactive zone fade" subsection embedded in each module's settings
// popover. Three +/-/reset rows control the opacity applied to the
// non-focused zones. Each module has its own stored values: Tasks keeps
// its historic fade defaults, while Contacts defaults to fully visible
// (100%) because its panes fit on one page. Calendar doesn't have a
// focus-zone system yet, so the prefs are ignored there.

interface RowSpec {
  zone: InactiveZone
  label: string
}

const ROWS: readonly RowSpec[] = [
  { zone: 'sidebar', label: 'Sidebar' },
  { zone: 'middle', label: 'Middle pane' },
  { zone: 'detail', label: 'Detail pane' },
]

export function InactiveOpacitySettings({
  forceOpen = false,
  scope = 'tasks',
}: {
  forceOpen?: boolean
  scope?: InactiveScope
} = {}) {
  const defaults = INACTIVE_OPACITY_DEFAULTS[scope]
  const [values, setValues] = useState(() => ({
    sidebar: readInactiveOpacity('sidebar', scope),
    middle: readInactiveOpacity('middle', scope),
    detail: readInactiveOpacity('detail', scope),
  }))

  // Mirror any flips made from another open settings popover so all
  // surfaces stay in lockstep.
  useEffect(() => {
    const refresh = () =>
      setValues({
        sidebar: readInactiveOpacity('sidebar', scope),
        middle: readInactiveOpacity('middle', scope),
        detail: readInactiveOpacity('detail', scope),
      })
    window.addEventListener(INACTIVE_OPACITY_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(INACTIVE_OPACITY_CHANGED_EVENT, refresh)
  }, [scope])

  return (
    <SettingsSection
      id="shared.inactiveOpacity"
      label="Inactive zone fade"
      forceOpen={forceOpen}
    >
      {ROWS.map((row) => (
        <div
          key={row.zone}
          className="flex items-center justify-between gap-3 px-3 py-2"
        >
          <span className="text-xs text-text-muted">{row.label}</span>
          <Stepper
            value={values[row.zone]}
            defaultValue={defaults[row.zone]}
            onDec={() =>
              setInactiveOpacity(
                row.zone,
                values[row.zone] - INACTIVE_OPACITY_STEP,
                scope,
              )
            }
            onInc={() =>
              setInactiveOpacity(
                row.zone,
                values[row.zone] + INACTIVE_OPACITY_STEP,
                scope,
              )
            }
            onReset={() => resetInactiveOpacity(row.zone, scope)}
            label={`${row.label} inactive fade`}
          />
        </div>
      ))}
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        {scope === 'contacts'
          ? 'Contacts starts at 100% (no fade). Lower a value to dim that pane when another zone has focus.'
          : 'How visible non-focused panels stay. 100% = no fade.'}
      </p>
    </SettingsSection>
  )
}

function Stepper({
  value,
  defaultValue,
  onDec,
  onInc,
  onReset,
  label,
}: {
  value: number
  defaultValue: number
  onDec: () => void
  onInc: () => void
  onReset: () => void
  label: string
}) {
  const atMin = value <= INACTIVE_OPACITY_MIN
  const atMax = value >= INACTIVE_OPACITY_MAX
  return (
    <span className="flex items-center rounded-md border border-border text-text-muted">
      <button
        type="button"
        onClick={onDec}
        disabled={atMin}
        aria-label={`Smaller ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={`Reset ${label}`}
        title={`Reset to default (${defaultValue}%)`}
        className="h-6 min-w-[2.75rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
      >
        {value}%
      </button>
      <button
        type="button"
        onClick={onInc}
        disabled={atMax}
        aria-label={`Larger ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </span>
  )
}
