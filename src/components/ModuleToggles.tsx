import { useEffect, useState } from 'react'
import {
  MODULE_FLAGS_CHANGED_EVENT,
  moveModule,
  readModuleEnabled,
  readModuleOrder,
  setModuleEnabled,
  type ModuleName,
} from '../services/moduleFlags'
import { SettingsSection } from './SettingsSection'

const LABELS: Record<ModuleName, string> = {
  home: 'Home',
  tasks: 'Tasks',
  calendar: 'Calendar',
  contacts: 'Contacts',
}

// "Modules" subsection embedded in each module's settings popover. Lets
// the user disable modules they don't use AND reorder them — both the
// top-bar switcher and the Ctrl+Alt+1..4 shortcuts follow this order.
// Subscribes to MODULE_FLAGS_CHANGED_EVENT so a change in one popover is
// reflected in any other popover that's also open.
export function ModuleToggles({
  forceOpen = false,
}: {
  forceOpen?: boolean
} = {}) {
  const [flags, setFlags] = useState<Record<ModuleName, boolean>>(() => ({
    home: readModuleEnabled('home'),
    tasks: readModuleEnabled('tasks'),
    calendar: readModuleEnabled('calendar'),
    contacts: readModuleEnabled('contacts'),
  }))
  const [order, setOrder] = useState<ModuleName[]>(readModuleOrder)

  useEffect(() => {
    const refresh = () => {
      setFlags({
        home: readModuleEnabled('home'),
        tasks: readModuleEnabled('tasks'),
        calendar: readModuleEnabled('calendar'),
        contacts: readModuleEnabled('contacts'),
      })
      setOrder(readModuleOrder())
    }
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
  }, [])

  const enabledCount = order.filter((m) => flags[m]).length

  return (
    <SettingsSection
      id="shared.modules"
      label="Modules"
      forceOpen={forceOpen}
    >
      {order.map((m, i) => {
        const on = flags[m]
        // Can't switch off the last remaining module — something must show.
        const isLastOn = on && enabledCount <= 1
        return (
          <div
            key={m}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveModule(m, -1)}
                disabled={i === 0}
                aria-label={`Move ${LABELS[m]} up`}
                title="Move up"
                className="flex h-4 w-4 items-center justify-center rounded text-text-faint hover:text-text disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveModule(m, 1)}
                disabled={i === order.length - 1}
                aria-label={`Move ${LABELS[m]} down`}
                title="Move down"
                className="flex h-4 w-4 items-center justify-center rounded text-text-faint hover:text-text disabled:opacity-30"
              >
                ▼
              </button>
              <span className="ml-1 text-xs text-text-muted">{LABELS[m]}</span>
            </div>
            <Toggle
              on={on}
              disabled={isLastOn}
              onClick={() => {
                if (isLastOn) return
                setModuleEnabled(m, !on)
              }}
              label={`Enable ${LABELS[m]}`}
            />
          </div>
        )
      })}
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Reorder with the arrows — the top bar and Ctrl+Alt+1–4 follow this
        order. Disabling a module hides it and stops its background sync; at
        least one must stay on.
      </p>
    </SettingsSection>
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
