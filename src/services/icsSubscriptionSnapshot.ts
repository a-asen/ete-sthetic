import type { EventItem } from '../types'
import { parseVEvent } from './vevent'
import { store } from './store'

// Per-subscription event cache on disk. Mirrors `calsnapshot.ts`'s
// pattern: persist raw VEVENT strings (Dates don't survive JSON, the
// source URL is the truth, re-parse on load is cheap). The snapshot
// makes a cold app start with no network paint subscription events
// immediately instead of waiting for the first HTTP fetch to land.
//
// Keyed by the subscription's stable id (UUID generated at add time)
// so the file survives URL edits and so a remove can wipe just that
// one entry.

const KEY_PREFIX = 'subevents.'
const SNAPSHOT_VERSION = 1

interface RawEvent {
  itemUid: string
  raw: string
}

export interface SubSnapshot {
  version: number
  id: string
  events: EventItem[]
  lastSyncedAt: number
}

interface StoredSnapshot {
  version: number
  id: string
  events: RawEvent[]
  lastSyncedAt: number
}

function keyOf(id: string): string {
  return `${KEY_PREFIX}${id}`
}

export async function loadSubSnapshot(
  id: string,
): Promise<SubSnapshot | null> {
  const data = await store.get<StoredSnapshot>(keyOf(id))
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  const events: EventItem[] = []
  for (const { itemUid, raw } of data.events) {
    const event = parseVEvent(raw)
    if (event) events.push({ itemUid, event })
  }
  return {
    version: data.version,
    id: data.id,
    events,
    lastSyncedAt: data.lastSyncedAt,
  }
}

export async function saveSubSnapshot(
  snapshot: SubSnapshot,
): Promise<void> {
  const stored: StoredSnapshot = {
    version: SNAPSHOT_VERSION,
    id: snapshot.id,
    events: snapshot.events.map((e) => ({
      itemUid: e.itemUid,
      raw: e.event.raw,
    })),
    lastSyncedAt: snapshot.lastSyncedAt,
  }
  await store.set(keyOf(snapshot.id), stored)
}

// Drop a single subscription's cached events. Called when the user
// removes the subscription from the sidebar.
export async function clearSubSnapshot(id: string): Promise<void> {
  await store.delete(keyOf(id))
  await store.save()
}

// Bulk wipe — called from logout alongside the other snapshot clears.
export async function clearAllSubSnapshots(): Promise<void> {
  const keys = (await store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  for (const k of keys) await store.delete(k)
  await store.save()
}
