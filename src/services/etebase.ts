import * as Etebase from 'etebase'
import type { ColType, CollectionInfo, EventItem, TaskItem } from '../types'
import { buildVTodo, parseVTodo, updateVTodo, type VTodoPatch } from './vtodo'
import {
  buildVEvent,
  parseVEvent,
  updateVEvent,
  type NewVEventArgs,
  type VEventPatch,
} from './vevent'
import { clearSession, loadSession, saveSession } from './store'
import { clearAllSnapshots } from './snapshots'
import { clearAllCalSnapshots } from './calsnapshot'
import { resetCalMemory } from './calstore'
import { resetTaskMemory } from './taskstore'
import { stopAlarmScheduler } from './alarms'

export const DEFAULT_SERVER = 'https://api.etebase.com'
const TASK_COLLECTION_TYPE: ColType = 'etebase.vtodo'
const CALENDAR_COLLECTION_TYPE: ColType = 'etebase.vevent'

let account: Etebase.Account | null = null

const collectionHandles = new Map<string, Etebase.Collection>()
const itemHandles = new Map<string, Etebase.Item>()
// Pending mutation chain per item. Mutations on the same uid must serialize:
// Etebase reuses one Item handle and shares its etag; two interleaving
// setContent → transaction calls will clobber each other and the second one
// gets rejected by the server with "Items failed to validate".
const itemMutationChains = new Map<string, Promise<unknown>>()

function itemKey(colUid: string, itemUid: string): string {
  return `${colUid}|${itemUid}`
}

function chainItemMutation<T>(
  collectionUid: string,
  itemUid: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = itemKey(collectionUid, itemUid)
  const prev = itemMutationChains.get(key) ?? Promise.resolve()
  // Run fn whether the previous link succeeded or failed; we want to keep
  // the queue moving even if one mutation errored.
  const next = prev.then(fn, fn)
  // Store a never-rejecting tail so subsequent chain calls don't see an
  // unhandled rejection from a failed mutation.
  itemMutationChains.set(
    key,
    next.catch(() => {}),
  )
  return next
}

function clearHandles() {
  collectionHandles.clear()
  itemHandles.clear()
  itemMutationChains.clear()
}

export class AuthError extends Error {}

export async function login(
  username: string,
  password: string,
  server: string = DEFAULT_SERVER,
): Promise<void> {
  try {
    account = await Etebase.Account.login(username, password, server)
  } catch (err) {
    throw new AuthError(
      err instanceof Error ? err.message : 'Login failed',
    )
  }
  const session = await account.save()
  await saveSession(session, server)
}

export async function restoreSession(): Promise<boolean> {
  const stored = await loadSession()
  if (!stored) return false
  try {
    account = await Etebase.Account.restore(stored.session)
    return true
  } catch {
    await clearSession()
    return false
  }
}

export async function logout(): Promise<void> {
  if (account) {
    try {
      await account.logout()
    } catch {
      // Network errors during logout are non-fatal; we still clear local state.
    }
  }
  account = null
  clearHandles()
  stopAlarmScheduler()
  resetCalMemory()
  resetTaskMemory()
  await clearSession()
  await clearAllSnapshots()
  await clearAllCalSnapshots()
}

export function isAuthenticated(): boolean {
  return account !== null
}

async function ensureAccount(): Promise<Etebase.Account> {
  if (account) return account
  // The module-level account can be null after a Vite HMR reload (which
  // re-imports this module and resets the closure) or when the page first
  // mounts. Try a silent restore from the persisted session before giving
  // up — saves the user from being kicked back to the login screen.
  const stored = await loadSession()
  if (!stored) throw new Error('Not authenticated')
  try {
    account = await Etebase.Account.restore(stored.session)
    return account
  } catch {
    await clearSession()
    throw new Error('Not authenticated')
  }
}

async function getCollection(uid: string): Promise<Etebase.Collection> {
  const cached = collectionHandles.get(uid)
  if (cached) return cached
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const col = await cm.fetch(uid)
  collectionHandles.set(uid, col)
  return col
}

async function getItem(
  collectionUid: string,
  itemUid: string,
): Promise<Etebase.Item> {
  const cached = itemHandles.get(itemKey(collectionUid, itemUid))
  if (cached) return cached
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const collection = await getCollection(collectionUid)
  const im = cm.getItemManager(collection)
  const item = await im.fetch(itemUid)
  itemHandles.set(itemKey(collectionUid, itemUid), item)
  return item
}

