// Per-section collapsed/expanded state for the settings popovers.
//
// Each section in the tasks / contacts / calendar settings popovers has a
// stable id (e.g. "tasks.zoom", "contacts.sync", "shared.modules"). When
// the user clicks the section header it toggles; the choice is persisted
// here so a popover reopens with the same sections collapsed.
//
// Default = open. We only write to storage when a section is explicitly
// closed; an absent key means "use the default". That way the popovers
// stay visually identical to before until the user collapses something.
//
// Flips broadcast SETTINGS_SECTIONS_CHANGED_EVENT so two open popovers
// (e.g. tasks + a hypothetical multi-pane settings overlay) stay in
// lockstep — same pattern InactiveOpacitySettings / ModuleToggles use.

const STORAGE_PREFIX = 'ete-sthetic.settings.sections.'

export const SETTINGS_SECTIONS_CHANGED_EVENT =
  'ete-sthetic-settings-sections-changed'

function key(id: string): string {
  return `${STORAGE_PREFIX}${id}`
}

export function readSectionOpen(id: string, defaultOpen = true): boolean {
  if (typeof localStorage === 'undefined') return defaultOpen
  const raw = localStorage.getItem(key(id))
  if (raw === null) return defaultOpen
  return raw !== 'closed'
}

export function setSectionOpen(id: string, open: boolean): void {
  if (typeof localStorage === 'undefined') return
  // Only persist the non-default state. Once a section is reopened, drop
  // the key so localStorage doesn't accumulate cruft from one-off pokes.
  if (open) localStorage.removeItem(key(id))
  else localStorage.setItem(key(id), 'closed')
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(SETTINGS_SECTIONS_CHANGED_EVENT, { detail: { id } }),
    )
  }
}
