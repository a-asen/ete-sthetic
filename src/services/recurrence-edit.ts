import ICAL from 'ical.js'
import {
  buildVEvent,
  parseVEvent,
  registerTimezones,
  type VAlarmInput,
  type VEventPatch,
} from './vevent'
import { wallOf } from './times'

// iCalendar surgery for "edit/delete this / this-and-following / all" on a
// recurring series. Deliberately pragmatic for v1 (documented in
// docs/calendar-roadmap.md E3):
//  - times are absolute instants for tz-aware events and serialized in
//    the base DTSTART's own TZID; floating events keep local wall time,
//  - splitting a COUNT-based rule drops COUNT in favour of an UNTIL date.

function veventOf(raw: string): { cal: ICAL.Component; ve: ICAL.Component } {
  const cal = new ICAL.Component(ICAL.parse(raw))
  const ve = cal.name === 'vevent' ? cal : cal.getFirstSubcomponent('vevent')
  if (!ve) throw new Error('VEVENT component missing')
  return { cal, ve }
}

// The base DTSTART's TZID, when the series is tz-aware.
function baseTzid(ve: ICAL.Component): string | undefined {
  const prop = ve.getFirstProperty('dtstart')
  const tzid = prop?.getParameter('tzid')
  if (typeof tzid === 'string' && tzid) return tzid
  return undefined
}

function icalNowUtc(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

function bumpStamps(ve: ICAL.Component): void {
  ve.updatePropertyWithValue('last-modified', icalNowUtc())
  ve.updatePropertyWithValue('dtstamp', icalNowUtc())
}

// Serialize an occurrence instant the way the base RRULE computes
// occurrences: wall time in the base TZID for tz-aware series, local
// fields (floating) otherwise.
function occurrenceTime(
  occStart: Date,
  allDay: boolean,
  tzid?: string,
): ICAL.Time {
  if (!allDay && tzid) {
    const w = wallOf(occStart, tzid)
    return ICAL.Time.fromData({
      year: w.y,
      month: w.m,
      day: w.d,
      hour: w.h,
      minute: w.min,
      second: 0,
    })
  }
  return ICAL.Time.fromData({
    year: occStart.getFullYear(),
    month: occStart.getMonth() + 1,
    day: occStart.getDate(),
    hour: allDay ? 0 : occStart.getHours(),
    minute: allDay ? 0 : occStart.getMinutes(),
    second: 0,
    isDate: allDay,
  })
}

// Exclude a single occurrence from the series (delete-this / detach-this).
export function addExdate(
  baseRaw: string,
  occStart: Date,
  allDay: boolean,
): string {
  const { cal, ve } = veventOf(baseRaw)
  registerTimezones(cal)
  const tzid = baseTzid(ve)
  const prop = ve.addPropertyWithValue(
    'exdate',
    occurrenceTime(occStart, allDay, tzid),
  )
  if (tzid) prop.setParameter('tzid', tzid)
  bumpStamps(ve)
  return cal.toString()
}

// Stop the series before `occStart` (this-and-following). UNTIL is
// inclusive, so we back off one day (all-day) / one second (timed). COUNT
// is dropped (mutually exclusive with UNTIL).
export function truncateUntil(
  baseRaw: string,
  occStart: Date,
  allDay: boolean,
): string {
  const { cal, ve } = veventOf(baseRaw)
  const rruleProp = ve.getFirstProperty('rrule')
  if (!rruleProp) return baseRaw
  const recur = rruleProp.getFirstValue() as ICAL.Recur
  const until = allDay
    ? ICAL.Time.fromData({
        year: occStart.getFullYear(),
        month: occStart.getMonth() + 1,
        day: occStart.getDate(),
        isDate: true,
      })
    : ICAL.Time.fromJSDate(new Date(occStart.getTime() - 1000), true)
  if (allDay) until.adjust(-1, 0, 0, 0)
  recur.until = until
  recur.count = undefined as unknown as number
  rruleProp.setValue(recur)
  bumpStamps(ve)
  return cal.toString()
}

// Read the source VEVENT's VALARMs back into the editable input shape so
// a detached / split occurrence inherits the series' reminders when the
// patch doesn't carry its own set (mirrors how the RRULE is inherited).
function baseAlarmsToInput(raw: string): VAlarmInput[] {
  const parsed = parseVEvent(raw)
  if (!parsed) return []
  return parsed.alarms.map((al) => ({
    relSeconds: al.relSeconds,
    relTo: al.relTo,
    at: al.at,
    action: al.action,
  }))
}

// Translate a patch into buildVEvent args. The patch convention is
// null = clear, undefined = leave untouched — but buildVEvent can only
// "set" or "omit", so undefined fields are resolved against the base
// VEVENT: a drag supplies only start/end/allDay, and the detached/new
// series must keep the base's summary/location/description verbatim.
function patchToArgs(
  patch: VEventPatch,
  ve: ICAL.Component,
  alarms: VAlarmInput[],
) {
  const str = (v: unknown): string | null => {
    if (v == null) return null
    const s = String(v)
    return s === '' ? null : s
  }
  const summary = str(ve.getFirstPropertyValue('summary')) ?? ''
  const location = str(ve.getFirstPropertyValue('location')) ?? undefined
  const description = str(ve.getFirstPropertyValue('description')) ?? undefined
  // A detached occurrence / new split series keeps the base's zone
  // unless the patch sets its own (composer edit).
  const tzid = patch.tzid !== undefined ? patch.tzid ?? undefined : baseTzid(ve)
  return {
    summary: patch.summary ?? summary,
    start: patch.start as Date,
    end: patch.end as Date,
    allDay: patch.allDay ?? false,
    tzid: tzid && !patch.allDay ? tzid : undefined,
    location:
      patch.location === undefined ? location : patch.location || undefined,
    description:
      patch.description === undefined
        ? description
        : patch.description || undefined,
    // A patch that doesn't touch reminders inherits the series' set.
    alarms: patch.alarms ?? alarms,
  }
}

// A standalone, non-recurring event carrying the edited fields (edit-this).
export function detachedEvent(
  baseRaw: string,
  patch: VEventPatch,
): string {
  const { ve } = veventOf(baseRaw)
  return buildVEvent(patchToArgs(patch, ve, baseAlarmsToInput(baseRaw))).raw
}

// A new recurring series starting at the edited occurrence, carrying the
// base RRULE (edit-this-and-following, paired with truncateUntil on base).
export function newSeriesFrom(
  baseRaw: string,
  patch: VEventPatch,
): string {
  const { ve } = veventOf(baseRaw)
  const built = buildVEvent(patchToArgs(patch, ve, baseAlarmsToInput(baseRaw)))
  const baseRrule = ve.getFirstProperty('rrule')
  if (!baseRrule) return built.raw
  const { cal: newCal, ve: newVe } = veventOf(built.raw)
  newVe.addPropertyWithValue(
    'rrule',
    baseRrule.getFirstValue() as ICAL.Recur,
  )
  return newCal.toString()
}
