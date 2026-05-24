import { useEffect, useState } from 'react'
import {
  MODULE_FLAGS_CHANGED_EVENT,
  readModuleEnabled,
  setModuleEnabled,
  type ModuleName,
} from '../services/moduleFlags'

interface Row {
  module: ModuleName
  label: string
  // Tasks is the home module; it can never be disabled (the moduleFlags
  // service no-ops a tasks-off write defensively too).
  locked?: boolean
}

const ROWS: readonly Row[] = [
  { module: 'tasks', label: 'Tasks', locked: true },
  { module: 'calendar', label: 'Calendar' },
  { module: 'contacts', label: 'Contacts' },
]

// "Modules" subsection embedded in each module's settings popover. Lets
// the user disable modules they don't use — the bottom-left switcher
// hides them and their background sync stops (the disabled view isn't
// mounted, so its sync effects don't run). Subscribes to
// MODULE_FLAGS_CHANGED_EVENT so flipping a toggle in one popover is
// reflected in any other popover that's also open.
export function ModuleToggles() {
  const [flags, setFlags] = useState<Record<ModuleName, boolean>>(() => ({
    tasks: readModuleEnabled('tasks'),
    calendar: readModuleEnabled('calendar'),
    contacts: readModuleEnabled('contacts'),
  }))

  useEffect(() => {
    const refresh = () =>
      setFlags({
        tasks: readModuleEnabled('tasks'),
        calendar: readModuleEnabled('calendar'),
        contacts: readModuleEnabled('contacts'),
      })
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
  }, [])

  return (
    <>
      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Modules
      </p>
      {ROWS.map((row) => (
        <div
          key={row.module}
          className="flex items-center justify-between gap-3 px-3 py-2"
        >
          <span className="text-xs text-text-muted">{row.label}</span>
          <Toggle
            on={flags[row.module]}
            disabled={row.locked}
            onClick={() => {
              if (row.locked) return
              setModuleEnabled(row.module, !flags[row.module])
            }}
            label={`Enable ${row.label}`}
          />
        </div>
      ))}
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Disabling a module hides its switcher button and stops its
        background sync. Tasks stays on — it's the home module.
      </p>
    </>
  )
}

function Toggle({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on
          ? 'border-accent/50 bg-accent-soft'
          : 'border-border bg-surface-2'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-4 bg-accent' : 'left-0.5 bg-text-faint'
        }`}
      />
    </button>
  )
}
