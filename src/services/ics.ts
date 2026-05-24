import ICAL from 'ical.js'
import type { EventItem } from '../types'

// ICS import/export (roadmap U3). Events are stored one-VEVENT-per-item,
// each wrapped in its own VCALENDAR; export merges them into a single
// RFC 5545 file and import splits a file back into per-event VCALENDARs
// that createEventRaw can ingest.

const PRODID = '-//ete-sthetic//EN'

function newVCalendar(): ICAL.Component {
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('version', '2.0')
  cal.updatePropertyWithValue('prodid', PRODID)
  return cal
}

function veventsOf(comp: ICAL.Component): ICAL.Component[] {
  if (comp.name === 'vevent') return [comp]
  return comp.getAllSubcomponents('vevent')
}

// Merge every event's VEVENT (plus the VTIMEZONE blocks it relies on,
// de-duplicated by TZID) into one downloadable .ics string.
export function buildIcs(events: EventItem[]): string {
  const cal = newVCalendar()
  const seenTz = new Set<string>()

  for (const it of events) {
    let comp: ICAL.Component
    try {
      comp = new ICAL.Component(ICAL.parse(it.event.raw))
    } catch {
      continue // skip an unparseable item rather than abort the export
    }
    for (const vtz of comp.getAllSubcomponents('vtimezone')) {
      const tzid = String(vtz.getFirstPropertyValue('tzid') ?? '')
      if (!tzid || seenTz.has(tzid)) continue
      seenTz.add(tzid)
      cal.addSubcomponent(vtz)
    }
    for (const ve of veventsOf(comp)) cal.addSubcomponent(ve)
  }

  return cal.toString()
}

// Split an imported .ics into standalone per-VEVENT VCALENDAR strings.
// Every VTIMEZONE in the source is carried into each output so TZID
// references still resolve. Returns [] if nothing parseable is found.
export function splitIcs(ics: string): string[] {
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(ics))
  } catch {
    return []
  }

  const vtimezones =
    root.name === 'vcalendar' ? root.getAllSubcomponents('vtimezone') : []
  const vevents = veventsOf(root)

  return vevents.map((ve) => {
    const cal = newVCalendar()
    for (const vtz of vtimezones) cal.addSubcomponent(vtz)
    cal.addSubcomponent(ve)
    return cal.toString()
  })
}
