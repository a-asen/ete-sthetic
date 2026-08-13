import { useEffect, useState } from 'react'
import {
  KEYBINDINGS_CHANGED_EVENT,
  KEYBINDING_ACTIONS,
  formatBinding,
  getActionLabel,
  getBinding,
  getDefaultBinding,
  isDefaultBinding,
  setBinding,
  specFromEvent,
  type BindingSpec,
  type KeybindingAction,
} from '../services/keybindings'

// Live shortcut editor surfaced under the settings popover's Advanced
// pane. One row per rebindable action; each row shows the current
// binding and a "Rebind" button that flips the row into capture
// mode — the very next non-modifier keystroke commits as the new
// binding. Esc aborts capture; clicking Reset clears the override
// and reverts to the default.
//
// Conflict detection is best-effort: when the captured spec matches
// another action's binding, both rows render a warning. The user is
// free to commit it anyway — sometimes that's intentional (e.g.
// remapping a chord they prefer over a default).
export function KeybindingEditor() {
  const [tick, setTick] = useState(0)
  // Action currently in capture mode, if any. While set, the editor's
  // own window-level keydown listener intercepts the next key and
  // commits it as the new binding.
  const [capturing, setCapturing] = useState<KeybindingAction | null>(null)

  // Re-render when any binding changes (e.g. from another open
  // popover, or after a reset / commit in this one).
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, refresh)
  }, [])

  // Capture-mode keydown handler. Listens with capture-phase + stops
  // propagation so the captured chord doesn't accidentally trigger
  // its old action while the user is rebinding it.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setCapturing(null)
        return
      }
      const spec = specFromEvent(e)
      if (!spec) return // bare modifier press — wait for the real key
      e.preventDefault()
      e.stopPropagation()
      setBinding(capturing, spec)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true })
  }, [capturing])

  // tick is a deliberate "force re-read getBinding" trigger. Reference
  // it so React doesn't optimise the dep away.
  void tick

  return (
    <div className="px-1.5 py-1">
      <p className="px-1.5 pb-1 text-[11px] text-text-faint">
        Click a row's chord to rebind. Esc cancels; Reset reverts to
        the default. Ctrl on Linux/Windows = Cmd on macOS.
      </p>
      <ul className="space-y-0.5">
        {KEYBINDING_ACTIONS.map((action) => {
          const spec = getBinding(action)
          const defaultSpec = getDefaultBinding(action)
          const inCapture = capturing === action
          return (
            <li
              key={action}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                {getActionLabel(action)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCapturing((cur) => (cur === action ? null : action))
                }
                title={
                  inCapture
                    ? 'Press a key (Esc to cancel)'
                    : `Click to rebind — current: ${formatBinding(spec)}`
                }
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors ${
                  inCapture
                    ? 'animate-pulse border-accent bg-accent-soft text-accent'
                    : 'border-border bg-bg text-text hover:border-border-strong'
                }`}
              >
                {inCapture ? 'Press any key…' : formatBinding(spec)}
              </button>
              <button
                type="button"
                onClick={() => setBinding(action, null)}
                disabled={isDefaultBinding(action)}
                title={`Reset to ${formatBinding(defaultSpec)}`}
                className="shrink-0 rounded px-1 text-[10px] text-text-faint transition-colors hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
              >
                Reset
              </button>
            </li>
          )
        })}
      </ul>
      <ConflictNotice specs={KEYBINDING_ACTIONS.map((a) => getBinding(a))} />
    </div>
  )
}

// Flag duplicate chords so the user knows two rows are competing.
// Useful when they intentionally remap something — we don't prevent
// the commit, but we surface what's happening.
function ConflictNotice({ specs }: { specs: readonly BindingSpec[] }) {
  const seen = new Map<string, number>()
  for (const s of specs) {
    if (!s.key) continue
    const k = formatBinding(s)
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
  if (dupes.length === 0) return null
  return (
    <p
      role="alert"
      className="mt-1.5 px-1.5 text-[10px] text-danger/80"
    >
      Conflicts: {dupes.join(' · ')} — multiple actions share these chords.
    </p>
  )
}
