import ICAL from 'ical.js'
import type {
  Classification,
  Priority,
  RelatedLink,
  TaskStatus,
  VTodo,
} from '../types'

const VALID_CLASSES: ReadonlySet<Classification> = new Set([
  'PUBLIC',
  'PRIVATE',
  'CONFIDENTIAL',
])

// GEO is "lat;lon" (RFC 5545). ical.js may hand it back as a [lat, lon]
// array (structured value) or as the raw string — handle both.
function parseGeo(value: unknown): { lat: number; lon: number } | undefined {
  let lat: number
  let lon: number
  if (Array.isArray(value)) {
    lat = Number(value[0])
    lon = Number(value[1])
  } else {
    const s = asString(value)
    if (!s) return undefined
    const parts = s.split(';')
    if (parts.length !== 2) return undefined
    lat = Number(parts[0])
    lon = Number(parts[1])
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  return { lat, lon }
}

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'NEEDS-ACTION',
  'COMPLETED',
  'IN-PROCESS',
  'CANCELLED',
])

function clampPriority(value: unknown): Priority {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const clamped = Math.max(0, Math.min(9, Math.round(n)))
  return clamped as Priority
}

function asString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value)
  }
  return undefined
}

export function parseVTodo(raw: string): VTodo | null {
  let comp: ICAL.Component
  try {
    const jcal = ICAL.parse(raw)
    comp = new ICAL.Component(jcal)
  } catch {
    return null
  }

  const vtodo =
    comp.name === 'vtodo' ? comp : comp.getFirstSubcomponent('vtodo')
  if (!vtodo) return null

  const uid = vtodo.getFirstPropertyValue('uid')
  if (!uid) return null

  const summary = asString(vtodo.getFirstPropertyValue('summary')) ?? ''
  const description = asString(vtodo.getFirstPropertyValue('description'))

  const rawStatus = asString(vtodo.getFirstPropertyValue('status'))?.toUpperCase()
  const status: TaskStatus =
    rawStatus && VALID_STATUSES.has(rawStatus as TaskStatus)
      ? (rawStatus as TaskStatus)
      : 'NEEDS-ACTION'

  const priority = clampPriority(vtodo.getFirstPropertyValue('priority'))
  const due = asString(vtodo.getFirstPropertyValue('due'))
  const created = asString(vtodo.getFirstPropertyValue('created'))
  const completed = asString(vtodo.getFirstPropertyValue('completed'))
  const lastModified = asString(vtodo.getFirstPropertyValue('last-modified'))

  let parentUid: string | undefined
  for (const prop of vtodo.getAllProperties('related-to')) {
    const reltype = prop.getParameter('reltype')?.toString().toUpperCase()
    // RFC 5545: default RELTYPE for RELATED-TO is PARENT
    if (!reltype || reltype === 'PARENT') {
      const value = asString(prop.getFirstValue())
      if (value) {
        parentUid = value
        break
      }
    }
  }

  const categories: string[] = []
  for (const prop of vtodo.getAllProperties('categories')) {
    for (const value of prop.getValues()) {
      const s = asString(value)?.trim()
      if (s) categories.push(s)
    }
  }

  const resources: string[] = []
  for (const prop of vtodo.getAllProperties('resources')) {
    for (const value of prop.getValues()) {
      const s = asString(value)?.trim()
      if (s) resources.push(s)
    }
  }

  // Non-PARENT RELATED-TO links (dependencies / siblings / children).
  // The PARENT link is consumed above into `parentUid`.
  const relatedTo: RelatedLink[] = []
  for (const prop of vtodo.getAllProperties('related-to')) {
    const reltype = prop.getParameter('reltype')?.toString().toUpperCase()
    if (!reltype || reltype === 'PARENT') continue
    const value = asString(prop.getFirstValue())
    if (value) relatedTo.push({ uid: value, reltype })
  }

  const dtStart = asString(vtodo.getFirstPropertyValue('dtstart'))
  const url = asString(vtodo.getFirstPropertyValue('url'))
  const location = asString(vtodo.getFirstPropertyValue('location'))
  const comment = asString(vtodo.getFirstPropertyValue('comment'))
  const geo = parseGeo(vtodo.getFirstPropertyValue('geo'))

  const rawClass = asString(vtodo.getFirstPropertyValue('class'))?.toUpperCase()
  const classification =
    rawClass && VALID_CLASSES.has(rawClass as Classification)
      ? (rawClass as Classification)
      : undefined

  let percentComplete: number | undefined
  const rawPct = vtodo.getFirstPropertyValue('percent-complete')
  if (rawPct != null) {
    const n = Number(rawPct)
    if (Number.isFinite(n)) {
      percentComplete = Math.max(0, Math.min(100, Math.round(n)))
    }
  }

  return {
    uid: String(uid),
    summary,
    description,
    status,
    priority,
    due,
    dtStart,
    created,
    completed,
    lastModified,
    parentUid,
    categories,
    percentComplete,
    url,
    location,
    geo,
    classification,
    comment,
    resources: resources.length > 0 ? resources : undefined,
    relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
    raw,
  }
}

