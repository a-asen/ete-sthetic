import ICAL from 'ical.js'
import type { EventItem } from '../types'
import { registerTimezones } from './vevent'

// Windowed recurrence expansion. Non-recurring events pass through; for
// RRULE/RDATE/EXDATE events we materialise the occurrences that fall in
// the visible range as synthetic EventItems sharing the real itemUid
// (so edit/delete still act on the series base — per-occurrence editing
// is deferred, see docs/calendar-roadmap.md E3).

// Cap on occurrences *emitted* into the visible window.
const MAX_OCC = 1500
// Hard cap on total iterator steps (incl. pre-window occurrences we skip),
// so a long-running daily rule viewed years after its DTSTART still
// reaches the window instead of being truncated before it.
const MAX_STEPS = 200_000
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

  // Must iterate from the event's real DTSTART: ICAL.Event.iterator(t)
  // *overrides* dtstart with t (it does not fast-forward), which would
  // re-anchor the RRULE to the window and collapse every occurrence onto
  // rangeStart. We skip pre-window occurrences in the loop instead; the
  // MAX_OCC guard bounds a far-future long-running rule.
  let iter: ICAL.RecurExpansion
  try {
    iter = ev.iterator()
  } catch {
    return [item]
  }

  let next: ICAL.Time | null
  let steps = 0
  while ((next = iter.next()) && steps++ < MAX_STEPS && out.length < MAX_OCC) {
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
