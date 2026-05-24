import { useEffect, useMemo, useRef, useState } from 'react'
import {
  parseIcsCandidates,
  type IcsImportCandidate,
} from '../../services/icsImport'

interface Props {
  onCancel: () => void
  onParsed: (candidates: IcsImportCandidate[]) => void
}

// Paste-to-import textarea. The user dumps a raw VCALENDAR block in
// (right-click → View Source on the .ics attachment in most mail
// clients), the modal parses on every keystroke, and the Parse button
// hands the candidates to the parent (which opens the picker).
//
// Lives separately from ImportIcsModal so the picker has a single
// well-defined "I have N candidates" entry point — drag-drop calls
// that directly, and this textarea modal feeds it.
export function PasteIcsModal({ onCancel, onParsed }: Props) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const candidates: IcsImportCandidate[] = useMemo(() => {
    if (!text.trim()) return []
    return parseIcsCandidates(text)
  }, [text])

  function handleParse() {
    if (candidates.length === 0) return
    onParsed(candidates)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paste calendar invite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-text">Paste invite</h3>
          <p className="text-xs text-text-faint">
            Paste the raw VCALENDAR / .ics text below. Most mail
            clients expose this via "Save attachment" or "View source"
            on the invite.
          </p>
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="BEGIN:VCALENDAR&#10;VERSION:2.0&#10;…"
          className="h-48 w-full resize-none rounded-md border border-border bg-surface-2 p-2 font-mono text-[11px] text-text outline-none focus:border-border-strong"
        />

        <p className="text-[11px] text-text-faint">
          {text.trim().length === 0
            ? 'Waiting for VCALENDAR text…'
            : candidates.length === 0
              ? 'No parseable VEVENT found in this text.'
              : candidates.length === 1
                ? '1 event ready to import.'
                : `${candidates.length} events ready to import.`}
        </p>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleParse}
            disabled={candidates.length === 0}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