const PRODID = '-//ete-stethic//EN'

// Build an ICAL.Time for "now" in UTC. Passing strings to
// updatePropertyWithValue triggers ical.js's strict date-time parser; using
// ICAL.Time objects bypasses that and serializes back via toICALString().
function icalUtcNow(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

function newUid(): string {
  return crypto.randomUUID()
}

export interface NewVTodoArgs {
  summary: string
  parentUid?: string
  description?: string
  due?: string
  priority?: Priority
}

// Build a fresh VCALENDAR + VTODO string for a new task.
export function buildVTodo(args: NewVTodoArgs): { uid: string; raw: string } {
  const uid = newUid()
  const stamp = icalUtcNow()

  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('version', '2.0')
  cal.updatePropertyWithValue('prodid', PRODID)

  const vtodo = new ICAL.Component('vtodo')
  vtodo.updatePropertyWithValue('uid', uid)
  vtodo.updatePropertyWithValue('dtstamp', stamp)
  vtodo.updatePropertyWithValue('created', stamp)
  vtodo.updatePropertyWithValue('last-modified', stamp)
  vtodo.updatePropertyWithValue('summary', args.summary)
  vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION')
  if (args.priority != null && args.priority !== 0) {
    vtodo.updatePropertyWithValue('priority', args.priority)
  }
  if (args.description) {
    vtodo.updatePropertyWithValue('description', args.description)
  }
  if (args.due) {
    vtodo.updatePropertyWithValue('due', args.due)
  }
  if (args.parentUid) {
    const prop = vtodo.addPropertyWithValue('related-to', args.parentUid)
    prop.setParameter('reltype', 'PARENT')
  }

  cal.addSubcomponent(vtodo)
  return { uid, raw: cal.toString() }
}

// A date the user picked, with whether they also picked a time. hasTime
// false → serialized as a date-only value (YYYYMMDD); true → as a UTC
// date-time (YYYYMMDDTHHMMSSZ).
export interface DateValue {
  date: Date
  hasTime: boolean
}

export interface VTodoPatch {
  summary?: string
  status?: TaskStatus
  priority?: Priority
  // '' or null clears; undefined leaves untouched. (Applies to all the
  // string fields below.)
  description?: string | null
  // null clears; undefined leaves untouched. (Applies to due/dtStart.)
  due?: DateValue | null
  dtStart?: DateValue | null
  // Full replacement. [] clears. (Applies to categories/resources.)
  categories?: string[]
  resources?: string[]
  // 0–100; null clears; undefined leaves untouched.
  percentComplete?: number | null
  url?: string | null
  location?: string | null
  comment?: string | null
  classification?: Classification | null
  geo?: { lat: number; lon: number } | null
  // Full replacement of the non-PARENT RELATED-TO links. [] clears them
  // all; the PARENT link is untouched (use parentUid for that).
  relatedTo?: RelatedLink[]
  // null clears the parent (root). undefined leaves it untouched.
  parentUid?: string | null
}

function toIcalTime(v: DateValue): ICAL.Time {
  if (!v.hasTime) {
    // Date-only: isDate=true makes ical.js serialize as YYYYMMDD per
    // RFC 5545; zone is irrelevant for date-only values.
    return ICAL.Time.fromData({
      year: v.date.getFullYear(),
      month: v.date.getMonth() + 1,
      day: v.date.getDate(),
      isDate: true,
    })
  }
  // Date-time stored as a floating (local, no TZID/Z) value: "YYYYMMDDThhmmss".
  // For a single-user task client this preserves the wall-clock time the
  // user typed without any timezone round-trip drift.
  return ICAL.Time.fromData({
    year: v.date.getFullYear(),
    month: v.date.getMonth() + 1,
    day: v.date.getDate(),
    hour: v.date.getHours(),
    minute: v.date.getMinutes(),
    second: 0,
    isDate: false,
  })
}

// Set or clear a single-value string property (treats '' / null / nullish
// as "clear").
function setOrClear(
  vtodo: ICAL.Component,
  name: string,
  value: string | null | undefined,
) {
  if (!value) vtodo.removeAllProperties(name)
  else vtodo.updatePropertyWithValue(name, value)
}

// Update an existing raw VTODO with patch fields. Preserves all unknown
// properties (X-* extensions, attachments, etc.) and bumps LAST-MODIFIED.
export function updateVTodo(raw: string, patch: VTodoPatch): string {
  const jcal = ICAL.parse(raw)
  const cal = new ICAL.Component(jcal)
  const vtodo =
    cal.name === 'vtodo' ? cal : cal.getFirstSubcomponent('vtodo')
  if (!vtodo) throw new Error('VTODO component missing')

  if (patch.summary !== undefined) {
    vtodo.updatePropertyWithValue('summary', patch.summary)
  }
  if (patch.status !== undefined) {
    vtodo.updatePropertyWithValue('status', patch.status)
    if (patch.status === 'COMPLETED') {
      vtodo.updatePropertyWithValue('completed', icalUtcNow())
      vtodo.updatePropertyWithValue('percent-complete', 100)
    } else {
      vtodo.removeAllProperties('completed')
      if (patch.status === 'NEEDS-ACTION') {
        vtodo.removeAllProperties('percent-complete')
      }
    }
  }
  if (patch.priority !== undefined) {
    if (patch.priority === 0) {
      vtodo.removeAllProperties('priority')
    } else {
      vtodo.updatePropertyWithValue('priority', patch.priority)
    }
  }
  if (patch.description !== undefined) {
    setOrClear(vtodo, 'description', patch.description)
  }
  if (patch.url !== undefined) setOrClear(vtodo, 'url', patch.url)
  if (patch.location !== undefined) {
    setOrClear(vtodo, 'location', patch.location)
  }
  if (patch.comment !== undefined) {
    setOrClear(vtodo, 'comment', patch.comment)
  }
  if (patch.classification !== undefined) {
    setOrClear(vtodo, 'class', patch.classification)
  }
  if (patch.due !== undefined) {
    if (patch.due === null) vtodo.removeAllProperties('due')
    else vtodo.updatePropertyWithValue('due', toIcalTime(patch.due))
  }
  if (patch.dtStart !== undefined) {
    if (patch.dtStart === null) vtodo.removeAllProperties('dtstart')
    else vtodo.updatePropertyWithValue('dtstart', toIcalTime(patch.dtStart))
  }
  if (patch.percentComplete !== undefined) {
    if (patch.percentComplete === null) {
      vtodo.removeAllProperties('percent-complete')
    } else {
      const n = Math.max(0, Math.min(100, Math.round(patch.percentComplete)))
      vtodo.updatePropertyWithValue('percent-complete', n)
    }
  }
  if (patch.geo !== undefined) {
    vtodo.removeAllProperties('geo')
    if (patch.geo !== null) {
      // jCal representation of a structured float pair: GEO:lat;lon.
      vtodo.addProperty(
        new ICAL.Property(
          ['geo', {}, 'float', patch.geo.lat, patch.geo.lon],
          vtodo,
        ),
      )
    }
  }
  if (patch.categories !== undefined) {
    vtodo.removeAllProperties('categories')
    if (patch.categories.length > 0) {
      const prop = new ICAL.Property('categories', vtodo)
      prop.setValues(patch.categories)
      vtodo.addProperty(prop)
    }
  }
  if (patch.resources !== undefined) {
    vtodo.removeAllProperties('resources')
    if (patch.resources.length > 0) {
      const prop = new ICAL.Property('resources', vtodo)
      prop.setValues(patch.resources)
      vtodo.addProperty(prop)
    }
  }
  if (patch.relatedTo !== undefined) {
    // Replace only the non-PARENT links; keep the PARENT link intact.
    for (const prop of vtodo.getAllProperties('related-to')) {
      const reltype = prop.getParameter('reltype')?.toString().toUpperCase()
      if (reltype && reltype !== 'PARENT') vtodo.removeProperty(prop)
    }
    for (const link of patch.relatedTo) {
      const prop = vtodo.addPropertyWithValue('related-to', link.uid)
      prop.setParameter('reltype', link.reltype)
    }
  }
  if (patch.parentUid !== undefined) {
    // Remove any existing PARENT-typed RELATED-TO; preserve sibling/child types.
    for (const prop of vtodo.getAllProperties('related-to')) {
      const reltype = prop.getParameter('reltype')?.toString().toUpperCase()
      if (!reltype || reltype === 'PARENT') {
        vtodo.removeProperty(prop)
      }
    }
    if (patch.parentUid !== null) {
      const prop = vtodo.addPropertyWithValue('related-to', patch.parentUid)
      prop.setParameter('reltype', 'PARENT')
    }
  }

  vtodo.updatePropertyWithValue('last-modified', icalUtcNow())
  vtodo.updatePropertyWithValue('dtstamp', icalUtcNow())
  return cal.toString()
}