async function getItemManager(
  collectionUid: string,
): Promise<Etebase.ItemManager> {
  const acc = await ensureAccount()
  const collection = await getCollection(collectionUid)
  return acc.getCollectionManager().getItemManager(collection)
}

export interface ListCollectionsOptions {
  // When true, include server tombstones (collections deleted in some
  // other client but not yet hard-purged) in the returned list. Each
  // returned entry has `isDeleted: true`. Defaults to false — pim.etesync
  // does the same client-side filter.
  includeDeleted?: boolean
}

export async function listCollections(
  options: ListCollectionsOptions = {},
  type: ColType = TASK_COLLECTION_TYPE,
): Promise<CollectionInfo[]> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const result = await cm.list(type)
  return result.data
    .filter((c) => options.includeDeleted || !c.isDeleted)
    .map((c) => {
      collectionHandles.set(c.uid, c)
      return collectionInfo(c)
    })
}

export interface ListTaskItemsOptions {
  signal?: AbortSignal
  // Called with each freshly-decrypted batch (defaults to BATCH_SIZE items
  // per call) so the caller can update UI progressively. The same items
  // are also accumulated into the resolved result.
  onBatch?: (batch: TaskItem[]) => void
  // Resume sync from this stoken; only items that changed since are
  // returned (including server-side deletions). Undefined for a full load.
  fromStoken?: string
}

export interface SyncResult {
  // Items present in this delta (upserts).
  items: TaskItem[]
  // Item uids that were deleted on the server since fromStoken.
  removed: string[]
  // The new stoken to persist; pass into the next call to resume.
  stoken: string
}

const BATCH_SIZE = 25

// Yield to the event loop. Decryption + parseVTodo can run synchronously
// when the encrypted blobs are already in memory, monopolising the main
// thread between batches. setTimeout(0) (clamped to ~4ms) lets the browser
// repaint and lets user input fire between batches.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

class AbortError extends Error {
  name = 'AbortError'
  constructor() {
    super('Aborted')
  }
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortError()
}

export async function listTaskItems(
  collectionUid: string,
  options: ListTaskItemsOptions = {},
): Promise<SyncResult> {
  const { signal, onBatch, fromStoken } = options
  checkAborted(signal)

  const im = await getItemManager(collectionUid)
  const accumulated: TaskItem[] = []
  const removed: string[] = []
  let pendingBatch: TaskItem[] = []

  const flush = () => {
    if (pendingBatch.length === 0) return
    const batch = pendingBatch
    pendingBatch = []
    accumulated.push(...batch)
    onBatch?.(batch)
  }

  let stoken: string | undefined = fromStoken
  while (true) {
    checkAborted(signal)
    const page = await im.list({ stoken })
    checkAborted(signal)

    for (const item of page.data) {
      checkAborted(signal)
      if (item.isDeleted) {
        removed.push(item.uid)
        itemHandles.delete(itemKey(collectionUid, item.uid))
        continue
      }
      const raw = await item.getContent(Etebase.OutputFormat.String)
      const todo = parseVTodo(raw)
      if (!todo) continue
      itemHandles.set(itemKey(collectionUid, item.uid), item)
      pendingBatch.push({ itemUid: item.uid, todo })
      if (pendingBatch.length >= BATCH_SIZE) {
        flush()
        await yieldToEventLoop()
        checkAborted(signal)
      }
    }
    stoken = page.stoken
    if (page.done) break
  }

  flush()
  return { items: accumulated, removed, stoken: stoken ?? '' }
}

function setItemMeta(item: Etebase.Item, summary: string) {
  const meta = item.getMeta<Record<string, unknown>>()
  item.setMeta({ ...meta, name: summary, mtime: Date.now() })
}

export async function createTask(
  collectionUid: string,
  summary: string,
  parentUid?: string,
): Promise<TaskItem> {
  const im = await getItemManager(collectionUid)
  const { raw } = buildVTodo({ summary, parentUid })

  const item = await im.create({ name: summary, mtime: Date.now() }, raw)
  await im.transaction([item])
  itemHandles.set(itemKey(collectionUid, item.uid), item)

  const todo = parseVTodo(raw)
  if (!todo) throw new Error('Built VTODO failed to parse')
  return { itemUid: item.uid, todo }
}

