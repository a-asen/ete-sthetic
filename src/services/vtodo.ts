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
