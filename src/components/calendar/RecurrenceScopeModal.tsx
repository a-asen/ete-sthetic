import { useEffect } from 'react'

export type RecurScope = 'this' | 'following' | 'all'

// Asked before editing/deleting an occurrence of a recurring series.
export function RecurrenceScopeModal({
  action,
  busy,
  onPick,
  onClose,
}: {
  action: 'edit' | 'delete'
  busy: boolean
  onPick: (scope: RecurScope) => void
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const verb = action === 'edit' ? 'Edit' : 'Delete'
  const opts: { scope: RecurScope; label: string }[] = [
    { scope: 'this', label: 'This event only' },
    { scope: 'following', label: 'This and following events' },
    { scope: 'all', label: 'All events in the series' },
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${verb} recurring event`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-text">
          {verb} recurring event
        </h3>
        <p className="mt-1 text-xs text-text-muted">
          This event repeats. Apply the {action} to:
        </p>

        <div className="mt-4 space-y-2">
          {opts.map((o) => (
            <button
              key={o.scope}
              type="button"
              disabled={busy}
              onClick={() => onPick(o.scope)}
              className="w-full rounded-md border border-border px-3 py-2 text-left text-sm text-text hover:border-accent hover:bg-surface-2 disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
