import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  // Called when the user presses Escape. Falls back to onCancel — useful
  // when the keyboard semantic of "give up" should be stronger than the
  // Cancel button (e.g. the save-prompt's Esc means "leave without
  // saving" while clicking Cancel just dismisses the prompt and keeps
  // the user editing).
  onDismiss?: () => void
  // CSS zoom of the zone this modal was triggered from, so it visually
  // matches (e.g. a task-delete confirm matches the task pane's zoom).
  zoom?: number
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  onDismiss,
  zoom = 1,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Which button is "armed". Driven by state (not :focus-visible) so the
  // highlight is ALWAYS visible — programmatic / arrow-key focus doesn't
  // reliably trigger :focus-visible in WebKitGTK, which left the modal
  // looking like nothing was selected. Default to Cancel: safer when the
  // action is destructive, and Enter then needs a deliberate arrow first.
  const [active, setActive] = useState<'cancel' | 'confirm'>('cancel')

  // Mirror the armed button into real DOM focus for screen readers, but the
  // visible highlight comes from `active` below. The buttons' onFocus syncs
  // the other direction so the highlight tracks focus however it moved —
  // WebKitGTK handles Shift+Tab as native back-tab traversal and never fires
  // a cancellable Tab keydown, so without this the green selector would lag.
  useEffect(() => {
    const el = active === 'confirm' ? confirmRef.current : cancelRef.current
    el?.focus()
  }, [active])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ;(onDismiss ?? onCancel)()
        return
      }
      // ← / → map positionally (Cancel is left, Confirm is right); Tab
      // toggles. Either way the highlight follows immediately.
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActive('cancel')
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setActive('confirm')
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setActive((a) => (a === 'cancel' ? 'confirm' : 'cancel'))
        return
      }
      if (e.key === 'Enter') {
        // Ctrl/Cmd+Enter always confirms (matches the DetailPanel shortcut
        // that opens this modal). A bare Enter triggers whichever button is
        // armed.
        e.preventDefault()
        if (e.ctrlKey || e.metaKey || active === 'confirm') onConfirm()
        else onCancel()
      }
    }
    // Capture phase so the focus trap wins over any inner element's
    // keydown handling and the browser's native Tab focus move.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onCancel, onConfirm, onDismiss, active])

  // Inline outline for the armed button — bulletproof against Tailwind
  // purging `ring-*` utilities, and always visible (programmatic focus
  // can't be relied on for :focus-visible in WebKitGTK).
  const armed = {
    outline: '2px solid var(--color-accent)',
    outlineOffset: '2px',
  } as const

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        style={{ zoom }}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-text">{title}</h3>
        {body && <p className="mt-2 text-xs text-text-muted">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            onMouseEnter={() => setActive('cancel')}
            onFocus={() => setActive('cancel')}
            style={active === 'cancel' ? armed : undefined}
            className={`h-8 rounded-md border px-3 text-xs transition-colors ${
              active === 'cancel'
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-muted hover:border-border-strong hover:text-text'
            }`}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            onMouseEnter={() => setActive('confirm')}
            onFocus={() => setActive('confirm')}
            style={active === 'confirm' ? armed : undefined}
            className={`h-8 rounded-md px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 ${
              destructive ? 'bg-danger' : 'bg-accent'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
