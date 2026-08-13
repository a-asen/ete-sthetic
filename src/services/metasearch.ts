import type {
  CollectionInfo,
  ContactItem,
  EventItem,
  TaskItem,
} from '../types'
import { getTaskMemory } from './taskstore'
import { getCalMemory } from './calstore'
import { getContactMemory } from './contactstore'

// A cross-module search over the process-lifetime caches (taskstore /
// calstore / contactstore). Only modules that have been opened this session
// have data in their store — the caller surfaces that so unopened modules
// read as "open it to include here" rather than silently missing.

export interface TaskHit {
  kind: 'task'
  collectionUid: string
  sourceName: string
  item: TaskItem
  score: number
}
export interface EventHit {
  kind: 'event'
  calUid: string
  sourceName: string
  item: EventItem
  score: number
}
export interface ContactHit {
  kind: 'contact'
  bookUid: string
  sourceName: string
  item: ContactItem
  score: number
}
export type MetaHit = TaskHit | EventHit | ContactHit

export interface MetaResults {
  tasks: TaskHit[]
  events: EventHit[]
  contacts: ContactHit[]
  // Whether each module's store has any data at all (i.e. was opened this
  // session). Lets the UI hint "open X to search it" when empty.
  warmed: { tasks: boolean; events: boolean; contacts: boolean }
}

const PER_GROUP = 50

function nameMap(cols: CollectionInfo[] | null): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of cols ?? []) m.set(c.uid, c.name)
  return m
}

// Prefix match ranks above a mid-string match; 0 = no match.
function scoreText(text: string, q: string): number {
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  return 0
}

export function searchMeta(query: string): MetaResults {
  const q = query.trim().toLowerCase()
  const tm = getTaskMemory()
  const cm = getCalMemory()
  const ct = getContactMemory()
  const warmed = {
    tasks: tm.itemsByUid.size > 0,
    events: cm.eventsByCal.size > 0,
    contacts: ct.contactsByBook.size > 0,
  }
  if (!q) return { tasks: [], events: [], contacts: [], warmed }

  // --- Tasks ---
  const taskNames = nameMap(tm.collections)
  const tasks: TaskHit[] = []
  for (const [collectionUid, items] of tm.itemsByUid) {
    for (const item of items) {
      const t = item.todo
      let score = scoreText(t.summary, q)
      if (!score && t.description && t.description.toLowerCase().includes(q)) {
        score = 1
      }
      if (score > 0) {
        tasks.push({
          kind: 'task',
          collectionUid,
          sourceName: taskNames.get(collectionUid) ?? '',
          item,
          score,
        })
      }
    }
  }

  // --- Events --- (dedupe recurrence occurrences by itemUid; keep the
  // earliest-seen so navigation lands on a concrete date.)
  const calNames = nameMap(cm.calendars)
  const events: EventHit[] = []
  const seenEvents = new Set<string>()
  for (const [calUid, items] of cm.eventsByCal) {
    for (const item of items) {
      if (seenEvents.has(item.itemUid)) continue
      const ev = item.event
      let score = scoreText(ev.summary, q)
      if (!score && ev.location && ev.location.toLowerCase().includes(q)) {
        score = 1
      }
      if (score > 0) {
        seenEvents.add(item.itemUid)
        events.push({
          kind: 'event',
          calUid,
          sourceName: calNames.get(calUid) ?? '',
          item,
          score,
        })
      }
    }
  }

  // --- Contacts ---
  const bookNames = nameMap(ct.addressBooks)
  const contacts: ContactHit[] = []
  for (const [bookUid, items] of ct.contactsByBook) {
    for (const item of items) {
      const c = item.card
      let score = scoreText(c.fn, q)
      if (
        !score &&
        (c.nickname.toLowerCase().includes(q) ||
          c.org.toLowerCase().includes(q) ||
          c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
          c.phones.some((p) => p.value.toLowerCase().includes(q)))
      ) {
        score = 1
      }
      if (score > 0) {
        contacts.push({
          kind: 'contact',
          bookUid,
          sourceName: bookNames.get(bookUid) ?? '',
          item,
          score,
        })
      }
    }
  }

  const byScoreThen = (label: (h: MetaHit) => string) => (a: MetaHit, b: MetaHit) =>
    b.score - a.score ||
    label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })

  tasks.sort(byScoreThen((h) => (h as TaskHit).item.todo.summary))
  events.sort(byScoreThen((h) => (h as EventHit).item.event.summary))
  contacts.sort(byScoreThen((h) => (h as ContactHit).item.card.fn))

  return {
    tasks: tasks.slice(0, PER_GROUP),
    events: events.slice(0, PER_GROUP),
    contacts: contacts.slice(0, PER_GROUP),
    warmed,
  }
}