export function updateTask(
  collectionUid: string,
  itemUid: string,
  patch: VTodoPatch,
): Promise<TaskItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    const item = await getItem(collectionUid, itemUid)
    const oldRaw = await item.getContent(Etebase.OutputFormat.String)
    const newRaw = updateVTodo(oldRaw, patch)
    await item.setContent(newRaw)

    const newSummary =
      patch.summary !== undefined
        ? patch.summary
        : (item.getMeta<Record<string, unknown>>().name ?? '')
    setItemMeta(item, newSummary)

    const im = await getItemManager(collectionUid)
    await im.transaction([item])

    const todo = parseVTodo(newRaw)
    if (!todo) throw new Error('Updated VTODO failed to parse')
    return { itemUid: item.uid, todo }
  })
}

// Replace an item's content with a raw iCal string verbatim — no
// updateVTodo re-serialization. Used by the raw editor to hand-fix a
// `broken` item without the normal patch path (which would re-parse and
// reject / strip the very content we're trying to repair).
export function updateTaskRaw(
  collectionUid: string,
  itemUid: string,
  rawString: string,
): Promise<TaskItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    const item = await getItem(collectionUid, itemUid)
    await item.setContent(rawString)

    const todo = parseVTodo(rawString)
    // Keep the meta name roughly in sync when we can read a summary;
    // leave it untouched otherwise.
    if (todo && !todo.broken) setItemMeta(item, todo.summary)

    const im = await getItemManager(collectionUid)
    await im.transaction([item])

    if (!todo) throw new Error('Saved content still could not be parsed')
    return { itemUid: item.uid, todo }
  })
}

export async function toggleComplete(
  collectionUid: string,
  itemUid: string,
  currentStatus: 'COMPLETED' | 'NEEDS-ACTION' | 'IN-PROCESS' | 'CANCELLED',
): Promise<TaskItem> {
  const next =
    currentStatus === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED'
  return updateTask(collectionUid, itemUid, { status: next })
}

export async function deleteTasks(
  collectionUid: string,
  itemUids: string[],
): Promise<void> {
  if (itemUids.length === 0) return
  const items = await Promise.all(
    itemUids.map((uid) => getItem(collectionUid, uid)),
  )
  for (const item of items) item.delete()
  const im = await getItemManager(collectionUid)
  await im.transaction(items)
  for (const uid of itemUids) {
    itemHandles.delete(itemKey(collectionUid, uid))
  }
}

export async function deleteTask(
  collectionUid: string,
  itemUid: string,
): Promise<void> {
  return deleteTasks(collectionUid, [itemUid])
}

