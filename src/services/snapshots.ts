import type { TaskItem } from '../types'
import { store } from './store'

const KEY_PREFIX = 'collection.'
const SNAPSHOT_VERSION = 1

export interface CollectionSnapshot {
  version: number
  uid: string
  items: TaskItem[]
  stoken?: string
  lastSyncedAt: number
}

function keyOf(uid: string): string {
  return `${KEY_PREFIX}${uid}`
}

export async function loadSnapshot(
  uid: string,
): Promise<CollectionSnapshot | null> {
  const data = await store.get<CollectionSnapshot>(keyOf(uid))
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  return data
}

export async function saveSnapshot(snapshot: CollectionSnapshot): Promise<void> {
  await store.set(keyOf(snapshot.uid), {
    ...snapshot,
    version: SNAPSHOT_VERSION,
  })
}

export async function deleteSnapshot(uid: string): Promise<void> {
  await store.delete(keyOf(uid))
}

export async function clearAllSnapshots(): Promise<void> {
  const keys = (await store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  for (const k of keys) await store.delete(k)
  await store.save()
}

// Lightweight enumeration of cached collection uids (without loading items).
// Cheap because LazyStore keeps everything in memory once warmed up.
export async function listSnapshotUids(): Promise<string[]> {
  const keys = await store.keys()
  return keys
    .filter((k) => k.startsWith(KEY_PREFIX))
    .map((k) => k.slice(KEY_PREFIX.length))
}
