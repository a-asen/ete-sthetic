import { useEffect, useRef } from 'react'

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

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ;(onDismiss ?? onCancel)()
        return
      }
      // ←/→/Tab all cycle between the two buttons. With only two
      // focusable elements "cycle" == "toggle to the other", which also
      // guarantees focus never lands in an in-between (button-less)
      // state and never escapes the dialog.
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Tab'
      ) {
        e.preventDefault()
        if (document.activeElement === confirmRef.current) {
          cancelRef.current?.focus()
        } else {
          confirmRef.current?.focus()
        }
        return
      }
      // Ctrl/Cmd+Enter confirms regardless of where focus sits (matches the
      // DetailPanel shortcut that opens this modal — pressing the same combo
      // again commits). A bare Enter also confirms unless the user has Tab'd
      // to the Cancel button, where Enter should trigger its native click.
      if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          onConfirm()
          return
        }
        if (
          e.target instanceof HTMLButtonElement ||
          e.target instanceof HTMLAnchorElement
        ) {
          return
        }
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel, onConfirm, onDismiss])

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
            className="h-8 rounded-md border border-border px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`h-8 rounded-md px-3 text-xs font-medium transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
              destructive
                ? 'bg-danger text-bg focus-visible:ring-danger'
                : 'bg-accent text-bg focus-visible:ring-accent'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
