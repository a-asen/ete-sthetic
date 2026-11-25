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

// ---- Zone names, aliases and suggestions ------------------------------------

let zoneSet: Set<string> | null = null

export function zoneList(): string[] {
  const zones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf('timeZone')
    : []
  if (!zoneSet) zoneSet = new Set(zones)
  return zones
}

// Validity cache: Intl's accepted zone names (which include aliases and
// Etc/* fixed offsets that supportedValuesOf omits).
const zoneValidity = new Map<string, boolean>()

// True when `tz` is a zone name the runtime can format with. More
// permissive than membership in supportedValuesOf: legacy aliases
// (US/Pacific) and Etc/GMT±N fixed offsets are valid too.
export function knownZone(tz: string | null | undefined): boolean {
  if (!tz) return false
  const cached = zoneValidity.get(tz)
  if (cached !== undefined) return cached
  let ok: boolean
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    ok = true
  } catch {
    ok = false
  }
  zoneValidity.set(tz, ok)
  return ok
}

// Collapse case, spaces and separators so "new york", "New_York" and
// "new-york" all match.
function normName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-/()·,.]/g, '')
}

export interface TzAlias {
  // Human label shown in the picker ("Seattle", "Pacific Time", …).
  label: string
  // Canonical IANA zone it resolves to.
  zone: string
}

// Short zone abbreviation ("PST", "CET") when the runtime knows a real
// one — ICU falls back to "GMT+n" for many zones, which is noise.
export function zoneAbbr(zone: string, at: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    if (!name || /^(GMT|UTC)/i.test(name)) return null
    return name
  } catch {
    return null
  }
}

