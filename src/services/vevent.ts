import ICAL from 'ical.js'
import type { VAlarm, VEvent } from '../types'

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

// Register any VTIMEZONE definitions carried in the VCALENDAR so that
// ICAL.Time values with a TZID resolve to correct absolute instants.
// Idempotent; safe to call per item. Named IANA zones without an inline
// VTIMEZONE can't be resolved (we fall back to floating/local) — that's
// the documented v1 limit.
export function registerTimezones(comp: ICAL.Component): void {
  for (const vtz of comp.getAllSubcomponents('vtimezone')) {
    const tzid = asString(vtz.getFirstPropertyValue('tzid'))
    if (!tzid || ICAL.TimezoneService.has(tzid)) continue
    try {
      ICAL.TimezoneService.register(
        new ICAL.Timezone({ component: vtz, tzid }),
      )
    } catch {
      // Malformed VTIMEZONE — skip; the time falls back to floating.
    }
  }
}

// Extract VALARM subcomponents into the scheduler-friendly VAlarm shape.
// A TRIGGER is either a DURATION (relative to DTSTART, or DTEND when
// RELATED=END) or an absolute DATE-TIME. Malformed alarms are skipped
// rather than failing the whole event.
function parseAlarms(vevent: ICAL.Component): VAlarm[] {
  const out: VAlarm[] = []
  for (const va of vevent.getAllSubcomponents('valarm')) {
    const action =
      asString(va.getFirstPropertyValue('action'))?.toUpperCase() ?? 'DISPLAY'
    const description = asString(va.getFirstPropertyValue('description'))
    const trig = va.getFirstProperty('trigger')
    if (!trig) continue
    try {
      const val = trig.getFirstValue() as unknown
      if (val instanceof ICAL.Duration) {
        const relTo =
          asString(trig.getParameter('related'))?.toUpperCase() === 'END'
            ? 'end'
            : 'start'
        out.push({
          action,
          description,
          relSeconds: val.toSeconds(),
          relTo,
        })
      } else {
        const at = timeToDate(val)
        if (at) out.push({ action, description, at })
      }
    } catch {
      // Unparseable trigger — ignore this alarm.
    }
  }
  return out
}

export function parseVEvent(raw: string): VEvent | null {
  let comp: ICAL.Component
  try {
    const jcal = ICAL.parse(raw)
    comp = new ICAL.Component(jcal)
  } catch {
    return null
  }

  registerTimezones(comp)

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
    alarms: parseAlarms(vevent),
    created: asString(vevent.getFirstPropertyValue('created')),
    lastModified: asString(vevent.getFirstPropertyValue('last-modified')),
    raw,
  }
}

const PRODID = '-//ete-stethic//EN'

function icalUtcNow(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

// Local wall-clock time (floating, no TZID). v1 keeps timezone handling
// out of scope (calendar-contacts-plan.md); a personal single-tz client
// is fine with floating times. allDay → VALUE=DATE.
function localTime(d: Date, allDay: boolean): ICAL.Time {
  return ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: allDay ? 0 : d.getHours(),
    minute: allDay ? 0 : d.getMinutes(),
    second: 0,
    isDate: allDay,
  })
}

export interface NewVEventArgs {
  summary: string
  start: Date
  end: Date
  allDay: boolean
  description?: string
  location?: string
}

// Build a fresh VCALENDAR + VEVENT for a new event. For all-day events
// DTEND is exclusive per RFC 5545, so callers pass the day after the last
// day; we serialize start/end as VALUE=DATE.
export function buildVEvent(args: NewVEventArgs): { uid: string; raw: string } {
  const uid = crypto.randomUUID()
  const stamp = icalUtcNow()

  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('version', '2.0')
  cal.updatePropertyWithValue('prodid', PRODID)

  const vevent = new ICAL.Component('vevent')
  vevent.updatePropertyWithValue('uid', uid)
  vevent.updatePropertyWithValue('dtstamp', stamp)
  vevent.updatePropertyWithValue('created', stamp)
  vevent.updatePropertyWithValue('last-modified', stamp)
  vevent.updatePropertyWithValue('summary', args.summary)
  vevent.updatePropertyWithValue('dtstart', localTime(args.start, args.allDay))
  vevent.updatePropertyWithValue('dtend', localTime(args.end, args.allDay))
  if (args.description) {
    vevent.updatePropertyWithValue('description', args.description)
  }
  if (args.location) {
    vevent.updatePropertyWithValue('location', args.location)
  }

  cal.addSubcomponent(vevent)
  return { uid, raw: cal.toString() }
}

export interface VEventPatch {
  summary?: string
  start?: Date
  end?: Date
  allDay?: boolean
  // '' or null clears; undefined leaves untouched.
  description?: string | null
  location?: string | null
}

// Update an existing raw VEVENT. Preserves unknown properties (RRULE,
// ATTENDEE, X-*, …) and bumps LAST-MODIFIED/DTSTAMP. allDay must be passed
// alongside start/end so DTSTART/DTEND are re-serialized with the right
// VALUE type.
export function updateVEvent(raw: string, patch: VEventPatch): string {
  const jcal = ICAL.parse(raw)
  const cal = new ICAL.Component(jcal)
  const vevent =
    cal.name === 'vevent' ? cal : cal.getFirstSubcomponent('vevent')
  if (!vevent) throw new Error('VEVENT component missing')

  if (patch.summary !== undefined) {
    vevent.updatePropertyWithValue('summary', patch.summary)
  }
  const allDay =
    patch.allDay ??
    (vevent.getFirstProperty('dtstart')?.getFirstValue() as
      | { isDate?: boolean }
      | undefined)?.isDate === true
  if (patch.start !== undefined) {
    vevent.updatePropertyWithValue('dtstart', localTime(patch.start, allDay))
  }
  if (patch.end !== undefined) {
    vevent.updatePropertyWithValue('dtend', localTime(patch.end, allDay))
  }
  if (patch.description !== undefined) {
    if (!patch.description) vevent.removeAllProperties('description')
    else vevent.updatePropertyWithValue('description', patch.description)
  }
  if (patch.location !== undefined) {
    if (!patch.location) vevent.removeAllProperties('location')
    else vevent.updatePropertyWithValue('location', patch.location)
  }

  vevent.updatePropertyWithValue('last-modified', icalUtcNow())
  vevent.updatePropertyWithValue('dtstamp', icalUtcNow())
  return cal.toString()
}
