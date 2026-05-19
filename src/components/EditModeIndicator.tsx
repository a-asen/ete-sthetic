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

function isWritingTarget(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !NAV_INPUT_TYPES.has(el.type)
  }
  return false
}

// A small fixed pill that appears whenever a text field is focused, so
// it's unmistakable that typing edits text rather than navigating.
export function EditModeIndicator() {
  const [writing, setWriting] = useState(false)

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

  if (!writing) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent-soft px-3 py-1 text-[11px] font-medium text-text shadow-lg"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 2l3 3-8 8-3.5.5.5-3.5 8-8z" />
      </svg>
      Editing — Esc / Enter to exit
    </div>
  )
}