// Broad region names, abbreviations and city aliases, offered beside
// the canonical zones. Order matters: the entries listed first are what
// an empty query surfaces.
const NAMED_ALIASES: TzAlias[] = [
  // Broad, "higher level" names.
  { label: 'UTC (no offset)', zone: 'UTC' },
  { label: 'GMT', zone: 'UTC' },
  { label: 'Pacific Time (PT)', zone: 'America/Los_Angeles' },
  { label: 'Mountain Time (MT)', zone: 'America/Denver' },
  { label: 'Central Time (CT)', zone: 'America/Chicago' },
  { label: 'Eastern Time (ET)', zone: 'America/New_York' },
  { label: 'Alaska Time', zone: 'America/Anchorage' },
  { label: 'Hawaii Time', zone: 'Pacific/Honolulu' },
  { label: 'Atlantic Time', zone: 'America/Halifax' },
  { label: 'Newfoundland Time', zone: 'America/St_Johns' },
  { label: 'British Time', zone: 'Europe/London' },
  { label: 'Central European Time (CET)', zone: 'Europe/Paris' },
  { label: 'Eastern European Time (EET)', zone: 'Europe/Helsinki' },
  { label: 'Moscow Time', zone: 'Europe/Moscow' },
  { label: 'India Time (IST)', zone: 'Asia/Kolkata' },
  { label: 'China Time', zone: 'Asia/Shanghai' },
  { label: 'Japan Time (JST)', zone: 'Asia/Tokyo' },
  { label: 'Korea Time', zone: 'Asia/Seoul' },
  { label: 'Singapore Time', zone: 'Asia/Singapore' },
  { label: 'Australian Eastern Time', zone: 'Australia/Sydney' },
  { label: 'New Zealand Time', zone: 'Pacific/Auckland' },
  { label: 'South Africa Time', zone: 'Africa/Johannesburg' },
  { label: 'Brazil Time', zone: 'America/Sao_Paulo' },
  { label: 'Argentina Time', zone: 'America/Argentina/Buenos_Aires' },
  { label: 'Gulf Time', zone: 'Asia/Dubai' },
  // North American abbreviations.
  { label: 'PST', zone: 'America/Los_Angeles' },
  { label: 'PDT', zone: 'America/Los_Angeles' },
  { label: 'MST', zone: 'America/Denver' },
  { label: 'MDT', zone: 'America/Denver' },
  { label: 'CST', zone: 'America/Chicago' },
  { label: 'CDT', zone: 'America/Chicago' },
  { label: 'EST', zone: 'America/New_York' },
  { label: 'EDT', zone: 'America/New_York' },
  // European and other abbreviations.
  { label: 'CET', zone: 'Europe/Paris' },
  { label: 'CEST', zone: 'Europe/Paris' },
  { label: 'WET', zone: 'Europe/Lisbon' },
  { label: 'BST', zone: 'Europe/London' },
  { label: 'EET', zone: 'Europe/Helsinki' },
  { label: 'AEST', zone: 'Australia/Sydney' },
  { label: 'NZST', zone: 'Pacific/Auckland' },
  // Cities without a zone of their own.
  { label: 'Seattle', zone: 'America/Los_Angeles' },
  { label: 'Portland', zone: 'America/Los_Angeles' },
  { label: 'San Francisco', zone: 'America/Los_Angeles' },
  { label: 'San Diego', zone: 'America/Los_Angeles' },
  { label: 'Las Vegas', zone: 'America/Los_Angeles' },
  { label: 'Los Angeles', zone: 'America/Los_Angeles' },
  { label: 'Phoenix', zone: 'America/Phoenix' },
  { label: 'Denver', zone: 'America/Denver' },
  { label: 'Salt Lake City', zone: 'America/Denver' },
  { label: 'Dallas', zone: 'America/Chicago' },
  { label: 'Houston', zone: 'America/Chicago' },
  { label: 'Austin', zone: 'America/Chicago' },
  { label: 'Chicago', zone: 'America/Chicago' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'Boston', zone: 'America/New_York' },
  { label: 'Washington', zone: 'America/New_York' },
  { label: 'Miami', zone: 'America/New_York' },
  { label: 'Atlanta', zone: 'America/New_York' },
  { label: 'Honolulu', zone: 'Pacific/Honolulu' },
  { label: 'Anchorage', zone: 'America/Anchorage' },
  { label: 'Toronto', zone: 'America/Toronto' },
  { label: 'Montreal', zone: 'America/Toronto' },
  { label: 'Vancouver', zone: 'America/Vancouver' },
  { label: 'Calgary', zone: 'America/Edmonton' },
  { label: 'Mexico City', zone: 'America/Mexico_City' },
  { label: 'Tromsø', zone: 'Europe/Oslo' },
  { label: 'Tromso', zone: 'Europe/Oslo' },
  { label: 'Bergen', zone: 'Europe/Oslo' },
  { label: 'Trondheim', zone: 'Europe/Oslo' },
  { label: 'Stavanger', zone: 'Europe/Oslo' },
  { label: 'Oslo', zone: 'Europe/Oslo' },
  { label: 'Gothenburg', zone: 'Europe/Stockholm' },
  { label: 'Copenhagen', zone: 'Europe/Copenhagen' },
  { label: 'Stockholm', zone: 'Europe/Stockholm' },
  { label: 'Helsinki', zone: 'Europe/Helsinki' },
  { label: 'Reykjavik', zone: 'Atlantic/Reykjavik' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Dublin', zone: 'Europe/Dublin' },
  { label: 'Paris', zone: 'Europe/Paris' },
  { label: 'Berlin', zone: 'Europe/Berlin' },
  { label: 'Amsterdam', zone: 'Europe/Amsterdam' },
  { label: 'Brussels', zone: 'Europe/Brussels' },
  { label: 'Madrid', zone: 'Europe/Madrid' },
  { label: 'Barcelona', zone: 'Europe/Madrid' },
  { label: 'Rome', zone: 'Europe/Rome' },
  { label: 'Zurich', zone: 'Europe/Zurich' },
  { label: 'Vienna', zone: 'Europe/Vienna' },
  { label: 'Prague', zone: 'Europe/Prague' },
  { label: 'Warsaw', zone: 'Europe/Warsaw' },
  { label: 'Budapest', zone: 'Europe/Budapest' },
  { label: 'Athens', zone: 'Europe/Athens' },
  { label: 'Istanbul', zone: 'Europe/Istanbul' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
  { label: 'Osaka', zone: 'Asia/Tokyo' },
  { label: 'Seoul', zone: 'Asia/Seoul' },
  { label: 'Beijing', zone: 'Asia/Shanghai' },
  { label: 'Shanghai', zone: 'Asia/Shanghai' },
  { label: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { label: 'Taipei', zone: 'Asia/Taipei' },
  { label: 'Singapore', zone: 'Asia/Singapore' },
  { label: 'Kuala Lumpur', zone: 'Asia/Kuala_Lumpur' },
  { label: 'Bangkok', zone: 'Asia/Bangkok' },
  { label: 'Jakarta', zone: 'Asia/Jakarta' },
  { label: 'Manila', zone: 'Asia/Manila' },
  { label: 'Delhi', zone: 'Asia/Kolkata' },
  { label: 'Mumbai', zone: 'Asia/Kolkata' },
  { label: 'Bangalore', zone: 'Asia/Kolkata' },
  { label: 'Dubai', zone: 'Asia/Dubai' },
  { label: 'Tel Aviv', zone: 'Asia/Jerusalem' },
  { label: 'Sydney', zone: 'Australia/Sydney' },
  { label: 'Melbourne', zone: 'Australia/Sydney' },
  { label: 'Brisbane', zone: 'Australia/Brisbane' },
  { label: 'Perth', zone: 'Australia/Perth' },
  { label: 'Adelaide', zone: 'Australia/Adelaide' },
  { label: 'Auckland', zone: 'Pacific/Auckland' },
  { label: 'Wellington', zone: 'Pacific/Auckland' },
  { label: 'Cape Town', zone: 'Africa/Johannesburg' },
  { label: 'Johannesburg', zone: 'Africa/Johannesburg' },
  { label: 'Cairo', zone: 'Africa/Cairo' },
  { label: 'Lagos', zone: 'Africa/Lagos' },
  { label: 'Nairobi', zone: 'Africa/Nairobi' },
  { label: 'Bogota', zone: 'America/Bogota' },
  { label: 'Lima', zone: 'America/Lima' },
  { label: 'Santiago', zone: 'America/Santiago' },
  { label: 'Sao Paulo', zone: 'America/Sao_Paulo' },
  { label: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires' },
]

// Fixed-offset zones (no DST): "UTC+02:00 (fixed)" → Etc/GMT-2 (the
// Etc names use the inverted POSIX sign).
const FIXED_OFFSET_ALIASES: TzAlias[] = []
for (let h = -12; h <= 14; h++) {
  if (h === 0) continue
  const sign = h > 0 ? '+' : '−'
  const label = `UTC${sign}${String(Math.abs(h)).padStart(2, '0')}:00`
  FIXED_OFFSET_ALIASES.push({
    label,
    zone: `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`,
  })
}

export const TZ_ALIASES: TzAlias[] = [...NAMED_ALIASES, ...FIXED_OFFSET_ALIASES]

// Resolve free text to a zone: an alias label ("Seattle", "PST",
// "UTC+02:00 (fixed)") or any zone name the runtime accepts. Returns
// null when it is neither.
export function resolveZoneInput(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  // Aliases win over raw zone names: Intl also accepts some legacy
  // abbreviations ("PST"), but we want the canonical zone stored.
  const n = normName(t)
  const hit = TZ_ALIASES.find(
    (a) => normName(a.label) === n || normName(a.zone) === n,
  )
  if (hit) return hit.zone
  return knownZone(t) ? t : null
}

export interface ZoneSuggestion {
  zone: string
  label: string
  // Offset (and abbreviation when the runtime knows one) for display.
  detail: string
}

// Ranked suggestions for the picker: alias labels first, then canonical
// zones, filtered by a case/space/separator-insensitive substring of
// either the label or the zone name. `at` samples the displayed offset.
export function suggestZones(
  query: string,
  at: Date = new Date(),
): ZoneSuggestion[] {
  const q = normName(query.trim())
  const seen = new Set<string>()
  const out: ZoneSuggestion[] = []
  const push = (zone: string, label: string) => {
    if (seen.has(zone)) return
    seen.add(zone)
    const off = tzOffsetLabel(zone, at)
    const abbr = zoneAbbr(zone, at)
    const fixed = zone.startsWith('Etc/') ? 'fixed offset' : ''
    const parts = [zone !== label ? zone : '', abbr ? abbr : '', off, fixed]
      .filter(Boolean)
      .join(' · ')
    out.push({ zone, label, detail: parts })
  }
  for (const a of TZ_ALIASES) {
    if (!q || normName(a.label).includes(q) || normName(a.zone).includes(q)) {
      push(a.zone, a.label)
    }
  }
  for (const z of zoneList()) {
    if (q && !normName(z).includes(q)) continue
    push(z, z)
  }
  return out.slice(0, 80)
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
