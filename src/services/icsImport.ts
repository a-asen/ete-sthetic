import type { VEvent } from '../types'
import { splitIcs } from './ics'
import { parseVEvent } from './vevent'

// Shared helpers for quick-add VEVENT flows (drag-drop .ics file,
// paste-to-import textarea, and — once the OS file association lands
// — the open-with handler). Each surface produces an ICS string,
// hands it to `parseIcsCandidates`, and renders the resulting picker.

export interface IcsImportCandidate {
  // Per-VEVENT VCALENDAR string ready for createEventRaw /
  // replaceEventRaw (VTIMEZONE blocks are carried over by splitIcs).
  raw: string
  // Parsed VEVENT model used to render the picker row.
  event: VEvent
  // The VEVENT UID — used to de-dupe against existing items in the
  // target calendar (iTIP UPDATE semantics: same UID = replace,
  // unseen UID = insert).
  uid: string
}

export function parseIcsCandidates(ics: string): IcsImportCandidate[] {
  const parts = splitIcs(ics)
  const out: IcsImportCandidate[] = []
  for (const raw of parts) {
    const event = parseVEvent(raw)
    if (!event || !event.uid) continue
    out.push({ raw, event, uid: event.uid })
  }
  return out
}

// True when the dropped file looks like an iCalendar payload, by name
// or MIME. Webkit / Tauri sometimes report empty MIME for `.ics`, so
// the extension check is the load-bearing one.
export function isIcsFile(f: File): boolean {
  if (f.name.toLowerCase().endsWith('.ics')) return true
  const t = f.type.toLowerCase()
  return t === 'text/calendar' || t === 'application/ics'
}
