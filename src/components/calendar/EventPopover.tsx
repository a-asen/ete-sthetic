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
// full composer; this stays read-only + quick actions. Setting
// `readOnly` hides Edit + Delete (events from external ICS
// subscriptions, or a calendar the user has locked, can't be written
// back). `readOnlyReason` customises the explanatory note.
export function EventPopover({
  item,
  calName,
  x,
  y,
  busy,
  readOnly,
  readOnlyReason,
  onEdit,
  onDelete,
  onClose,
}: {
  item: EventItem
  calName?: string
  x: number
  y: number
  busy: boolean
  readOnly?: boolean
  readOnlyReason?: string
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

  // Dismiss on outside click / Esc / blur — and crucially NOT via a
  // full-screen overlay. A blocking overlay would swallow a right-click on
  // a second event (showing the browser's native menu instead of reopening
  // the popover there); with bare window listeners the event's own
  // onContextMenu fires, replacing this popover with the new one.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const ev = item.event

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ev.summary || 'Event'}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-72 rounded-lg border border-border bg-surface p-4 shadow-xl"
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

        {readOnly ? (
          <div className="mt-4 text-[11px] italic text-text-faint">
            {readOnlyReason ?? 'Read-only — synced from a subscription.'}
          </div>
        ) : (
          // Edit sits left — nearest the cursor/anchor, the primary action;
          // Delete is pushed to the far bottom-right corner, the hardest
          // spot to hit by accident.
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              onClick={onEdit}
              disabled={busy}
              className="h-7 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="h-7 rounded-md border border-border px-2.5 text-xs text-danger hover:border-danger disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
    </div>
  )
}
