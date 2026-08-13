import type { CollectionInfo, ContactItem } from '../types'
import { parseVCard } from './vcard'
import { store } from './store'

// Per-address-book contact cache on disk (same LazyStore as task/calendar
// snapshots, a distinct key prefix). We persist the raw vCard strings, not
// the parsed model — the vCard text is the single source of truth, so we
// re-parse on load (cheap). Mirrors calsnapshot.ts.

const KEY_PREFIX = 'contacts.'
const SNAPSHOT_VERSION = 1
const ADDRESS_BOOKS_LIST_KEY = 'addressBooksList.v1'

// The list of address books itself isn't covered by per-book snapshots;
// cache it so a cold start can render the books column from the last
// known list before the network listAddressBooks resolves. Same pattern
// as the tasks module's loadCollectionsList / saveCollectionsList and
// the calendar module's loadCalendarsList / saveCalendarsList.
interface AddressBooksListCache {
  list: CollectionInfo[]
  savedAt: number
}

export async function saveAddressBooksList(
  list: CollectionInfo[],
): Promise<void> {
  await store.set(ADDRESS_BOOKS_LIST_KEY, {
    list,
    savedAt: Date.now(),
  } satisfies AddressBooksListCache)
  await store.save()
}

export async function loadAddressBooksList(): Promise<CollectionInfo[] | null> {
  const data = await store.get<AddressBooksListCache>(ADDRESS_BOOKS_LIST_KEY)
  return data?.list ?? null
}

interface RawContact {
  itemUid: string
  raw: string
  // Last-modified epoch ms (from etebase item meta). Optional for
  // back-compat — snapshots written before the "Recently modified"
  // sort axis landed won't have it; rows with a missing mtime sort
  // to the end of the list under that axis.
  mtime?: number | null
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
  for (const { itemUid, raw, mtime } of data.contacts) {
    const card = parseVCard(raw)
    if (card) contacts.push({ itemUid, card, mtime: mtime ?? null })
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
      mtime: c.mtime,
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
