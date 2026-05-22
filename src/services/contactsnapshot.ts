import type { ContactItem } from '../types'
import { parseVCard } from './vcard'
import { store } from './store'

// Per-address-book contact cache on disk (same LazyStore as task/calendar
// snapshots, a distinct key prefix). We persist the raw vCard strings, not
// the parsed model — the vCard text is the single source of truth, so we
// re-parse on load (cheap). Mirrors calsnapshot.ts.

const KEY_PREFIX = 'contacts.'
const SNAPSHOT_VERSION = 1

interface RawContact {
  itemUid: string
  raw: string
}

export interface ContactSnapshot {
  version: number
  uid: string
  contacts: ContactItem[]
  stoken?: string
  lastSyncedAt: number
}

interface StoredSnapshot {
  version: number
  uid: string
  contacts: RawContact[]
  stoken?: string
  lastSyncedAt: number
}

function keyOf(uid: string): string {
  return `${KEY_PREFIX}${uid}`
}

export async function loadContactSnapshot(
  uid: string,
): Promise<ContactSnapshot | null> {
  const data = await store.get<StoredSnapshot>(keyOf(uid))
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  const contacts: ContactItem[] = []
  for (const { itemUid, raw } of data.contacts) {
    const card = parseVCard(raw)
    if (card) contacts.push({ itemUid, card })
  }
  return {
    version: data.version,
    uid: data.uid,
    contacts,
    stoken: data.stoken,
    lastSyncedAt: data.lastSyncedAt,
  }
}

export async function saveContactSnapshot(
  snapshot: ContactSnapshot,
): Promise<void> {
  const stored: StoredSnapshot = {
    version: SNAPSHOT_VERSION,
    uid: snapshot.uid,
    contacts: snapshot.contacts.map((c) => ({
      itemUid: c.itemUid,
      raw: c.card.raw,
    })),
    stoken: snapshot.stoken,
    lastSyncedAt: snapshot.lastSyncedAt,
  }
  await store.set(keyOf(snapshot.uid), stored)
}

export async function clearAllContactSnapshots(): Promise<void> {
  const keys = (await store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  for (const k of keys) await store.delete(k)
  await store.save()
}
