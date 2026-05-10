import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

interface Binding {
  keys: string[]
  description: string
}

const SHORTCUTS: Array<{ group: string; items: Binding[] }> = [
  {
    group: 'Navigation',
    items: [
      { keys: ['l'], description: 'Focus task lists' },
      { keys: ['t'], description: 'Focus tasks' },
      { keys: ['↑', '↓'], description: 'Move selection' },
      { keys: ['PgUp', 'PgDn'], description: 'Skip 10 rows' },
      { keys: ['Home', 'End'], description: 'First / last' },
    ],
  },
  {
    group: 'Tree',
    items: [
      { keys: ['←'], description: 'Collapse, then jump to parent' },
      { keys: ['→'], description: 'Expand a parent, or start a subtask' },
      { keys: ['Enter'], description: 'Toggle complete' },
      { keys: ['n'], description: 'New task at top of list' },
      { keys: ['Del', 'Backspace'], description: 'Delete (with confirmation)' },
      { keys: ['F2', 'Double-click'], description: 'Rename a task' },
    ],
  },
  {
    group: 'Filters',
    items: [{ keys: ['f'], description: 'Open filter options' }],
  },
  {
    group: 'General',
    items: [
      { keys: ['?'], description: 'Show this menu' },
      { keys: ['Esc'], description: 'Close menu / cancel input' },
    ],
  },
]

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border-strong bg-surface-2 px-1.5 font-mono text-[11px] text-text">
      {children}
    </kbd>
  )
}

export function KeybindingsModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-faint hover:text-text-muted"
          >
            ×
          </button>
        </div>
        <div className="space-y-4">
          {SHORTCUTS.map((section) => (
            <section key={section.group}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                {section.group}
              </h4>
              <ul className="space-y-1.5">
                {section.items.map((b) => (
                  <li
                    key={b.description}
                    className="flex items-baseline gap-3 text-xs"
                  >
                    <span className="flex shrink-0 items-center gap-1">
                      {b.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-text-faint">or</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                    <span className="flex-1 text-text-muted">
                      {b.description}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-5 text-[11px] text-text-faint">
          Customizable bindings coming in a later update.
        </p>
      </div>
    </div>
  )
}