// Move a set of items from one collection to another. The Etebase API
// has no native "move" primitive, so we copy the encrypted blob + meta
// into the destination collection, then mark the originals deleted.
// The VTODO `uid` (distinct from the Etebase item uid) is preserved in
// the content, so RELATED-TO parent/child links inside the moved subtree
// stay intact.
//
// Ordering: destination create commits first. If it fails the originals
// are still on the server and the user keeps their data. If the source
// delete fails afterwards, there are duplicates but no data loss.
export async function moveTasksToCollection(
  sourceCollectionUid: string,
  destCollectionUid: string,
  itemUids: string[],
): Promise<TaskItem[]> {
  if (itemUids.length === 0) return []
  if (sourceCollectionUid === destCollectionUid) {
    throw new Error('Source and destination collections are the same')
  }

  const sourceItems = await Promise.all(
    itemUids.map((uid) => getItem(sourceCollectionUid, uid)),
  )

  // Snapshot content + meta from the source side before touching anything.
  const payloads = await Promise.all(
    sourceItems.map(async (item) => ({
      content: await item.getContent(Etebase.OutputFormat.String),
      meta: item.getMeta<Record<string, unknown>>(),
    })),
  )

  // Build new items in the destination collection.
  const acc = await ensureAccount()
  const destCollection = await getCollection(destCollectionUid)
  const destIm = acc.getCollectionManager().getItemManager(destCollection)
  const created: Etebase.Item[] = []
  for (const { content, meta } of payloads) {
    const newItem = await destIm.create(
      { ...meta, mtime: Date.now() },
      content,
    )
    created.push(newItem)
  }
  await destIm.transaction(created)
  for (const newItem of created) {
    itemHandles.set(itemKey(destCollectionUid, newItem.uid), newItem)
  }

  // Now delete the source items.
  for (const item of sourceItems) item.delete()
  const sourceIm = await getItemManager(sourceCollectionUid)
  await sourceIm.transaction(sourceItems)

  // VERIFY the server actually recorded the deletions. Copy-then-delete
  // must not silently leave the originals behind: the copies already
  // exist in the destination, so a missed delete = the same task visible
  // in two lists across every client. sourceIm.fetch() bypasses our
  // handle cache and returns the server truth (a deleted item comes back
  // with isDeleted = true).
  const stillPresent = async (): Promise<string[]> => {
    const remaining: string[] = []
    for (const uid of itemUids) {
      try {
        const fresh = await sourceIm.fetch(uid)
        if (!fresh.isDeleted) remaining.push(uid)
      } catch {
        // Unfetchable → treat as gone.
      }
    }
    return remaining
  }
  let stuck = await stillPresent()
  if (stuck.length > 0) {
    // One retry with fresh handles (handles a stale-etag race).
    const retry = await Promise.all(stuck.map((uid) => sourceIm.fetch(uid)))
    for (const it of retry) it.delete()
    await sourceIm.transaction(retry)
    stuck = await stillPresent()
  }
  if (stuck.length > 0) {
    // Surface loudly. The caller rolls the source list back (the items
    // ARE still on the server) and shows this message; the destination
    // copies remain, so the user can retry the stragglers.
    throw new Error(
      `Move incomplete: ${stuck.length} item(s) are still in the source ` +
        `list on the server (copies were created in the destination). ` +
        `Re-open the source list and move the remaining item(s) again.`,
    )
  }

  for (const uid of itemUids) {
    itemHandles.delete(itemKey(sourceCollectionUid, uid))
  }

  // Re-parse the moved VTODOs so the caller can splice them straight
  // into its in-memory itemsByUid for the destination collection.
  const out: TaskItem[] = []
  for (let i = 0; i < created.length; i++) {
    const todo = parseVTodo(payloads[i].content)
    if (!todo) continue
    out.push({ itemUid: created[i].uid, todo })
  }
  return out
}

function collectionInfo(c: Etebase.Collection): CollectionInfo {
  const meta = c.getMeta()
  const info: CollectionInfo = {
    uid: c.uid,
    name: meta.name ?? '(untitled)',
    description: meta.description,
    color: meta.color,
  }
  if (c.isDeleted) info.isDeleted = true
  return info
}

// Create a new task list (collection). Etebase requires a non-undefined
// content blob even for tasks collections, where the items live as
// separate encrypted items — an empty string is the convention.
export async function createCollection(
  name: string,
  opts: { description?: string; color?: string } = {},
): Promise<CollectionInfo> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const collection = await cm.create(
    TASK_COLLECTION_TYPE,
    {
      name,
      description: opts.description,
      color: opts.color,
      mtime: Date.now(),
    },
    '',
  )
  await cm.upload(collection)
  collectionHandles.set(collection.uid, collection)
  return collectionInfo(collection)
}

// Rename (and optionally recolor / re-describe) an existing list. Merges
// onto the existing meta so unknown keys survive the round-trip.
export async function updateCollectionMeta(
  uid: string,
  patch: { name?: string; description?: string; color?: string },
): Promise<CollectionInfo> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const collection = await getCollection(uid)
  const meta = collection.getMeta()
  collection.setMeta({ ...meta, ...patch, mtime: Date.now() })
  await cm.upload(collection)
  collectionHandles.set(uid, collection)
  return collectionInfo(collection)
}

// Delete a list. This is a soft delete on the server (it becomes a
// tombstone visible via listCollections({ includeDeleted: true })),
// matching how other EteSync clients behave.
export async function deleteCollection(uid: string): Promise<void> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const collection = await getCollection(uid)
  collection.delete()
  await cm.upload(collection)
  collectionHandles.delete(uid)
}

