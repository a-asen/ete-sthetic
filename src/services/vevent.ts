import ICAL from 'ical.js'
import type { VAlarm, VEvent } from '../types'
import { buildVTimezone, hasVTimezone } from './vtimezone'
import { knownZone, wallOf } from './times'

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
// Idempotent; safe to call per item.
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

// Some producers reference an IANA TZID without embedding a VTIMEZONE
// (technically invalid, common in the wild). ical.js parses such values
// as floating, which would silently misplace the event. Register a
// synthesized VTIMEZONE for each such zone and rehydrate the affected
// properties so both the instant resolution and the recurrence
// expansion below see the real zone.
function ensureZones(vevent: ICAL.Component): void {
  for (const name of ['dtstart', 'dtend', 'recurrence-id'] as const) {
    const prop = vevent.getFirstProperty(name)
    if (!prop) continue
    const tzid = asString(prop.getParameter('tzid'))
    if (!tzid || !knownZone(tzid) || ICAL.TimezoneService.has(tzid)) {
      continue
    }
    const v = prop.getFirstValue() as ICAL.Time | null
    if (!v || v.isDate) continue
    // Center the sampled window on the event's own date so its
    // occurrences resolve in the right observances.
    const around = new Date(v.year, v.month - 1, v.day)
    try {
      ICAL.TimezoneService.register(
        new ICAL.Timezone({
          component: buildVTimezone(tzid, around),
          tzid,
        }),
      )
    } catch {
      continue
    }
    prop.setValue(
      ICAL.Time.fromData(
        {
          year: v.year,
          month: v.month,
          day: v.day,
          hour: v.hour,
          minute: v.minute,
          second: v.second,
          isDate: false,
        },
        ICAL.TimezoneService.get(tzid),
      ),
    )
  }
}

