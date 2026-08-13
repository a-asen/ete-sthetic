import ICAL from 'ical.js'
import type { VTodo } from '../types'
import { parseICalDate } from './caldate'
import type { DateValue, VTodoPatch } from './vtodo'

// Shared RRULE helpers used by both the calendar event composer and the
// task recurrence editor. The parse/serialize surface is deliberately
// limited (FREQ + INTERVAL + BYDAY + monthly day/weekday + COUNT/UNTIL);
// rules outside it round-trip verbatim via `customSupportsRrule`.

// ---- Preset detection ----

export type RepeatPreset =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom'

export function detectPreset(rrule?: string): RepeatPreset {
  if (!rrule) return 'none'
  const normalized = rrule.trim().toUpperCase().replace(/\s+/g, '')
  if (normalized === 'FREQ=DAILY') return 'daily'
  if (normalized === 'FREQ=WEEKLY') return 'weekly'
  if (normalized === 'FREQ=MONTHLY') return 'monthly'
  if (normalized === 'FREQ=YEARLY') return 'yearly'
  return 'custom'
}

// ---- Custom RRULE editor model ----

export type CustomFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export type TermKind = 'never' | 'count' | 'until'
export type MonthlyMode = 'day' | 'weekday'
// Positional ordinal for monthly-by-weekday: 1=first … 5=fifth, -1=last.
export type MonthlyWeekN = 1 | 2 | 3 | 4 | 5 | -1

// Render order for the position toggles + serialized BYSETPOS / BYDAY.
export const MONTH_POSITIONS: readonly MonthlyWeekN[] = [1, 2, 3, 4, 5, -1]

export function ordinalLabel(n: MonthlyWeekN): string {
  return n === -1 ? 'last' : ['', '1st', '2nd', '3rd', '4th', '5th'][n]
}

export interface CustomRrule {
  freq: CustomFreq
  interval: number
  byday: Set<Weekday>
  monthlyMode: MonthlyMode
  monthDay: number
  // Monthly-by-weekday: which weekdays at which ordinal positions. One
  // weekday × one position serializes to the familiar positional BYDAY
  // (e.g. BYDAY=1MO); anything wider uses BYDAY=<days>;BYSETPOS=<positions>
  // (e.g. "last weekday" = BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1).
  monthWeekdays: Set<Weekday>
  monthPositions: Set<MonthlyWeekN>
  term: TermKind
  count: number
  until: string // YYYY-MM-DD; only used when term === 'until'
}

export const WEEKDAYS: readonly Weekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
]

const WEEKDAY_LABEL: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

export function emptyCustomRrule(): CustomRrule {
  return {
    freq: 'WEEKLY',
    interval: 1,
    byday: new Set(),
    monthlyMode: 'day',
    monthDay: 1,
    monthWeekdays: new Set<Weekday>(['MO']),
    monthPositions: new Set<MonthlyWeekN>([1]),
    term: 'never',
    count: 10,
    until: '',
  }
}

function isMonthlyWeekN(n: number): n is MonthlyWeekN {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === -1
}

// Decode a MONTHLY BYDAY (+ optional BYSETPOS) into the editor's
// weekday×position model, or null when it can't be represented losslessly.
//
//  - BYDAY bare + BYSETPOS  → weekdays = BYDAY, positions = BYSETPOS
//      (the canonical "Nth of these weekdays" / "last weekday" form).
//  - BYDAY positional, no BYSETPOS → only when every token shares ONE
//      weekday (e.g. 1MO,3MO ⇒ {MO}×{1,3}). Mixed weekdays with their own
//      positions (1MO,1WE) mean independent days, which BYSETPOS can't
//      express, so we bail and let the caller preserve it verbatim.
function parseMonthlyByday(
  byday: string,
  bysetpos?: string,
): { weekdays: Set<Weekday>; positions: Set<MonthlyWeekN> } | null {
  const tokens = byday.split(',').filter(Boolean)
  if (tokens.length === 0) return null
  if (bysetpos != null) {
    const weekdays = new Set<Weekday>()
    for (const t of tokens) {
      if (!/^(MO|TU|WE|TH|FR|SA|SU)$/.test(t)) return null
      weekdays.add(t as Weekday)
    }
    const positions = new Set<MonthlyWeekN>()
    for (const p of bysetpos.split(',').filter(Boolean)) {
      const n = Number(p)
      if (!Number.isInteger(n) || !isMonthlyWeekN(n)) return null
      positions.add(n)
    }
    if (positions.size === 0) return null
    return { weekdays, positions }
  }
  const positions = new Set<MonthlyWeekN>()
  let weekday: Weekday | null = null
  for (const t of tokens) {
    const m = t.match(/^(-?\d+)(MO|TU|WE|TH|FR|SA|SU)$/)
    if (!m) return null
    const n = Number(m[1])
    if (!isMonthlyWeekN(n)) return null
    const wd = m[2] as Weekday
    if (weekday === null) weekday = wd
    else if (weekday !== wd) return null
    positions.add(n)
  }
  if (weekday === null) return null
  return { weekdays: new Set<Weekday>([weekday]), positions }
}