// ---- Calendar (VEVENT), read-only for v1 ----
// Appended as a separate block (not woven into the task functions) to keep
// the merge surface with concurrent task work minimal. Reuses the same
// type-agnostic collection/item plumbing above.

export interface EventSyncResult {
  items: EventItem[]
  removed: string[]
  stoken: string
}

export interface ListEventItemsOptions {
  signal?: AbortSignal
  onBatch?: (batch: EventItem[]) => void
  fromStoken?: string
}

// Calendars are just collections of a different type.
export function listCalendars(
  options: ListCollectionsOptions = {},
): Promise<CollectionInfo[]> {
  return listCollections(options, CALENDAR_COLLECTION_TYPE)
}

// Mirror of listTaskItems for VEVENT. Same incremental-sync / batching /
// abort shape; only the parser differs.
export async function listEventItems(
  collectionUid: string,
  options: ListEventItemsOptions = {},
): Promise<EventSyncResult> {
  const { signal, onBatch, fromStoken } = options
  checkAborted(signal)

  const im = await getItemManager(collectionUid)
  const accumulated: EventItem[] = []
  const removed: string[] = []
  let pendingBatch: EventItem[] = []

  const flush = () => {
    if (pendingBatch.length === 0) return
    const batch = pendingBatch
    pendingBatch = []
    accumulated.push(...batch)
    onBatch?.(batch)
  }

  let stoken: string | undefined = fromStoken
  while (true) {
    checkAborted(signal)
    const page = await im.list({ stoken })
    checkAborted(signal)

    for (const item of page.data) {
      checkAborted(signal)
      if (item.isDeleted) {
        removed.push(item.uid)
        itemHandles.delete(itemKey(collectionUid, item.uid))
        continue
      }
      const raw = await item.getContent(Etebase.OutputFormat.String)
      const event = parseVEvent(raw)
      if (!event) continue
      itemHandles.set(itemKey(collectionUid, item.uid), item)
      pendingBatch.push({ itemUid: item.uid, event })
      if (pendingBatch.length >= BATCH_SIZE) {
        flush()
        await yieldToEventLoop()
        checkAborted(signal)
      }
    }
    stoken = page.stoken
    if (page.done) break
  }

  flush()
  return { items: accumulated, removed, stoken: stoken ?? '' }
}

export async function createEvent(
  collectionUid: string,
  args: NewVEventArgs,
): Promise<EventItem> {
  const im = await getItemManager(collectionUid)
  const { raw } = buildVEvent(args)
  const item = await im.create({ name: args.summary, mtime: Date.now() }, raw)
  await im.transaction([item])
  itemHandles.set(itemKey(collectionUid, item.uid), item)
  const event = parseVEvent(raw)
  if (!event) throw new Error('Built VEVENT failed to parse')
  return { itemUid: item.uid, event }
}

// Raised when a transaction is rejected because the item changed on the
// server since we last fetched it. Carries both sides so the UI can ask
// the user how to resolve.
export class EventConflictError extends Error {
  readonly collectionUid: string
  readonly itemUid: string
  readonly localRaw: string
  readonly serverRaw: string
  constructor(
    collectionUid: string,
    itemUid: string,
    localRaw: string,
    serverRaw: string,
  ) {
    super('Event changed on the server')
    this.name = 'EventConflictError'
    this.collectionUid = collectionUid
    this.itemUid = itemUid
    this.localRaw = localRaw
    this.serverRaw = serverRaw
  }
}

export function updateEvent(
  collectionUid: string,
  itemUid: string,
  patch: VEventPatch,
): Promise<EventItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    const item = await getItem(collectionUid, itemUid)
    const oldRaw = await item.getContent(Etebase.OutputFormat.String)
    const newRaw = updateVEvent(oldRaw, patch)
    await item.setContent(newRaw)
    if (patch.summary !== undefined) setItemMeta(item, patch.summary)

    const im = await getItemManager(collectionUid)
    try {
      await im.transaction([item])
    } catch {
      // Stale etag → server has a newer version. Refetch it so the
      // caller can present local vs cloud.
      itemHandles.delete(itemKey(collectionUid, itemUid))
      const fresh = await im.fetch(itemUid)
      itemHandles.set(itemKey(collectionUid, itemUid), fresh)
      const serverRaw = await fresh.getContent(Etebase.OutputFormat.String)
      throw new EventConflictError(
        collectionUid,
        itemUid,
        newRaw,
        serverRaw,
      )
    }
    const event = parseVEvent(newRaw)
    if (!event) throw new Error('Updated VEVENT failed to parse')
    return { itemUid: item.uid, event }
  })
}

