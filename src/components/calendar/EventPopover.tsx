import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EventItem } from '../../types'

function when(item: EventItem): string {
  const { start, end, allDay } = item.event
  if (!start) return ''
  if (allDay) {
    const last =
      end && end.getTime() - start.getTime() > 24 * 60 * 60 * 1000
        ? new Date(end.getTime() - 24 * 60 * 60 * 1000)
        : start
    return last.getTime() === start.getTime() ||
      last.toDateString() === start.toDateString()
      ? `${start.toLocaleDateString()} · all day`
      : `${start.toLocaleDateString()} – ${last.toLocaleDateString()} · all day`
  }
  const d = start.toLocaleDateString([], { dateStyle: 'medium' })
  const s = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const e = end
    ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return e ? `${d} · ${s} – ${e}` : `${d} · ${s}`
}

// Lightweight detail popover anchored at the click point. Edit opens the
// full composer; this stays read-only + quick actions.
export function EventPopover({
  item,
  calName,
  x,
  y,
  busy,
  onEdit,
  onDelete,
  onClose,
}: {
  item: EventItem
  calName?: string
  x: number
  y: number
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Clamp into the viewport once measured.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

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

  const ev = item.event

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={ev.summary || 'Event'}
        onClick={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="absolute w-72 rounded-lg border border-border bg-surface p-4 shadow-xl"
      >
        <div className="mb-2 flex items-start gap-2">
          <h3 className="min-w-0 flex-1 break-words text-sm font-medium text-text">
            {ev.recurring && '↻ '}
            {ev.summary || '(no title)'}
          </h3>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-text-faint hover:text-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <dl className="space-y-1 text-xs">
          <div className="text-text-muted">{when(item)}</div>
          {calName && (
            <div className="text-text-faint">Calendar: {calName}</div>
          )}
          {ev.location && (
            <div className="text-text-muted">📍 {ev.location}</div>
          )}
          {ev.recurring && (
            <div className="text-text-faint">
              ↻ Recurring · editing changes the whole series
            </div>
          )}
          {ev.description && (
            <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-text-muted">
              {ev.description}
            </p>
          )}
        </dl>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onDelete}
            disabled={busy}
            className="h-7 rounded-md border border-border px-2.5 text-xs text-danger hover:border-danger disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={onEdit}
            disabled={busy}
            className="ml-auto h-7 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}