// Parse an existing RRULE string into the editor's state. Unrecognised
// parts (BYSETPOS, multiple BYMONTHDAY, etc.) are dropped from the editor's
// view — callers pair this with `customSupportsRrule` to preserve verbatim.
export function parseRruleToCustom(rrule: string): CustomRrule {
  const out = emptyCustomRrule()
  const map = new Map<string, string>()
  for (const part of rrule.trim().toUpperCase().split(';')) {
    const [k, v] = part.split('=')
    if (k && v != null) map.set(k, v)
  }

  const freq = map.get('FREQ')
  if (
    freq === 'DAILY' ||
    freq === 'WEEKLY' ||
    freq === 'MONTHLY' ||
    freq === 'YEARLY'
  ) {
    out.freq = freq
  }

  const interval = Number(map.get('INTERVAL'))
  if (Number.isFinite(interval) && interval >= 1) {
    out.interval = Math.floor(interval)
  }

  if (out.freq === 'MONTHLY') {
    const byday = map.get('BYDAY')
    const bymonthday = map.get('BYMONTHDAY')
    if (byday) {
      const parsed = parseMonthlyByday(byday, map.get('BYSETPOS'))
      if (parsed) {
        out.monthlyMode = 'weekday'
        out.monthWeekdays = parsed.weekdays
        out.monthPositions = parsed.positions
      }
    } else if (bymonthday) {
      const n = Number(bymonthday.split(',')[0])
      if (Number.isFinite(n) && n >= 1 && n <= 31) {
        out.monthlyMode = 'day'
        out.monthDay = Math.floor(n)
      }
    }
  } else if (out.freq === 'WEEKLY' || out.freq === 'DAILY') {
    const byday = map.get('BYDAY')
    if (byday) {
      for (const raw of byday.split(',')) {
        const code = raw.replace(/^[-+]?\d+/, '') as Weekday
        if (WEEKDAYS.includes(code)) out.byday.add(code)
      }
    }
  }

  const count = Number(map.get('COUNT'))
  if (map.has('COUNT') && Number.isFinite(count) && count >= 1) {
    out.term = 'count'
    out.count = Math.floor(count)
  }
  const until = map.get('UNTIL')
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})/)
    if (m) {
      out.term = 'until'
      out.until = `${m[1]}-${m[2]}-${m[3]}`
    }
  }
  return out
}