// Resolve a conflict by forcing the local version onto the server. Fetches
// a fresh handle (current etag) first so the transaction is accepted.
export function forceUpdateEvent(
  collectionUid: string,
  itemUid: string,
  localRaw: string,
): Promise<EventItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    itemHandles.delete(itemKey(collectionUid, itemUid))
    const im = await getItemManager(collectionUid)
    const item = await im.fetch(itemUid)
    await item.setContent(localRaw)
    const event = parseVEvent(localRaw)
    setItemMeta(item, event?.summary ?? '')
    await im.transaction([item])
    itemHandles.set(itemKey(collectionUid, itemUid), item)
    if (!event) throw new Error('Local VEVENT failed to parse')
    return { itemUid: item.uid, event }
  })
}

// Replace an event's whole content (used by recurrence edits that rewrite
// RRULE/EXDATE). Conflict-aware like updateEvent.
export function replaceEventRaw(
  collectionUid: string,
  itemUid: string,
  raw: string,
): Promise<EventItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    const item = await getItem(collectionUid, itemUid)
    await item.setContent(raw)
    const parsed = parseVEvent(raw)
    setItemMeta(item, parsed?.summary ?? '')
    const im = await getItemManager(collectionUid)
    try {
      await im.transaction([item])
    } catch {
      itemHandles.delete(itemKey(collectionUid, itemUid))
      const fresh = await im.fetch(itemUid)
      itemHandles.set(itemKey(collectionUid, itemUid), fresh)
      const serverRaw = await fresh.getContent(Etebase.OutputFormat.String)
      throw new EventConflictError(collectionUid, itemUid, raw, serverRaw)
    }
    if (!parsed) throw new Error('VEVENT failed to parse')
    return { itemUid: item.uid, event: parsed }
  })
}

// Create an event from a ready-made VCALENDAR string (recurrence split /
// detach produce their own ICS).
export async function createEventRaw(
  collectionUid: string,
  raw: string,
): Promise<EventItem> {
  const event = parseVEvent(raw)
  if (!event) throw new Error('VEVENT failed to parse')
  const im = await getItemManager(collectionUid)
  const item = await im.create(
    { name: event.summary, mtime: Date.now() },
    raw,
  )
  await im.transaction([item])
  itemHandles.set(itemKey(collectionUid, item.uid), item)
  return { itemUid: item.uid, event }
}

export async function deleteEvent(
  collectionUid: string,
  itemUid: string,
): Promise<void> {
  const item = await getItem(collectionUid, itemUid)
  item.delete()
  const im = await getItemManager(collectionUid)
  await im.transaction([item])
  itemHandles.delete(itemKey(collectionUid, itemUid))
}

// Move one event to another calendar. Same copy-then-delete strategy as
// moveTasksToCollection (Etebase has no native move); destination commits
// first so a failure can't lose data. Returns the new EventItem.
export async function moveEventToCollection(
  sourceCollectionUid: string,
  destCollectionUid: string,
  itemUid: string,
): Promise<EventItem> {
  if (sourceCollectionUid === destCollectionUid) {
    throw new Error('Source and destination collections are the same')
  }
  const source = await getItem(sourceCollectionUid, itemUid)
  const content = await source.getContent(Etebase.OutputFormat.String)
  const meta = source.getMeta<Record<string, unknown>>()

  const acc = await ensureAccount()
  const destCollection = await getCollection(destCollectionUid)
  const destIm = acc.getCollectionManager().getItemManager(destCollection)
  const created = await destIm.create({ ...meta, mtime: Date.now() }, content)
  await destIm.transaction([created])
  itemHandles.set(itemKey(destCollectionUid, created.uid), created)

  source.delete()
  const sourceIm = await getItemManager(sourceCollectionUid)
  await sourceIm.transaction([source])
  itemHandles.delete(itemKey(sourceCollectionUid, itemUid))

  const event = parseVEvent(content)
  if (!event) throw new Error('Moved VEVENT failed to parse')
  return { itemUid: created.uid, event }
}
