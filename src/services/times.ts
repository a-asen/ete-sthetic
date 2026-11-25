// Wall-clock ⇄ absolute-instant conversion for named IANA timezones,
// plus the display-timezone preference. Everything here is built on the
// standard Intl API — no timezone database dependency.
//
// Two conventions the calendar relies on:
//
// 1. "Wall time" means the y/m/d/h/min fields a human reads on a clock
//    in that zone. For tz-aware events the stored raw keeps wall time in
//    the event's own TZID; the in-memory VEvent.start/end are absolute
//    instants (like every other Date in the app's data model).
// 2. The *display* timezone is where the user is looking from (their
//    travel location). Geometry and labels in the views are computed
//    with system-local Date math, so the views receive events shifted
//    into "wall time in the display tz, expressed as a system-local
//    Date" (render pseudo-instants). With display tz === system tz
//    every conversion is an identity — the default path is unchanged.

export interface WallTime {
  y: number
  m: number // 1-12
  d: number
  h: number
  min: number
  s: number
}

// Parsed-form cache — building an Intl.DateTimeFormat is expensive, and
// the render path calls wallOf() for every event on every layout.
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  return f
}

// The y/m/d/h/min/s a clock in `tz` shows at the given instant.
export function wallOf(date: Date, tz: string): WallTime {
  const parts = partsFormatter(tz).formatToParts(date)
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    min: get('minute'),
    s: get('second'),
  }
}

// Offset (ms) that `tz` adds to UTC at the given instant. Derived from
// the wall clock — the parts trick above works in every environment
// with full ICU data; round to the minute to drop sub-minute noise.
export function tzOffsetMs(tz: string, at: Date): number {
  const ms = at.getTime()
  const w = wallOf(at, tz)
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s)
  return asUtc - Math.floor(ms / 60_000) * 60_000 - (ms % 60_000)
}

// Wall clock in `tz` → absolute instant. Two-pass convergence handles
// the offset that applies at the wall time itself (DST boundary days);
// for ambiguous folded times it lands on the earlier instant, which is
// what calendar apps conventionally pick.
export function instantFromWall(w: WallTime, tz: string): Date {
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s)
  let off = tzOffsetMs(tz, new Date(asUtc))
  let inst = asUtc - off
  off = tzOffsetMs(tz, new Date(inst))
  inst = asUtc - off
  return new Date(inst)
}

// The system's own IANA zone.
export function systemTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

// ---- Display-timezone preference -------------------------------------------

const DISPLAY_TZ_KEY = 'ete-sthetic.displayTz'
export const DISPLAY_TZ_CHANGED_EVENT = 'ete-sthetic:display-tz-changed'

let zoneSet: Set<string> | null = null

export function zoneList(): string[] {
  const zones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf('timeZone')
    : []
  if (!zoneSet) zoneSet = new Set(zones)
  return zones
}

// True when `tz` is a usable zone name for our purposes: a real IANA
// zone from the runtime's database, or the special 'UTC'.
export function knownZone(tz: string | null | undefined): boolean {
  if (!tz) return false
  if (tz === 'UTC') return true
  if (!zoneSet) zoneList()
  return zoneSet!.has(tz)
}

// The zone the calendar renders in. `null` means "follow the system",
// in which case the system zone is used.
export function readDisplayTzPref(): string | null {
  try {
    const raw = localStorage.getItem(DISPLAY_TZ_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as string | null
    return parsed === null || knownZone(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeDisplayTzPref(tz: string | null): void {
  try {
    if (tz === null || knownZone(tz)) {
      localStorage.setItem(DISPLAY_TZ_KEY, JSON.stringify(tz))
    }
  } catch {
    // Non-fatal — the preference just won't persist.
  }
  window.dispatchEvent(new CustomEvent(DISPLAY_TZ_CHANGED_EVENT))
}

// Effective display zone: the stored preference, else the system zone.
export function displayTz(): string {
  return readDisplayTzPref() ?? systemTz()
}

// ---- Render-space conversions ----------------------------------------------

// Absolute instant → "wall in the display zone" written into a
// system-local Date. Formatting it locally and doing wall math on it
// both yield the display-zone reading, which is what the views want.
export function renderOf(instant: Date, tz: string): Date {
  const w = wallOf(instant, tz)
  return new Date(w.y, w.m - 1, w.d, w.h, w.min, w.s)
}

// Reverse of renderOf for grid edits: the render wall time the user
// just set by dragging/resizing (its local fields are the wall clock in
// the DISPLAY zone) → the absolute instant that wall time means.
export function instantOfRender(render: Date, displayTz: string): Date {
  return instantFromWall(
    {
      y: render.getFullYear(),
      m: render.getMonth() + 1,
      d: render.getDate(),
      h: render.getHours(),
      min: render.getMinutes(),
      s: render.getSeconds(),
    },
    displayTz,
  )
}

// Wall-clock fields of a tz-aware event as they should appear in an
// editor: the event's own zone, derived from its render pseudo-instant.
// The wall fields of `render` are display-zone time; convert instant →
// event-zone wall in two hops.
export function eventWallOfRender(render: Date, eventTz: string, displayTz: string): WallTime {
  const inst = instantOfRender(render, displayTz)
  return wallOf(inst, eventTz)
}

// ---- Labels -----------------------------------------------------------------

// "UTC+01:00" / "UTC+05:30" / "UTC−04:00" for a zone, sampled at `at`.
export function tzOffsetLabel(tz: string, at: Date = new Date()): string {
  const min = Math.round(tzOffsetMs(tz, at) / 60_000)
  const sign = min < 0 ? '−' : '+'
  const abs = Math.abs(min)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const m = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${h}:${m}`
}

// "Europe/Oslo · UTC+01:00" — compact zone picker label.
export function tzLabel(tz: string, at: Date = new Date()): string {
  return `${tz} · ${tzOffsetLabel(tz, at)}`
}
