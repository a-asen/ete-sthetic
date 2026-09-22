import { useEffect, useRef } from 'react'
import type { CollectionInfo } from '../../types'

// Destination picker for "Duplicate to…" — a small list of the writable
// calendars anchored at the right-click position. Picking one runs the
// duplicate; Esc / click-away cancels.

interface Props {
  calendars: CollectionInfo[]
  x: number
  y: number
  busy: boolean
  onPick: (uid: string) => void
  onClose: () => void
}

export function DuplicatePickerPopover({
  calendars,
  x,
  y,
  busy,
  onPick,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Viewport clamp — same approach as ContextMenu / EventPopover.
  const left = Math.min(x, Math.max(8, window.innerWidth - 240 - 8))
  const top = Math.min(
    y,
    Math.max(8, window.innerHeight - Math.min(320, 40 + calendars.length * 30)),
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Duplicate to calendar"
      className="fixed z-50 w-60 overflow-hidden rounded-md border border-border bg-surface shadow-xl"
      style={{ left, top }}
    >
      <div className="border-b border-border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">
        Duplicate to…
      </div>
      {calendars.length === 0 ? (
        <p className="px-2 py-2 text-xs text-text-faint">
          No writable calendars.
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {calendars.map((c) => (
            <li key={c.uid}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(c.uid)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: c.color ?? 'var(--color-accent)' }}
                />
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <div className="border-t border-border px-2 py-1 text-[11px] text-text-faint">
          Duplicating…
        </div>
      )}
    </div>
  )
}