// True when the editor's surface can fully represent a given RRULE
// (FREQ + INTERVAL + BYDAY + COUNT/UNTIL only). Used to decide whether to
// send the freshly-serialised RRULE or preserve the stored one verbatim.
export function customSupportsRrule(rrule: string): boolean {
  const map = new Map<string, string>()
  for (const part of rrule.trim().toUpperCase().split(';')) {
    const [k, v] = part.split('=')
    if (!k) continue
    if (v == null) return false
    map.set(k, v)
  }
  const freq = map.get('FREQ')
  if (
    freq !== 'DAILY' &&
    freq !== 'WEEKLY' &&
    freq !== 'MONTHLY' &&
    freq !== 'YEARLY'
  ) {
    return false
  }

  // Whitelist the keys our surface understands for this FREQ — anything
  // else (BYMONTH, BYWEEKNO, EXDATE, a stray BY* on YEARLY we'd drop on
  // re-serialize, …) means "preserve verbatim".
  const allowed = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST'])
  if (freq === 'WEEKLY' || freq === 'DAILY') allowed.add('BYDAY')
  if (freq === 'MONTHLY') {
    allowed.add('BYDAY')
    allowed.add('BYMONTHDAY')
    allowed.add('BYSETPOS')
  }
  for (const k of map.keys()) {
    if (!allowed.has(k)) return false
  }

  if (freq === 'WEEKLY' || freq === 'DAILY') {
    const byday = map.get('BYDAY')
    if (byday != null) {
      for (const code of byday.split(',')) {
        if (!/^(MO|TU|WE|TH|FR|SA|SU)$/.test(code)) return false
      }
    }
  }

  if (freq === 'MONTHLY') {
    const byday = map.get('BYDAY')
    const bymonthday = map.get('BYMONTHDAY')
    const bysetpos = map.get('BYSETPOS')
    if (byday != null && bymonthday != null) return false
    if (bymonthday != null) {
      if (bysetpos != null) return false
      if (!/^([1-9]|[12]\d|3[01])$/.test(bymonthday)) return false
    } else if (byday != null) {
      if (parseMonthlyByday(byday, bysetpos) == null) return false
    } else if (bysetpos != null) {
      return false // BYSETPOS with no BYDAY isn't modeled
    }
  }
  return true
}

export function serializeCustomRrule(c: CustomRrule): string {
  const parts: string[] = [`FREQ=${c.freq}`]
  if (c.interval > 1) parts.push(`INTERVAL=${c.interval}`)
  if (c.freq === 'WEEKLY' && c.byday.size > 0) {
    parts.push(`BYDAY=${WEEKDAYS.filter((w) => c.byday.has(w)).join(',')}`)
  }
  if (c.freq === 'MONTHLY') {
    if (c.monthlyMode === 'day') {
      const d = Math.max(1, Math.min(31, c.monthDay))
      parts.push(`BYMONTHDAY=${d}`)
    } else {
      // Keep a stable order and fall back to a sane default if a set was
      // somehow emptied in the UI.
      const days = WEEKDAYS.filter((w) => c.monthWeekdays.has(w))
      const positions = MONTH_POSITIONS.filter((p) => c.monthPositions.has(p))
      const dayList = days.length > 0 ? days : ['MO']
      const posList = positions.length > 0 ? positions : [1]
      if (dayList.length === 1 && posList.length === 1) {
        // The familiar single positional BYDAY (e.g. BYDAY=1MO).
        parts.push(`BYDAY=${posList[0]}${dayList[0]}`)
      } else {
        // "Nth of these weekdays" — BYDAY=<days>;BYSETPOS=<positions>.
        parts.push(`BYDAY=${dayList.join(',')}`)
        parts.push(`BYSETPOS=${posList.join(',')}`)
      }
    }
  }
  if (c.term === 'count') {
    parts.push(`COUNT=${Math.max(1, c.count)}`)
  } else if (c.term === 'until' && c.until) {
    parts.push(`UNTIL=${c.until.replace(/-/g, '')}`)
  }
  return parts.join(';')
}

// ---- Human-readable summary ----

