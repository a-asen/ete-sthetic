import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

interface Binding {
  keys: string[]
  description: string
}

// All command shortcuts are Ctrl/Cmd-prefixed so bare letters stay
// reserved for type-to-search (sidebar list names + task summaries).
const SHORTCUTS: Array<{ group: string; items: Binding[] }> = [
  {
    group: 'Navigation',
    items: [
      { keys: ['Ctrl+L'], description: 'Focus task lists' },
      { keys: ['Ctrl+T'], description: 'Focus tasks' },
      { keys: ['Ctrl+E'], description: 'Open detail panel for selected task' },
      { keys: ['Ctrl+→', 'Ctrl+Enter'], description: 'Step focus right (lists → tasks → details)' },
      { keys: ['Ctrl+←'], description: 'Step focus left (details → tasks → lists)' },
      { keys: ['↑', '↓'], description: 'Move selection' },
      { keys: ['PgUp', 'PgDn'], description: 'Skip 10 rows' },
      { keys: ['Home', 'End'], description: 'First / last' },
    ],
  },
  {
    group: 'Lists (sidebar focused)',
    items: [
      { keys: ['a–z, 0–9'], description: 'Type to search lists (repeat to cycle)' },
      { keys: ['+ button'], description: 'New list' },
      { keys: ['F2', 'Double-click'], description: 'Rename the selected list' },
      { keys: ['Del', 'Backspace'], description: 'Delete the selected list' },
    ],
  },
  {
    group: 'Tasks',
    items: [
      { keys: ['a–z'], description: 'Type to jump to a task (repeat to cycle)' },
      { keys: ['←'], description: 'Collapse, then jump to parent' },
      { keys: ['→'], description: 'Expand a parent, or start a subtask' },
      {
        keys: ['Enter'],
        description: 'Cycle status: needs-action → in-progress → completed',
      },
      { keys: ['Ctrl+N'], description: 'New task at top of list' },
      {
        keys: ['Ctrl+M'],
        description:
          'Move task (and subtree) to another list — stays on the source',
      },
      {
        keys: ['Ctrl+Shift+M'],
        description: 'Move task and follow to the destination list',
      },
      {
        keys: ['Alt+←'],
        description: 'Outdent: become a sibling of the current parent',
      },
      {
        keys: ['Alt+→'],
        description: 'Indent: become a child of the previous sibling',
      },
      { keys: ['+'], description: 'Raise priority on selected task' },
      { keys: ['-'], description: 'Lower priority on selected task' },
      {
        keys: ['0–9'],
        description:
          'Set priority on the hovered task (or selected if none); phone mode uses 0–3',
      },
      { keys: ['F2', 'Ctrl+A', 'Double-click'], description: 'Rename a task' },
      { keys: ['Del', 'Backspace'], description: 'Delete (with confirmation)' },
    ],
  },
  {
    group: 'Filters & sort',
    items: [
      { keys: ['Ctrl+F'], description: 'Open filter and focus search' },
      { keys: ['Ctrl+S'], description: 'Open sort options (per-list)' },
    ],
  },
  {
    group: 'Details',
    items: [
      { keys: ['Ctrl+Enter'], description: 'Inside panel: save & exit' },
      { keys: ['Esc', 'Ctrl+←'], description: 'Leave detail panel' },
    ],
  },
  {
    group: 'View',
    items: [
      {
        keys: ['Ctrl++', 'Ctrl+-'],
        description: 'Zoom the focused zone (list / tasks / detail) in/out',
      },
      { keys: ['Ctrl+0'], description: 'Reset zoom for the focused zone' },
    ],
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Flex column: a fixed header + footer with a scrolling body, so a
          long shortcut list stays reachable as the catalogue grows.
          Rounded-2xl + shadow-2xl + the ring lift the modal off the dim
          backdrop without feeling busy. */}
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
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
        <p className="shrink-0 border-t border-border px-6 py-3 text-[11px] text-text-faint">
          Customizable bindings coming in a later update.
        </p>
      </div>
    </div>
  )
}
