// User-rebindable shortcuts for the tasks module. Defaults live in
// code; overrides persist in localStorage as a JSON map keyed by
// action id. Reset is just "remove the override entry."
//
// What's tracked here is the *named* command shortcuts the user
// reaches via Ctrl+letter chords — focus-zone switches, filter,
// sort, sync-all, new-task, move-task, global search. The bare
// arrows, Esc, F2, the 0–9 priority hotkeys, and typeahead aren't
// rebindable: they're either intrinsic to the input mode (arrows in
// a list pane) or tied to a single key with no meaningful alternative.

export type KeybindingAction =
  | 'focus.lists'
  | 'focus.tasks'
  | 'focus.details'
  | 'filter'
  | 'search.all'
  | 'sort'
  | 'sync.active'
  | 'new.task'
  | 'move.task'

export interface BindingSpec {
  // `KeyboardEvent.key`, normalised to lowercase for letters. Use
  // empty string for "no key bound" — defaults shouldn't be empty
  // but a user can clear an override that way (which falls back
  // to the default).
  key: string
  // True if the binding requires Ctrl OR Meta (cross-platform).
  ctrl: boolean
  shift: boolean
  alt: boolean
}

interface ActionDef {
  label: string
  description: string
  default: BindingSpec
}

const STORAGE_KEY = 'ete-sthetic.keybindings.overrides'
export const KEYBINDINGS_CHANGED_EVENT = 'ete-sthetic-keybindings-changed'

const ACTIONS: Record<KeybindingAction, ActionDef> = {
  'focus.lists': {
    label: 'Focus the lists sidebar',
    description: 'Move keyboard focus to the lists pane.',
    default: { key: 'l', ctrl: true, shift: false, alt: false },
  },
  'focus.tasks': {
    label: 'Focus the task pane',
    description: 'Move keyboard focus to the task tree.',
    default: { key: 't', ctrl: true, shift: false, alt: false },
  },
  'focus.details': {
    label: 'Open the detail panel',
    description: 'Open the detail panel for the selected task.',
    default: { key: 'e', ctrl: true, shift: false, alt: false },
  },
  filter: {
    label: 'Open filter',
    description: 'Open the filter popover and focus its search input.',
    default: { key: 'f', ctrl: true, shift: false, alt: false },
  },
  'search.all': {
    label: 'Search every list',
    description: 'Open the cross-list global search modal.',
    default: { key: 'f', ctrl: true, shift: true, alt: false },
  },
  sort: {
    label: 'Open sort',
    description: 'Open the sort popover for the active list.',
    default: { key: 's', ctrl: true, shift: false, alt: false },
  },
  'sync.active': {
    label: 'Sync active list',
    description:
      'Sync just the active list now. (Ctrl/Cmd+Alt+S force-syncs every list across all modules.)',
    default: { key: 's', ctrl: true, shift: true, alt: false },
  },
  'new.task': {
    label: 'New task',
    description: 'Start an inline new task at the top of the active list.',
    default: { key: 'n', ctrl: true, shift: false, alt: false },
  },
  'move.task': {
    label: 'Move task',
    description:
      'Open the move-task picker. Hold Shift to also follow the task to its new list.',
    default: { key: 'm', ctrl: true, shift: false, alt: false },
  },
}

export const KEYBINDING_ACTIONS = Object.keys(ACTIONS) as KeybindingAction[]

export function getActionLabel(action: KeybindingAction): string {
  return ACTIONS[action].label
}

export function getActionDescription(action: KeybindingAction): string {
  return ACTIONS[action].description
}

export function getDefaultBinding(action: KeybindingAction): BindingSpec {
  return ACTIONS[action].default
}

// In-memory cache of the override map so the keydown handler doesn't
// re-parse localStorage on every keystroke. Refreshed on every flip
// via the change event, and seeded lazily on first read.
let overridesCache: Map<KeybindingAction, BindingSpec> | null = null

function loadOverrides(): Map<KeybindingAction, BindingSpec> {
  if (overridesCache) return overridesCache
  const out = new Map<KeybindingAction, BindingSpec>()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      overridesCache = out
      return out
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [action, val] of Object.entries(parsed)) {
      if (!(action in ACTIONS)) continue
      if (!val || typeof val !== 'object') continue
      const v = val as Record<string, unknown>
      if (typeof v.key !== 'string') continue
      out.set(action as KeybindingAction, {
        key: v.key.toLowerCase(),
        ctrl: !!v.ctrl,
        shift: !!v.shift,
        alt: !!v.alt,
      })
    }
  } catch {
    // Corrupt JSON — silently fall back to defaults.
  }
  overridesCache = out
  return out
}

function saveOverrides(map: Map<KeybindingAction, BindingSpec>): void {
  try {
    const obj: Record<string, BindingSpec> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // Non-fatal.
  }
}

// Lookup the live binding for an action: override if present, default
// otherwise.
export function getBinding(action: KeybindingAction): BindingSpec {
  return loadOverrides().get(action) ?? ACTIONS[action].default
}

// Whether the binding is currently the default (i.e. no user
// override). Used by the editor to enable/disable the "Reset"
// button per row.
export function isDefaultBinding(action: KeybindingAction): boolean {
  return !loadOverrides().has(action)
}

// Persist a new binding for `action`. Pass null to clear the
// override and revert to the default. Fires
// KEYBINDINGS_CHANGED_EVENT on success.
export function setBinding(
  action: KeybindingAction,
  spec: BindingSpec | null,
): void {
  const map = loadOverrides()
  if (spec === null) map.delete(action)
  else map.set(action, { ...spec, key: spec.key.toLowerCase() })
  saveOverrides(map)
  overridesCache = map
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(KEYBINDINGS_CHANGED_EVENT, { detail: { action } }),
    )
  }
}

// True iff the given KeyboardEvent matches the binding (after
// resolving overrides). The Ctrl flag matches Ctrl OR Meta so
// macOS users get Cmd-by-default semantics for free.
export function matchesBinding(
  e: KeyboardEvent,
  action: KeybindingAction,
): boolean {
  const spec = getBinding(action)
  if (!spec.key) return false
  if (e.key.toLowerCase() !== spec.key) return false
  if (spec.ctrl !== (e.ctrlKey || e.metaKey)) return false
  if (spec.shift !== e.shiftKey) return false
  if (spec.alt !== e.altKey) return false
  return true
}

// Human-readable label for a binding (e.g. "Ctrl+Shift+F"). Used by
// the editor and tooltips. Empty spec renders as "—".
export function formatBinding(spec: BindingSpec): string {
  if (!spec.key) return '—'
  const parts: string[] = []
  if (spec.ctrl) parts.push('Ctrl')
  if (spec.alt) parts.push('Alt')
  if (spec.shift) parts.push('Shift')
  // Letter / digit keys read better uppercase; named keys (Enter,
  // Space, F2, …) keep their natural casing.
  const k = spec.key
  parts.push(k.length === 1 ? k.toUpperCase() : k)
  return parts.join('+')
}

// Build a BindingSpec from a fired KeyboardEvent. Returns null if
// the event is a "modifier-only" press (Ctrl alone, Shift alone, …)
// which is never a useful binding on its own.
export function specFromEvent(e: KeyboardEvent): BindingSpec | null {
  const k = e.key
  if (k === 'Control' || k === 'Meta' || k === 'Shift' || k === 'Alt') {
    return null
  }
  return {
    key: k.toLowerCase(),
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  }
}
