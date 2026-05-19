import { useEffect } from 'react'
import { parseVEvent } from '../../services/vevent'
import type { VEvent } from '../../types'

function fmt(ev: VEvent | null): { label: string; value: string }[] {
  if (!ev) return [{ label: 'Parse', value: '(unreadable)' }]
  const t = (d?: Date) =>
    d
      ? ev.allDay
        ? d.toLocaleDateString()
        : d.toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
      : '—'
  return [
    { label: 'Title', value: ev.summary || '(no title)' },
    { label: 'Start', value: t(ev.start) },
    { label: 'End', value: t(ev.end) },
    { label: 'Location', value: ev.location || '—' },
    { label: 'Description', value: ev.description || '—' },
  ]
}

// Whole-item conflict prompt: the event changed on the server while the
// user was editing it locally. Shows both sides; the user keeps one.
// (Per the agreed scope — field-level merge is out of v1.)
export function ConflictModal({
  localRaw,
  serverRaw,
  busy,
  onKeepLocal,
  onKeepCloud,
  onClose,
}: {
  localRaw: string
  serverRaw: string
  busy: boolean
  onKeepLocal: () => void
  onKeepCloud: () => void
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

  const local = fmt(parseVEvent(localRaw))
  const cloud = fmt(parseVEvent(serverRaw))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sync conflict"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-medium text-text">Sync conflict</h3>
        <p className="mt-1 text-xs text-text-muted">
          This event also changed on the server. Choose which version to
          keep — or close and reconcile manually.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {(
            [
              ['Your version', local],
              ['Server version', cloud],
            ] as const
          ).map(([title, rows]) => (
            <div
              key={title}
              className="rounded-md border border-border bg-bg p-3"
            >
              <div className="mb-2 text-xs font-semibold text-text-muted">
                {title}
              </div>
              <dl className="space-y-1 text-xs">
                {rows.map((r) => (
                  <div key={r.label} className="flex gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">
                      {r.label}
                    </dt>
                    <dd className="min-w-0 break-words text-text">
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onKeepCloud}
            disabled={busy}
            className="ml-auto h-8 rounded-md border border-border px-3 text-xs text-text hover:border-border-strong disabled:opacity-50"
          >
            Keep server
          </button>
          <button
            type="button"
            onClick={onKeepLocal}
            disabled={busy}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Keep mine'}
          </button>
        </div>
      </div>
    </div>
  )
}
