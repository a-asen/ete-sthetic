import ICAL from 'ical.js'
import { buildVEvent, type VEventPatch } from './vevent'

// iCalendar surgery for "edit/delete this / this-and-following / all" on a
// recurring series. Deliberately pragmatic for v1 (documented in
// docs/calendar-roadmap.md E3):
//  - times are treated as floating local / UTC; TZID-preserving rewrites
//    are out of scope,
//  - splitting a COUNT-based rule drops COUNT in favour of an UNTIL date.

function veventOf(raw: string): { cal: ICAL.Component; ve: ICAL.Component } {
  const cal = new ICAL.Component(ICAL.parse(raw))
  const ve = cal.name === 'vevent' ? cal : cal.getFirstSubcomponent('vevent')
  if (!ve) throw new Error('VEVENT component missing')
  return { cal, ve }
}

function icalNowUtc(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

function bumpStamps(ve: ICAL.Component): void {
  ve.updatePropertyWithValue('last-modified', icalNowUtc())
  ve.updatePropertyWithValue('dtstamp', icalNowUtc())
}

function occurrenceTime(occStart: Date, allDay: boolean): ICAL.Time {
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
  ve.addPropertyWithValue('exdate', occurrenceTime(occStart, allDay))
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

function patchToArgs(patch: VEventPatch, base: { summary: string }) {
  return {
    summary: patch.summary ?? base.summary,
    start: patch.start as Date,
    end: patch.end as Date,
    allDay: patch.allDay ?? false,
    location: patch.location ?? undefined,
    description: patch.description ?? undefined,
  }
}

// A standalone, non-recurring event carrying the edited fields (edit-this).
export function detachedEvent(
  baseRaw: string,
  patch: VEventPatch,
): string {
  const { ve } = veventOf(baseRaw)
  const summary =
    (ve.getFirstPropertyValue('summary') as string | null) ?? ''
  return buildVEvent(patchToArgs(patch, { summary })).raw
}

// A new recurring series starting at the edited occurrence, carrying the
// base RRULE (edit-this-and-following, paired with truncateUntil on base).
export function newSeriesFrom(
  baseRaw: string,
  patch: VEventPatch,
): string {
  const { ve } = veventOf(baseRaw)
  const summary =
    (ve.getFirstPropertyValue('summary') as string | null) ?? ''
  const built = buildVEvent(patchToArgs(patch, { summary }))
  const baseRrule = ve.getFirstProperty('rrule')
  if (!baseRrule) return built.raw
  const { cal: newCal, ve: newVe } = veventOf(built.raw)
  newVe.addPropertyWithValue(
    'rrule',
    baseRrule.getFirstValue() as ICAL.Recur,
  )
  return newCal.toString()
}
