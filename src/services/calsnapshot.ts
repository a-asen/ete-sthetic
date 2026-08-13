import type { CollectionInfo, EventItem } from '../types'
import { parseVEvent } from './vevent'
import { store } from './store'

// Per-calendar event cache on disk (same LazyStore as task snapshots, a
// distinct key prefix). We persist the raw VEVENT strings rather than the
// parsed VEvent — Dates don't survive JSON, and the ICS text is the single
// source of truth, so we re-parse on load (cheap).

const KEY_PREFIX = 'calevents.'
const SNAPSHOT_VERSION = 1
const CALENDARS_LIST_KEY = 'calendarsList.v1'

// The list of calendars itself isn't covered by per-calendar snapshots;
// cache it so a cold start can render the sidebar / grid from the last
// known list before the network listCalendars resolves. Same pattern as
// the tasks module's loadCollectionsList / saveCollectionsList.
interface CalendarsListCache {
  list: CollectionInfo[]
  savedAt: number
}

export async function saveCalendarsList(
  list: CollectionInfo[],
): Promise<void> {
  await store.set(CALENDARS_LIST_KEY, {
    list,
    savedAt: Date.now(),
  } satisfies CalendarsListCache)
  await store.save()
}

export async function loadCalendarsList(): Promise<CollectionInfo[] | null> {
  const data = await store.get<CalendarsListCache>(CALENDARS_LIST_KEY)
  return data?.list ?? null
}

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
