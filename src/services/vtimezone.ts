import ICAL from 'ical.js'
import { tzOffsetMs, wallOf } from './times'

// Generate a VCALENDAR VTIMEZONE component for an arbitrary IANA zone
// by sampling its UTC offsets with Intl. ical.js cannot build VTIMEZONEs
// itself and IANA-named DTSTARTs are unreadable for other calendar
// clients without one, so every tz-aware VEVENT we author carries the
// generated component in its own raw (each item is a full VCALENDAR).
//
// The generator emits one STANDARD/DAYLIGHT observance per offset
// segment found in a window around the event (≈ [y-1, y+2] of the
// given date). Onsets without recurrence rules are valid iCalendar —
// each observance applies from its DTSTART until the next one's — and
// exact for events inside the window, which is where events live. A
// segment counts as DAYLIGHT when the offset increases (clocks moved
// forward); zones without transitions produce a single STANDARD.
const HOUR = 3_600_000
const DAY = 24 * HOUR

interface Segment {
  // Onset instant (UTC ms); the first segment starts at the window
  // edge with a synthetic onset.
  from: number
  offsetMs: number
  // Offset that ended at `from` (TZOFFSETFROM).
  prevOffsetMs: number
}

function icalOffset(ms: number): string {
  const min = Math.round(ms / 60_000)
  const sign = min < 0 ? '-' : '+'
  const abs = Math.abs(min)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
}

// Floating ICAL.Time from wall components (serialises without a Z,
// which is what a VTIMEZONE DTSTART wants: onset in the pre-transition
// local time).
function onsetTime(atMs: number, offsetMs: number): ICAL.Time {
  const w = wallOf(new Date(atMs + offsetMs), 'UTC')
  return ICAL.Time.fromData({
    year: w.y,
    month: w.m,
    day: w.d,
    hour: w.h,
    minute: w.min,
    second: w.s,
  })
}

function tzName(tz: string, atMs: number): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date(atMs))
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    if (!name || /^(GMT|UTC)/i.test(name)) return null
    return name.replace(/\s+/g, '')
  } catch {
    return null
  }
}

// Collect the offset segments of `tz` over [start, end] by daily
// sampling, refining each discovered transition down to the hour.
function findSegments(tz: string, start: number, end: number): Segment[] {
  const segments: Segment[] = []
  let prevOffset = tzOffsetMs(tz, new Date(start))
  let prevAt = start
  segments.push({ from: start, offsetMs: prevOffset, prevOffsetMs: prevOffset })

  for (let t = start + DAY; t <= end; t += DAY) {
    const off = tzOffsetMs(tz, new Date(t))
    if (off === prevOffset) {
      prevAt = t
      continue
    }
    // Refine between the last same-offset sample and now.
    let lo = prevAt
    let hi = t
    while (hi - lo > HOUR) {
      const mid = lo + Math.floor((hi - lo) / (2 * HOUR)) * HOUR
      if (tzOffsetMs(tz, new Date(mid)) === prevOffset) lo = mid
      else hi = mid
    }
    segments.push({ from: hi, offsetMs: off, prevOffsetMs: prevOffset })
    prevOffset = off
    prevAt = t
  }
  return segments
}

// Build a VTIMEZONE subcomponent for `tzid`, centred on `around` (use
// the event's own start so the sampled window brackets it).
export function buildVTimezone(tzid: string, around: Date): ICAL.Component {
  const y = around.getFullYear()
  const start = Date.UTC(y - 1, 0, 1)
  const end = Date.UTC(y + 3, 0, 1)
  const segments = findSegments(tzid, start, end)

  const vtz = new ICAL.Component('vtimezone')
  vtz.updatePropertyWithValue('tzid', tzid)

  let first = true
  for (const seg of segments) {
    // Skip a leading synthetic segment when a real transition sits at
    // the window edge (never in practice — window starts on Jan 1).
    const isDaylight = seg.offsetMs > seg.prevOffsetMs
    // The segment's onset is written in the local time that was in
    // effect just before it (its TZOFFSETFROM); the synthetic first
    // segment has no predecessor, so its own offset stands in.
    const fromOff = first ? seg.offsetMs : seg.prevOffsetMs
    const obs = new ICAL.Component(isDaylight ? 'daylight' : 'standard')
    obs.updatePropertyWithValue('dtstart', onsetTime(seg.from, fromOff))
    obs.updatePropertyWithValue('tzoffsetfrom', icalOffset(fromOff))
    obs.updatePropertyWithValue('tzoffsetto', icalOffset(seg.offsetMs))
    const name = tzName(tzid, seg.from + DAY)
    if (name) obs.updatePropertyWithValue('tzname', name)
    vtz.addSubcomponent(obs)
    first = false
  }
  return vtz
}

// True when the given VCALENDAR already carries a VTIMEZONE for tzid.
export function hasVTimezone(cal: ICAL.Component, tzid: string): boolean {
  for (const vtz of cal.getAllSubcomponents('vtimezone')) {
    if (String(vtz.getFirstPropertyValue('tzid')) === tzid) return true
  }
  return false
}
