import { useEffect, useState } from 'react'
import {
  SETTINGS_SECTIONS_CHANGED_EVENT,
  readSectionOpen,
  setSectionOpen,
} from '../services/settingsSections'

interface Props {
  // Stable id used as the persistence key. Prefix with the module
  // ("tasks.", "contacts.", "calendar.") or "shared." when the section
  // appears in multiple popovers.
  id: string
  label: string
  defaultOpen?: boolean
  // When set, the section ignores the saved collapsed state and always
  // renders its body; the header chevron is hidden. Used by
  // `SettingsWindow` where the left-nav is the navigation mechanism
  // and collapse-to-hide would defeat it.
  forceOpen?: boolean
  children: React.ReactNode
}

// Collapsible section wrapper for the settings popovers. Replaces the
// flat `<p className="uppercase tracking-wider">…</p>` headers with a
// clickable header that hides its body. State persists via
// `services/settingsSections`; multiple popovers subscribed to the same
// id stay in sync via SETTINGS_SECTIONS_CHANGED_EVENT.
export function SettingsSection({
  id,
  label,
  defaultOpen = true,
  forceOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(() => readSectionOpen(id, defaultOpen))

  useEffect(() => {
    const refresh = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail
      if (!detail || detail.id === id) {
        setOpen(readSectionOpen(id, defaultOpen))
      }
    }
    window.addEventListener(SETTINGS_SECTIONS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(SETTINGS_SECTIONS_CHANGED_EVENT, refresh)
  }, [id, defaultOpen])

  const effectiveOpen = forceOpen || open

  return (
    <div data-section-id={id}>
      <button
        type="button"
        disabled={forceOpen}
        onClick={() => {
          if (forceOpen) return
          const next = !open
          setOpen(next)
          setSectionOpen(id, next)
        }}
        aria-expanded={effectiveOpen}
        className="flex w-full items-center justify-between gap-2 px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint transition-colors hover:text-text-muted disabled:cursor-default disabled:hover:text-text-faint"
      >
        <span>{label}</span>
        {!forceOpen && (
          <span
            aria-hidden
            className={`text-[10px] transition-transform ${
              effectiveOpen ? 'rotate-90' : ''
            }`}
          >
            ▸
          </span>
        )}
      </button>
      {effectiveOpen && children}
    </div>
  )
}