// A short, lossy one-line description for chips/labels, e.g.
// "Every 2 weeks on Mon, Wed" or "Monthly on day 15". Falls back to the
// raw rule for forms the editor can't model.
export function humanizeRrule(rrule: string): string {
  if (!customSupportsRrule(rrule)) return rrule
  const c = parseRruleToCustom(rrule)
  const every = c.interval > 1 ? `Every ${c.interval} ` : 'Every '
  let base: string
  switch (c.freq) {
    case 'DAILY':
      base = c.interval > 1 ? `${every}days` : 'Daily'
      break
    case 'WEEKLY': {
      base = c.interval > 1 ? `${every}weeks` : 'Weekly'
      if (c.byday.size > 0) {
        const days = WEEKDAYS.filter((w) => c.byday.has(w))
          .map((w) => WEEKDAY_LABEL[w])
          .join(', ')
        base += ` on ${days}`
      }
      break
    }
    case 'MONTHLY':
      base = c.interval > 1 ? `${every}months` : 'Monthly'
      if (c.monthlyMode === 'day') base += ` on day ${c.monthDay}`
      else {
        const ords = MONTH_POSITIONS.filter((p) => c.monthPositions.has(p))
          .map(ordinalLabel)
          .join(', ')
        const days = WEEKDAYS.filter((w) => c.monthWeekdays.has(w))
          .map((w) => WEEKDAY_LABEL[w])
          .join(', ')
        base += ` on the ${ords || '1st'} ${days || 'Mon'}`
      }
      break
    case 'YEARLY':
      base = c.interval > 1 ? `${every}years` : 'Yearly'
      break
  }
  if (c.term === 'count') base += `, ${c.count}×`
  else if (c.term === 'until' && c.until) base += `, until ${c.until}`
  return base
}

// ---- Regenerate-on-complete (tasks) ----

function jsToIcalTime(d: Date, hasTime: boolean): ICAL.Time {
  return ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: hasTime ? d.getHours() : 0,
    minute: hasTime ? d.getMinutes() : 0,
    second: hasTime ? d.getSeconds() : 0,
    isDate: !hasTime,
  })
}

// The first occurrence strictly after `from` per `rrule`. Anchors the
// iterator at `from` (the task's current due/start), so COUNT/UNTIL are
// interpreted relative to that — fine for the roll-forward model, which
// only ever needs the *next* step and tracks COUNT separately. Returns
// null when the rule yields nothing further (e.g. UNTIL already passed).
export function nextOccurrence(
  rrule: string,
  from: Date,
  hasTime: boolean,
): Date | null {
  let recur: ICAL.Recur
  try {
    recur = ICAL.Recur.fromString(rrule)
  } catch {
    return null
  }
  let iter: ICAL.RecurIterator
  try {
    iter = recur.iterator(jsToIcalTime(from, hasTime))
  } catch {
    return null
  }
  let next: ICAL.Time | null
  let steps = 0
  while ((next = iter.next()) && steps++ < 4000) {
    const d = next.toJSDate()
    if (d.getTime() > from.getTime()) return d
  }
  return null
}

// Given a recurring task being completed, produce the patch that rolls it
// forward to its next occurrence (advancing due, shifting dtstart by the
// same lead-time, reopening it). Returns null when the task should instead
// just complete normally: not recurring, no date anchor, the series is
// exhausted (COUNT down to its last, or UNTIL passed).
export function rollForwardOnComplete(todo: VTodo): VTodoPatch | null {
  if (!todo.recurring || !todo.rrule) return null
  const anchorRaw = todo.due ?? todo.dtStart
  if (!anchorRaw) return null
  const anchor = parseICalDate(anchorRaw)
  if (!anchor) return null

  let recur: ICAL.Recur
  try {
    recur = ICAL.Recur.fromString(todo.rrule)
  } catch {
    return null
  }
  // This completion consumes one occurrence. When only the last remains,
  // let it complete for real instead of regenerating.
  const count = typeof recur.count === 'number' ? recur.count : null
  if (count != null && count <= 1) return null

  const hasTime = anchorRaw.includes('T')
  const next = nextOccurrence(todo.rrule, anchor, hasTime)
  if (!next) return null

  const patch: VTodoPatch = { status: 'NEEDS-ACTION', percentComplete: null }
  if (todo.due) {
    patch.due = { date: next, hasTime }
    // Preserve the gap between start and due, if any.
    if (todo.dtStart) {
      const ds = parseICalDate(todo.dtStart)
      if (ds) {
        const offset = anchor.getTime() - ds.getTime()
        patch.dtStart = {
          date: new Date(next.getTime() - offset),
          hasTime: todo.dtStart.includes('T'),
        }
      }
    }
  } else {
    // Anchored on DTSTART (no due).
    patch.dtStart = { date: next, hasTime }
  }
  if (count != null) {
    recur.count = count - 1
    patch.rrule = recur.toString()
  }
  return patch
}

// Re-exported for callers that want to round-trip a DateValue.
export type { DateValue }
