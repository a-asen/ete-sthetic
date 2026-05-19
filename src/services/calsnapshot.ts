import type { EventItem } from '../types'
import { parseVEvent } from './vevent'
import { store } from './store'

// Per-calendar event cache on disk (same LazyStore as task snapshots, a
// distinct key prefix). We persist the raw VEVENT strings rather than the
// parsed VEvent — Dates don't survive JSON, and the ICS text is the single
// source of truth, so we re-parse on load (cheap).

const KEY_PREFIX = 'calevents.'
const SNAPSHOT_VERSION = 1

interface RawEvent {
  itemUid: string
  raw: string
}

export interface CalendarSnapshot {
  version: number
  uid: string
  events: EventItem[]
  stoken?: string
  lastSyncedAt: number
}

interface StoredSnapshot {
  version: number
  uid: string
  events: RawEvent[]
  stoken?: string
  lastSyncedAt: number
}

function keyOf(uid: string): string {
  return `${KEY_PREFIX}${uid}`
}

export async function loadCalSnapshot(
  uid: string,
): Promise<CalendarSnapshot | null> {
  const data = await store.get<StoredSnapshot>(keyOf(uid))
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  const events: EventItem[] = []
  for (const { itemUid, raw } of data.events) {
    const event = parseVEvent(raw)
    if (event) events.push({ itemUid, event })
  }
  return {
    version: data.version,
    uid: data.uid,
    events,
    stoken: data.stoken,
    lastSyncedAt: data.lastSyncedAt,
  }
}

export async function saveCalSnapshot(
  snapshot: CalendarSnapshot,
): Promise<void> {
  const stored: StoredSnapshot = {
    version: SNAPSHOT_VERSION,
    uid: snapshot.uid,
    events: snapshot.events.map((e) => ({
      itemUid: e.itemUid,
      raw: e.event.raw,
    })),
    stoken: snapshot.stoken,
    lastSyncedAt: snapshot.lastSyncedAt,
  }
  await store.set(keyOf(snapshot.uid), stored)
}

export async function clearAllCalSnapshots(): Promise<void> {
  const keys = (await store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  for (const k of keys) await store.delete(k)
  await store.save()
}
