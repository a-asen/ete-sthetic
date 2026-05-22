import { useEffect, useState } from 'react'

// Non-interactive text-entry types — focusing one of these means the
// keyboard is "captured" for typing, not tree/zone navigation.
const NAV_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
])

// Dismissal is per app-session: sessionStorage keeps it gone across the
// same window's reloads but a fresh launch shows the hint again. A more
// durable opt-out belongs in a future settings toggle (see the "Hint
// opt-out" TODO).
const DISMISS_KEY = 'ete-stethic.editIndicatorDismissed'

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(v: boolean): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, v ? '1' : '0')
  } catch {
    // sessionStorage disabled — dismissal won't survive a reload.
  }
}

function isWritingTarget(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !NAV_INPUT_TYPES.has(el.type)
  }
  return false
}

// A small fixed pill that appears whenever a text field is focused, so
// it's unmistakable that typing edits text rather than navigating.
// Centred along the bottom edge (out of the way of zone footers that
// sit in the corners) and carries an × to dismiss it for the session.
export function EditModeIndicator() {
  const [writing, setWriting] = useState(false)
  const [dismissed, setDismissed] = useState(() => readDismissed())

  useEffect(() => {
    const sync = () => setWriting(isWritingTarget(document.activeElement))
    sync()
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', sync)
    return () => {
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', sync)
    }
  }, [])

  if (!writing || dismissed) return null

  return (
    <div
      role="status"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/50 bg-accent-soft px-3 py-1 text-[11px] font-medium text-text shadow-lg"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M11 2l3 3-8 8-3.5.5.5-3.5 8-8z" />
      </svg>
      <span>Editing — Esc / Enter to exit</span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          writeDismissed(true)
        }}
        aria-label="Dismiss editing indicator for this session"
        title="Dismiss for this session"
        className="-mr-1 ml-1 flex h-4 w-4 items-center justify-center rounded-full text-text-faint transition-colors hover:bg-bg/40 hover:text-text"
      >
        ×
      </button>
    </div>
  )
}
