import ICAL from 'ical.js'
import type { Priority, TaskStatus, VTodo } from '../types'

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

  return {
    uid: String(uid),
    summary,
    description,
    status,
    priority,
    due,
    created,
    lastModified,
    parentUid,
    raw,
  }
}

const PRODID = '-//ete-stethic//EN'

// iCalendar UTC stamp: 20260509T143000Z
function icalUtcNow(): string {
  const iso = new Date().toISOString()
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
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

export interface VTodoPatch {
  summary?: string
  status?: TaskStatus
  priority?: Priority
  description?: string
  due?: string
  // null clears the parent (root). undefined leaves it untouched.
  parentUid?: string | null
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
    if (patch.description === '') {
      vtodo.removeAllProperties('description')
    } else {
      vtodo.updatePropertyWithValue('description', patch.description)
    }
  }
  if (patch.due !== undefined) {
    if (patch.due === '') {
      vtodo.removeAllProperties('due')
    } else {
      vtodo.updatePropertyWithValue('due', patch.due)
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