// Read a DTSTART/DTEND/RECURRENCE-ID property's TZID parameter, with
// 'UTC' reported for Z-qualified values.
function propTzid(prop: ICAL.Property | null): string | undefined {
  if (!prop) return undefined
  const tzid = asString(prop.getParameter('tzid'))
  if (tzid) return tzid
  const zone = (prop.getFirstValue() as { zone?: { tzid?: string } } | null)
    ?.zone
  return zone?.tzid === 'UTC' ? 'UTC' : undefined
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

// An editable reminder authored in the composer. The common case is a
// signed offset in seconds from DTSTART (negative = before it, 0 = at
// start). The absolute / end-relative variants exist so imported alarms
// the composer can't present can be carried through unchanged rather than
// dropped on an unrelated edit. We write DISPLAY VALARMs; DESCRIPTION
// falls back to the event summary so the trigger is well-formed for other
// calendar clients (the in-app scheduler ignores it and uses the event
// summary directly).
export interface VAlarmInput {
  relSeconds?: number
  relTo?: 'start' | 'end'
  at?: Date
  // iCalendar ACTION, defaults to DISPLAY when omitted. Carried so an
  // imported EMAIL/AUDIO alarm can round-trip rather than be rewritten.
  action?: string
}

// Replace all VALARM subcomponents on a VEVENT with the given reminders.
function applyAlarms(vevent: ICAL.Component, alarms: VAlarmInput[]): void {
  vevent.removeAllSubcomponents('valarm')
  if (alarms.length === 0) return
  const fallback = asString(vevent.getFirstPropertyValue('summary')) ?? ''
  for (const a of alarms) {
    const va = new ICAL.Component('valarm')
    va.updatePropertyWithValue('action', a.action ?? 'DISPLAY')
    if (a.at) {
      // Absolute trigger: TRIGGER;VALUE=DATE-TIME:<instant>.
      const p = new ICAL.Property('trigger', va)
      p.setValue(ICAL.Time.fromJSDate(a.at, true))
      va.addProperty(p)
    } else if (a.relSeconds != null) {
      const trig = va.updatePropertyWithValue(
        'trigger',
        ICAL.Duration.fromSeconds(a.relSeconds),
      )
      if (a.relTo === 'end') trig.setParameter('related', 'END')
    }
    if (fallback) va.updatePropertyWithValue('description', fallback)
    vevent.addSubcomponent(va)
  }
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

  ensureZones(vevent)

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
  const tzid = propTzid(dtStartProp)
  const start = timeToDate(dtStartVal)

  const dtEndProp = vevent.getFirstProperty('dtend')
  const dtEndVal = dtEndProp?.getFirstValue()
  // DTEND's own zone, reported only when it differs from DTSTART's
  // (a journey that starts in one zone and ends in another).
  const endTzid = propTzid(dtEndProp)
  const tzidEnd =
    !allDay && endTzid && endTzid !== tzid ? endTzid : undefined
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
    tzid,
    tzidEnd,
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

const PRODID = '-//ete-sthetic//EN'

function icalUtcNow(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

// Local wall-clock time (floating, no TZID). The Date's local fields are
// taken verbatim as the wall time to store; allDay → VALUE=DATE.
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

// Write DTSTART/DTEND from a wall-clock Date, attaching the event's
// TZID for timed, tz-aware events ("DTSTART;TZID=Europe/Oslo:…").
// Convention: for tz-aware events the Date is an ABSOLUTE instant and
// is converted to wall time in `tzid` here; floating events take the
// Date's local fields verbatim as the wall time to store.
function setTimeProp(
  vevent: ICAL.Component,
  name: 'dtstart' | 'dtend',
  d: Date,
  allDay: boolean,
  tzid?: string | null,
): void {
  let value: ICAL.Time
  if (!allDay && tzid === 'UTC') {
    value = ICAL.Time.fromJSDate(d, true)
  } else if (!allDay && tzid) {
    const w = wallOf(d, tzid)
    value = ICAL.Time.fromData({
      year: w.y,
      month: w.m,
      day: w.d,
      hour: w.h,
      minute: w.min,
      second: 0,
    })
  } else {
    value = localTime(d, allDay)
  }
  const prop = vevent.updatePropertyWithValue(name, value)
  // updatePropertyWithValue keeps existing parameters on rewrite, so
  // the TZID must be set (overwritten) or explicitly removed per write.
  // ical.js parameter keys are case-sensitive and lowercase from the
  // parser (it uppercases on serialization), so use 'tzid' here.
  if (!allDay && tzid && tzid !== 'UTC') prop.setParameter('tzid', tzid)
  else prop.removeParameter('tzid')
}

// (Re)attach a generated VTIMEZONE for `tzid` centred on the event
// start, dropping a stale one first. Keeps the sample window bracketed
// around the event as it moves through the years.
function syncVTimezone(cal: ICAL.Component, tzid: string, around: Date): void {
  for (const vtz of [...cal.getAllSubcomponents('vtimezone')]) {
    if (String(vtz.getFirstPropertyValue('tzid')) === tzid) {
      cal.removeSubcomponent(vtz)
    }
  }
  cal.addSubcomponent(buildVTimezone(tzid, around))
}

export interface NewVEventArgs {
  summary: string
  start: Date
  end: Date
  allDay: boolean
  // Wall-clock zone for timed events. Undefined = floating local time.
  // When set, `start`/`end` are ABSOLUTE instants (the wall time in
  // this zone is derived on serialize); when unset they are the local
  // wall time to store verbatim.
  tzid?: string
  // DTEND's own zone, when the event ends in a different one than it
  // starts (e.g. a flight). Same instant convention as `tzid`.
  // Undefined = DTEND shares `tzid` / floats with the start.
  tzidEnd?: string
  description?: string
  location?: string
  // RRULE body (without the "RRULE:" prefix), e.g. "FREQ=WEEKLY".
  // Undefined / empty string = non-recurring.
  rrule?: string
  // Reminders to attach (DISPLAY VALARMs). Omitted / empty = none.
  alarms?: VAlarmInput[]
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
  setTimeProp(vevent, 'dtstart', args.start, args.allDay, args.tzid)
  setTimeProp(vevent, 'dtend', args.end, args.allDay, args.tzidEnd ?? args.tzid)
  if (args.description) {
    vevent.updatePropertyWithValue('description', args.description)
  }
  if (args.location) {
    vevent.updatePropertyWithValue('location', args.location)
  }
  if (args.rrule) {
    // RRULE expects a structured value; ICAL.js can parse the string.
    vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(args.rrule))
  }
  applyAlarms(vevent, args.alarms ?? [])

  if (!args.allDay) {
    for (const z of [args.tzid, args.tzidEnd]) {
      if (z && z !== 'UTC') syncVTimezone(cal, z, args.start)
    }
  }
  cal.addSubcomponent(vevent)
  return { uid, raw: cal.toString() }
}

export interface VEventPatch {
  summary?: string
  start?: Date
  end?: Date
  allDay?: boolean
  // Wall-clock zone for timed events. Undefined leaves the source's
  // zone untouched; null reverts to floating local time.
  tzid?: string | null
  // DTEND's own zone (journeys ending in another zone). Undefined
  // leaves the end's zone semantics untouched; null makes DTEND
  // share the (effective) start zone.
  tzidEnd?: string | null
  // '' or null clears; undefined leaves untouched.
  description?: string | null
  location?: string | null
  // RRULE body. '' or null removes the RRULE; undefined leaves
  // whatever the source had untouched (so a non-RRULE-aware edit
  // never accidentally drops the recurrence).
  rrule?: string | null
  // Reminders. undefined leaves the source VALARMs untouched (so a
  // non-reminder-aware edit, e.g. a drag-resize, preserves them); an
  // empty array clears all reminders.
  alarms?: VAlarmInput[]
}

// Update an existing raw VEVENT. Preserves unknown properties (RRULE,
// ATTENDEE, X-*, …) and bumps LAST-MODIFIED/DTSTAMP. allDay must be passed
// alongside start/end so DTSTART/DTEND are re-serialized with the right
// VALUE type. Timed start/end rewrites keep the event's existing TZID
// unless patch.tzid overrides or clears it.
export function updateVEvent(raw: string, patch: VEventPatch): string {
  const jcal = ICAL.parse(raw)
  const cal = new ICAL.Component(jcal)
  const vevent =
    cal.name === 'vevent' ? cal : cal.getFirstSubcomponent('vevent')
  if (!vevent) throw new Error('VEVENT component missing')

  registerTimezones(cal)
  ensureZones(vevent)

  if (patch.summary !== undefined) {
    vevent.updatePropertyWithValue('summary', patch.summary)
  }
  const allDay =
    patch.allDay ??
    (vevent.getFirstProperty('dtstart')?.getFirstValue() as
      | { isDate?: boolean }
      | undefined)?.isDate === true
  const prevTzid = allDay ? undefined : propTzid(vevent.getFirstProperty('dtstart'))
  const prevTzidEnd = allDay ? undefined : propTzid(vevent.getFirstProperty('dtend'))
  // Effective zone for this rewrite: an explicit patch (string = set,
  // null = clear) wins; otherwise keep the event's own zone.
  const tzid = !allDay
    ? patch.tzid !== undefined
      ? patch.tzid || null
      : prevTzid || null
    : null
  // DTEND's zone: an explicit end-zone patch (string = set, null =
  // "same as start") wins. A DTEND that merely mirrored the start's
  // zone keeps mirroring it through start-zone changes; a DTEND with
  // a genuinely different zone keeps its own.
  const endTzid = !allDay
    ? patch.tzidEnd !== undefined
      ? patch.tzidEnd || tzid
      : prevTzidEnd === prevTzid
        ? tzid
        : prevTzidEnd || tzid
    : null
  if (patch.start !== undefined) {
    setTimeProp(vevent, 'dtstart', patch.start, allDay, tzid)
  } else if (patch.tzid !== undefined && !allDay) {
    // Zone-only patch: re-serialize DTSTART at the same instant, just
    // expressed in the new zone.
    const cur = timeToDate(vevent.getFirstProperty('dtstart')?.getFirstValue())
    if (cur) setTimeProp(vevent, 'dtstart', cur, allDay, tzid)
  }
  if (patch.end !== undefined) {
    setTimeProp(vevent, 'dtend', patch.end, allDay, endTzid)
  } else if (
    !allDay &&
    (patch.tzidEnd !== undefined || (patch.tzid !== undefined && endTzid !== prevTzidEnd))
  ) {
    // Zone-only patch: a DTEND whose effective zone changed (its own
    // was patched, or it mirrors the start's) re-serializes at the
    // same instant in the new zone.
    const cur = timeToDate(vevent.getFirstProperty('dtend')?.getFirstValue())
    if (cur) setTimeProp(vevent, 'dtend', cur, allDay, endTzid)
  }
  // We standardise on DTEND for the end. If the source carried a DURATION
  // (mutually exclusive with DTEND per RFC 5545), drop it whenever we
  // rewrite the time window — otherwise a lingering DURATION can win over
  // our new DTEND (e.g. ICAL.Event prefers DURATION when expanding a
  // recurring series), silently resizing an event we only meant to move.
  if (patch.start !== undefined || patch.end !== undefined) {
    vevent.removeAllProperties('duration')
  }
  if (patch.description !== undefined) {
    if (!patch.description) vevent.removeAllProperties('description')
    else vevent.updatePropertyWithValue('description', patch.description)
  }
  if (patch.location !== undefined) {
    if (!patch.location) vevent.removeAllProperties('location')
    else vevent.updatePropertyWithValue('location', patch.location)
  }
  if (patch.rrule !== undefined) {
    if (!patch.rrule) vevent.removeAllProperties('rrule')
    else
      vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(patch.rrule))
  }
  if (patch.alarms !== undefined) applyAlarms(vevent, patch.alarms)

  // VTIMEZONE upkeep: every zone the time properties reference needs a
  // definition (attach/regenerate when a zone was explicitly patched or
  // is missing); zones dropped by a patch lose theirs. Plain time-moves
  // inside the already-sampled window don't regenerate — the existing
  // observances stay valid.
  if (cal.name !== 'vevent' && !allDay) {
    const zones = new Set(
      [tzid, endTzid].filter((z): z is string => !!z && z !== 'UTC'),
    )
    const aroundFor = (z: string): Date | null => {
      const dt = asString(
        z === tzid
          ? vevent.getFirstPropertyValue('dtstart')
          : vevent.getFirstPropertyValue('dtend'),
      )
      const around =
        z === tzid ? patch.start : patch.end ?? patch.start
      const fromStored = dt ? new Date(dt) : null
      const pick = around ?? fromStored
      return pick && !Number.isNaN(pick.getTime()) ? pick : new Date()
    }
    for (const z of zones) {
      if (
        patch.tzid !== undefined ||
        patch.tzidEnd !== undefined ||
        !hasVTimezone(cal, z)
      ) {
        syncVTimezone(cal, z, aroundFor(z) ?? new Date())
      }
    }
    for (const z of [prevTzid, prevTzidEnd]) {
      if (z && z !== 'UTC' && !zones.has(z)) {
        for (const vtz of [...cal.getAllSubcomponents('vtimezone')]) {
          if (String(vtz.getFirstPropertyValue('tzid')) === z) {
            cal.removeSubcomponent(vtz)
          }
        }
      }
    }
  }

  vevent.updatePropertyWithValue('last-modified', icalUtcNow())
  vevent.updatePropertyWithValue('dtstamp', icalUtcNow())
  return cal.toString()
}

// Clone a VEVENT's raw for duplication: fresh UID (a same-UID copy is a
// sync hazard — two items fighting over one identity), fresh
// DTSTAMP/CREATED/LAST-MODIFIED. A RECURRENCE-ID (a detached instance)
// is dropped so the copy is a standalone event, and a RECURRENCE-ID
// without its RRULE parent would be meaningless anyway. Everything
// else — RRULE, ATTENDEE, VALARM, X-* — is preserved verbatim.
export function cloneVEventRaw(raw: string): { uid: string; raw: string } {
  const uid = crypto.randomUUID()
  const jcal = ICAL.parse(raw)
  const cal = new ICAL.Component(jcal)
  const vevent =
    cal.name === 'vevent' ? cal : cal.getFirstSubcomponent('vevent')
  if (!vevent) throw new Error('VEVENT component missing')
  vevent.updatePropertyWithValue('uid', uid)
  vevent.removeAllProperties('recurrence-id')
  const stamp = icalUtcNow()
  vevent.updatePropertyWithValue('dtstamp', stamp)
  vevent.updatePropertyWithValue('created', stamp)
  vevent.updatePropertyWithValue('last-modified', stamp)
  return { uid, raw: cal.toString() }
}
