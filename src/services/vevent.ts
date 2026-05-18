import ICAL from 'ical.js'
import type { VEvent } from '../types'

// Mirror of services/vtodo.ts:parseVTodo, for VEVENT. ical.js is already a
// dependency and parses VEVENT with the same ICAL.Component shape, so this
// is deliberately a near-copy (calendar-contacts-plan.md §2).

function asString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value)
  }
  return undefined
}

// ICAL.Time → JS Date. For VALUE=DATE values toJSDate() yields local
// midnight, which is what the month grid wants.
function timeToDate(t: unknown): Date | undefined {
  if (t && typeof (t as { toJSDate?: unknown }).toJSDate === 'function') {
    try {
      return (t as { toJSDate: () => Date }).toJSDate()
    } catch {
      return undefined
    }
  }
  return undefined
}

export function parseVEvent(raw: string): VEvent | null {
  let comp: ICAL.Component
  try {
    const jcal = ICAL.parse(raw)
    comp = new ICAL.Component(jcal)
  } catch {
    return null
  }

  const vevent =
    comp.name === 'vevent' ? comp : comp.getFirstSubcomponent('vevent')
  if (!vevent) return null

  const uid = vevent.getFirstPropertyValue('uid')
  if (!uid) return null

  const summary = asString(vevent.getFirstPropertyValue('summary')) ?? ''
  const description = asString(vevent.getFirstPropertyValue('description'))
  const location = asString(vevent.getFirstPropertyValue('location'))
  const status = asString(vevent.getFirstPropertyValue('status'))?.toUpperCase()

  const dtStartProp = vevent.getFirstProperty('dtstart')
  const dtStartVal = dtStartProp?.getFirstValue() as
    | { isDate?: boolean; toJSDate?: () => Date }
    | undefined
  const allDay = dtStartVal?.isDate === true
  const start = timeToDate(dtStartVal)

  const dtEndVal = vevent.getFirstProperty('dtend')?.getFirstValue()
  let end = timeToDate(dtEndVal)
  // No DTEND: fall back to DTSTART + DURATION, else a zero-length event.
  if (!end && start) {
    const durProp = vevent.getFirstPropertyValue('duration') as
      | { toSeconds?: () => number }
      | undefined
    if (durProp && typeof durProp.toSeconds === 'function') {
      end = new Date(start.getTime() + durProp.toSeconds() * 1000)
    } else if (allDay) {
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    } else {
      end = start
    }
  }

  const rruleVal = vevent.getFirstPropertyValue('rrule')
  const rrule = rruleVal ? asString(rruleVal) : undefined

  const categories: string[] = []
  for (const prop of vevent.getAllProperties('categories')) {
    for (const value of prop.getValues()) {
      const s = asString(value)?.trim()
      if (s) categories.push(s)
    }
  }

  return {
    uid: String(uid),
    summary,
    description,
    location,
    dtStart: asString(vevent.getFirstPropertyValue('dtstart')),
    dtEnd: asString(vevent.getFirstPropertyValue('dtend')),
    allDay,
    start,
    end,
    status,
    categories,
    rrule,
    recurring: !!rrule,
    created: asString(vevent.getFirstPropertyValue('created')),
    lastModified: asString(vevent.getFirstPropertyValue('last-modified')),
    raw,
  }
}
