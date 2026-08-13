import { useEffect, useState } from 'react'
import type { UnsavedKind } from '../services/unsavedGuard'

const KIND_LABEL: Record<UnsavedKind, string> = {
  task: 'task',
  event: 'event',
  contact: 'contact',
}

// Shown when the user tries to leave the current module while an editor has
// unsaved changes. Three outcomes: Save & switch, Discard & switch, or Keep
// editing (stay). Modeled on ConfirmModal's keyboard/focus handling, but
// with three buttons. Enter = Save, Esc = Keep editing (the safe default).
export function UnsavedSwitchModal({
  kind,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  kind: UnsavedKind
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const [active, setActive] = useState<'cancel' | 'discard' | 'save'>('save')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (saving) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActive((a) =>
          a === 'save' ? 'discard' : a === 'discard' ? 'cancel' : 'cancel',
        )
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault()
        setActive((a) =>
          a === 'cancel' ? 'discard' : a === 'discard' ? 'save' : 'save',
        )
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (active === 'save') onSave()
        else if (active === 'discard') onDiscard()
        else onCancel()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, saving, onSave, onDiscard, onCancel])

  const armed = {
    outline: '2px solid var(--color-accent)',
    outlineOffset: '2px',
  } as const

  const label = KIND_LABEL[kind]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={saving ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-text">
          Unsaved {label} changes
        </h3>
        <p className="mt-2 text-xs text-text-muted">
          You're still editing a {label}. Save it before switching, or discard
          your changes?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            onMouseEnter={() => setActive('cancel')}
            onFocus={() => setActive('cancel')}
            style={active === 'cancel' ? armed : undefined}
            className={`h-8 rounded-md border px-3 text-xs transition-colors disabled:opacity-50 ${
              active === 'cancel'
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-muted hover:border-border-strong hover:text-text'
            }`}
          >
            Keep editing
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onDiscard}
            onMouseEnter={() => setActive('discard')}
            onFocus={() => setActive('discard')}
            style={active === 'discard' ? armed : undefined}
            className={`h-8 rounded-md border px-3 text-xs transition-colors disabled:opacity-50 ${
              active === 'discard'
                ? 'border-danger text-danger'
                : 'border-border text-text-muted hover:border-danger/60 hover:text-danger'
            }`}
          >
            Discard
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            onMouseEnter={() => setActive('save')}
            onFocus={() => setActive('save')}
            style={active === 'save' ? armed : undefined}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & switch'}
          </button>
        </div>
      </div>
    </div>
  )
}
