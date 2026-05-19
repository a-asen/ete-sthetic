import ICAL from 'ical.js'
import type { EventItem } from '../types'
import { registerTimezones } from './vevent'

// Windowed recurrence expansion. Non-recurring events pass through; for
// RRULE/RDATE/EXDATE events we materialise the occurrences that fall in
// the visible range as synthetic EventItems sharing the real itemUid
// (so edit/delete still act on the series base — per-occurrence editing
// is deferred, see docs/calendar-roadmap.md E3).

const MAX_OCC = 1500
const cache = new Map<string, { raw: string; occ: EventItem[] }>()

function expandOne(
  item: EventItem,
  rangeStart: Date,
  rangeEnd: Date,
): EventItem[] {
  let comp: ICAL.Component
  try {
    comp = new ICAL.Component(ICAL.parse(item.event.raw))
  } catch {
    return [item]
  }
  registerTimezones(comp)

  const ve =
    comp.name === 'vevent' ? comp : comp.getFirstSubcomponent('vevent')
  if (!ve) return [item]

  let ev: ICAL.Event
  try {
    ev = new ICAL.Event(ve)
  } catch {
    return [item]
  }
  if (!ev.isRecurring()) return [item]

  const startMs = rangeStart.getTime()
  const endMs = rangeEnd.getTime()
  const out: EventItem[] = []

  // Resume iteration near the window when possible — a far-future view of
  // a long-running daily rule would otherwise iterate from DTSTART.
  let iter: ICAL.RecurExpansion
  try {
    iter = ev.iterator(ICAL.Time.fromJSDate(rangeStart, false))
  } catch {
    try {
      iter = ev.iterator()
    } catch {
      return [item]
    }
  }

  let next: ICAL.Time | null
  let n = 0
  while ((next = iter.next()) && n++ < MAX_OCC) {
    if (next.toJSDate().getTime() >= endMs) break
    let details
    try {
      details = ev.getOccurrenceDetails(next)
    } catch {
      continue
    }
    const s = details.startDate.toJSDate()
    const e = details.endDate.toJSDate()
    if (e.getTime() <= startMs) continue
    out.push({
      itemUid: item.itemUid,
      occId: `${item.itemUid}@${s.getTime()}`,
      event: { ...item.event, start: s, end: e },
    })
  }
  return out.length > 0 ? out : []
}

export function expandEvents(
  events: EventItem[],
  rangeStart: Date,
  rangeEnd: Date,
): EventItem[] {
  const out: EventItem[] = []
  for (const item of events) {
    if (!item.event.recurring) {
      out.push(item)
      continue
    }
    const key = `${item.itemUid}|${rangeStart.getTime()}|${rangeEnd.getTime()}`
    const hit = cache.get(key)
    if (hit && hit.raw === item.event.raw) {
      out.push(...hit.occ)
      continue
    }
    const occ = expandOne(item, rangeStart, rangeEnd)
    if (cache.size > 600) cache.clear()
    cache.set(key, { raw: item.event.raw, occ })
    out.push(...occ)
  }
  return out
}
