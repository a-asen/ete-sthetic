import * as Etebase from 'etebase'
import type {
  ColType,
  CollectionInfo,
  ContactItem,
  EventItem,
  TaskItem,
  VCard,
} from '../types'
import {
  buildVTodo,
  parseVTodo,
  updateVTodo,
  type NewVTodoArgs,
  type VTodoPatch,
} from './vtodo'
import {
  buildVEvent,
  parseVEvent,
  updateVEvent,
  type NewVEventArgs,
  type VEventPatch,
} from './vevent'
import { parseVCard, serializeVCard } from './vcard'
import { clearSession, loadSession, saveSession } from './store'
import { clearAllSnapshots } from './snapshots'
import { clearAllCalSnapshots } from './calsnapshot'
import { clearAllSubSnapshots } from './icsSubscriptionSnapshot'
import { clearAllContactSnapshots } from './contactsnapshot'
import { resetCalMemory } from './calstore'
import { resetContactMemory } from './contactstore'
import { resetTaskMemory } from './taskstore'
import { resetSyncStatus } from './syncStatus'
import { stopAlarmScheduler } from './alarms'

export const DEFAULT_SERVER = 'https://api.etebase.com'
const TASK_COLLECTION_TYPE: ColType = 'etebase.vtodo'
const CALENDAR_COLLECTION_TYPE: ColType = 'etebase.vevent'
const CONTACT_COLLECTION_TYPE: ColType = 'etebase.vcard'

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
  resetContactMemory()
  resetTaskMemory()
  resetSyncStatus()
  await clearSession()
  await clearAllSnapshots()
  await clearAllCalSnapshots()
  await clearAllContactSnapshots()
  await clearAllSubSnapshots()
}

export function isAuthenticated(): boolean {
  return account !== null
}

export interface AccountInfo {
  username: string
  email: string
  serverUrl: string
}

// Identity of the signed-in account, for the home page's "you're logged in
// as…" card. Resolves null when there's no usable session (the caller then
// shows a sign-in prompt). Goes through ensureAccount so a null module-level
// `account` after an HMR reload still yields the restored identity rather
// than a spurious "not logged in".
export async function getAccountInfo(): Promise<AccountInfo | null> {
  try {
    const acc = await ensureAccount()
    return {
      username: acc.user.username,
      email: acc.user.email,
      serverUrl: acc.serverUrl,
    }
  } catch {
    return null
  }
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
  let resultStoken: string = ''
  while (true) {
    checkAborted(signal)
    // Pass the ORIGINAL stoken on every page — the server tracks
    // pagination internally. Updating stoken to page.stoken between
    // pages would turn the next call into a delta sync (returning
    // nothing), silently dropping all items after the first page.
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
    // Capture the collection's latest stoken for the caller to persist,
    // but DON'T feed it back into the next im.list() call — that would
    // start a delta sync from the current point, returning nothing.
    resultStoken = page.stoken
    if (page.done) break
  }

  flush()
  return { items: accumulated, removed, stoken: resultStoken }
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

// Create a task from a full set of fields (summary + the optional
// properties buildVTodo understands). Used for copy/paste duplication,
// where we carry over the source task's text, priority, due, and
// recurrence into a fresh, uncompleted VTODO with a brand-new UID.
export async function createTaskFrom(
  collectionUid: string,
  args: NewVTodoArgs,
): Promise<TaskItem> {
  const im = await getItemManager(collectionUid)
  const { raw } = buildVTodo(args)

  const item = await im.create({ name: args.summary, mtime: Date.now() }, raw)
  await im.transaction([item])
  itemHandles.set(itemKey(collectionUid, item.uid), item)

  const todo = parseVTodo(raw)
  if (!todo) throw new Error('Built VTODO failed to parse')
  return { itemUid: item.uid, todo }
}

// Create several related VTODOs into one collection in a single commit.
// Used by Task Blueprints to materialise a parent + nested subtask tree
// atomically. Each spec carries its own fixed VTODO uid (deterministic per
// day) and PARENT link so the tree resolves once synced. All items are
// committed together via one im.transaction — either the whole tree lands
// or none of it does.
export async function createTasksBatch(
  collectionUid: string,
  specs: NewVTodoArgs[],
): Promise<TaskItem[]> {
  if (specs.length === 0) return []
  const im = await getItemManager(collectionUid)
  const items: Etebase.Item[] = []
  const results: TaskItem[] = []
  for (const spec of specs) {
    const { raw } = buildVTodo(spec)
    const item = await im.create(
      { name: spec.summary, mtime: Date.now() },
      raw,
    )
    const todo = parseVTodo(raw)
    if (!todo) throw new Error('Built blueprint VTODO failed to parse')
    items.push(item)
    results.push({ itemUid: item.uid, todo })
  }
  await im.transaction(items)
  for (const item of items) {
    itemHandles.set(itemKey(collectionUid, item.uid), item)
  }
  return results
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

  // Fetch the source items FRESH from the server (not the cached handles)
  // so both the copied content and the later delete reflect current
  // server state — a stale cached handle is what made the delete reject
  // and leave a duplicate (see the delete block below).
  const sourceIm = await getItemManager(sourceCollectionUid)
  const sourceItems = await Promise.all(
    itemUids.map((uid) => sourceIm.fetch(uid)),
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

  // Now delete the source items (the handles fetched fresh above carry
  // the current etag). `batch` force-writes the deletion so an unrelated
  // change to the collection can't block a removal we definitely intend —
  // a rejected delete here, with the destination copies already
  // committed, is what left the same item in BOTH lists (the duplicate
  // bug). The verify-and-retry below re-fetches if the first pass misses.
  const toDelete = sourceItems.filter((it) => !it.isDeleted)
  for (const it of toDelete) it.delete()
  if (toDelete.length > 0) await sourceIm.batch(toDelete)

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
    await sourceIm.batch(retry)
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
  type: ColType = TASK_COLLECTION_TYPE,
): Promise<CollectionInfo> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const collection = await cm.create(
    type,
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
  let resultStoken: string = ''
  while (true) {
    checkAborted(signal)
    // Pass the ORIGINAL stoken on every page — see listTaskItems for
    // why updating stoken between pages silently drops items.
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
    resultStoken = page.stoken
    if (page.done) break
  }

  flush()
  return { items: accumulated, removed, stoken: resultStoken }
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
//
// Hardened identically to the task/contact move (see moveTasksToCollection):
// the source is fetched FRESH and deleted with batch() + verify/retry, so a
// stale cached etag can't make the delete silently reject and leave the same
// event in BOTH calendars — the cross-client duplicate that shows once here
// (this app renders per calendar) but twice on a phone that sees both.
export async function moveEventToCollection(
  sourceCollectionUid: string,
  destCollectionUid: string,
  itemUid: string,
): Promise<EventItem> {
  if (sourceCollectionUid === destCollectionUid) {
    throw new Error('Source and destination collections are the same')
  }

  // Fetch the source FRESH from the server (not the cached handle) so both
  // the copied content and the later delete carry the current etag.
  const sourceIm = await getItemManager(sourceCollectionUid)
  const source = await sourceIm.fetch(itemUid)
  const content = await source.getContent(Etebase.OutputFormat.String)
  const meta = source.getMeta<Record<string, unknown>>()

  // Copy into the destination first — if this fails the original is intact.
  const acc = await ensureAccount()
  const destCollection = await getCollection(destCollectionUid)
  const destIm = acc.getCollectionManager().getItemManager(destCollection)
  const created = await destIm.create({ ...meta, mtime: Date.now() }, content)
  await destIm.transaction([created])
  itemHandles.set(itemKey(destCollectionUid, created.uid), created)

  // Delete the source with the fresh handle via batch(): force-write the
  // deletion so an unrelated change to the source calendar can't block a
  // removal we definitely intend (the copy is already committed).
  if (!source.isDeleted) {
    source.delete()
    await sourceIm.batch([source])
  }

  // Verify the server actually recorded the delete (fetch bypasses the
  // handle cache; a deleted item returns isDeleted=true). Retry once, then
  // fail loudly rather than silently leave a duplicate across clients.
  const stillThere = async (): Promise<boolean> => {
    try {
      const fresh = await sourceIm.fetch(itemUid)
      return !fresh.isDeleted
    } catch {
      return false
    }
  }
  if (await stillThere()) {
    const retry = await sourceIm.fetch(itemUid)
    if (!retry.isDeleted) {
      retry.delete()
      await sourceIm.batch([retry])
    }
    if (await stillThere()) {
      throw new Error(
        'Move incomplete: the event is still in the source calendar on the ' +
          'server (a copy was created in the destination). Re-open the ' +
          'source calendar and move it again.',
      )
    }
  }
  itemHandles.delete(itemKey(sourceCollectionUid, itemUid))

  const event = parseVEvent(content)
  if (!event) throw new Error('Moved VEVENT failed to parse')
  return { itemUid: created.uid, event }
}

// ---- Contacts (vCard) ----
// Reuses the same type-agnostic collection/item plumbing as tasks and
// calendar; only the parser (parseVCard) and serializer differ.

export interface ContactSyncResult {
  items: ContactItem[]
  removed: string[]
  stoken: string
}

export interface ListContactItemsOptions {
  signal?: AbortSignal
  onBatch?: (batch: ContactItem[]) => void
  fromStoken?: string
}

// Address books are just collections of the vCard type.
export function listAddressBooks(
  options: ListCollectionsOptions = {},
): Promise<CollectionInfo[]> {
  return listCollections(options, CONTACT_COLLECTION_TYPE)
}

export function createAddressBook(
  name: string,
  opts: { description?: string; color?: string } = {},
): Promise<CollectionInfo> {
  return createCollection(name, opts, CONTACT_COLLECTION_TYPE)
}

// Thin wrapper for symmetry with createAddressBook / the tasks
// createCollection path. Lets CalendarView surface a "+ New calendar"
// affordance without having to know the etebase collection-type string.
export function createCalendar(
  name: string,
  opts: { description?: string; color?: string } = {},
): Promise<CollectionInfo> {
  return createCollection(name, opts, CALENDAR_COLLECTION_TYPE)
}

// Mirror of listTaskItems / listEventItems for vCard. Same incremental
// sync / batching / abort shape.
export async function listContactItems(
  collectionUid: string,
  options: ListContactItemsOptions = {},
): Promise<ContactSyncResult> {
  const { signal, onBatch, fromStoken } = options
  checkAborted(signal)

  const im = await getItemManager(collectionUid)
  const accumulated: ContactItem[] = []
  const removed: string[] = []
  let pendingBatch: ContactItem[] = []

  const flush = () => {
    if (pendingBatch.length === 0) return
    const batch = pendingBatch
    pendingBatch = []
    accumulated.push(...batch)
    onBatch?.(batch)
  }

  let stoken: string | undefined = fromStoken
  let resultStoken: string = ''
  while (true) {
    checkAborted(signal)
    // Pass the ORIGINAL stoken on every page — see listTaskItems for
    // why updating stoken between pages silently drops items.
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
      const card = parseVCard(raw)
      if (!card) continue
      itemHandles.set(itemKey(collectionUid, item.uid), item)
      const meta = item.getMeta<Record<string, unknown>>()
      const mtime =
        typeof meta.mtime === 'number' ? (meta.mtime as number) : null
      pendingBatch.push({ itemUid: item.uid, card, mtime })
      if (pendingBatch.length >= BATCH_SIZE) {
        flush()
        await yieldToEventLoop()
        checkAborted(signal)
      }
    }
    resultStoken = page.stoken
    if (page.done) break
  }

  flush()
  return { items: accumulated, removed, stoken: resultStoken }
}

export async function createContact(
  collectionUid: string,
  card: VCard,
): Promise<ContactItem> {
  const im = await getItemManager(collectionUid)
  const raw = serializeVCard(card)
  const mtime = Date.now()
  const item = await im.create({ name: card.fn, mtime }, raw)
  await im.transaction([item])
  itemHandles.set(itemKey(collectionUid, item.uid), item)
  const parsed = parseVCard(raw)
  if (!parsed) throw new Error('Built vCard failed to parse')
  return { itemUid: item.uid, card: parsed, mtime }
}

// Update a contact from an edited model. The previous raw text is passed
// to serializeVCard so unmodelled properties (PHOTO, X-*, …) round-trip.
export function updateContact(
  collectionUid: string,
  itemUid: string,
  card: VCard,
): Promise<ContactItem> {
  return chainItemMutation(collectionUid, itemUid, async () => {
    const item = await getItem(collectionUid, itemUid)
    const oldRaw = await item.getContent(Etebase.OutputFormat.String)
    const newRaw = serializeVCard(card, oldRaw)
    await item.setContent(newRaw)
    setItemMeta(item, card.fn)

    const im = await getItemManager(collectionUid)
    await im.transaction([item])

    const parsed = parseVCard(newRaw)
    if (!parsed) throw new Error('Updated vCard failed to parse')
    const meta = item.getMeta<Record<string, unknown>>()
    const mtime =
      typeof meta.mtime === 'number' ? (meta.mtime as number) : Date.now()
    return { itemUid: item.uid, card: parsed, mtime }
  })
}

export async function deleteContact(
  collectionUid: string,
  itemUid: string,
): Promise<void> {
  const item = await getItem(collectionUid, itemUid)
  item.delete()
  const im = await getItemManager(collectionUid)
  await im.transaction([item])
  itemHandles.delete(itemKey(collectionUid, itemUid))
}

// Move contacts between address books. Mirror of moveTasksToCollection:
// copy-then-delete with a server-side verify so we never leave the source
// copies behind (which would show the same contact in two books across
// every client). Destination create commits first, so a mid-way failure
// loses no data (worst case = a duplicate the user can retry).
export async function moveContactsToCollection(
  sourceCollectionUid: string,
  destCollectionUid: string,
  itemUids: string[],
): Promise<ContactItem[]> {
  if (itemUids.length === 0) return []
  if (sourceCollectionUid === destCollectionUid) {
    throw new Error('Source and destination address books are the same')
  }

  // Fetch fresh (not cached handles) so content + delete reflect current
  // server state — a stale handle made the delete reject and left a
  // duplicate across both books (see moveTasksToCollection).
  const sourceIm = await getItemManager(sourceCollectionUid)
  const sourceItems = await Promise.all(
    itemUids.map((uid) => sourceIm.fetch(uid)),
  )
  const payloads = await Promise.all(
    sourceItems.map(async (item) => ({
      content: await item.getContent(Etebase.OutputFormat.String),
      meta: item.getMeta<Record<string, unknown>>(),
    })),
  )

  const acc = await ensureAccount()
  const destCollection = await getCollection(destCollectionUid)
  const destIm = acc.getCollectionManager().getItemManager(destCollection)
  const created: Etebase.Item[] = []
  for (const { content, meta } of payloads) {
    const newItem = await destIm.create({ ...meta, mtime: Date.now() }, content)
    created.push(newItem)
  }
  await destIm.transaction(created)
  for (const newItem of created) {
    itemHandles.set(itemKey(destCollectionUid, newItem.uid), newItem)
  }

  // Force-write the deletion (batch) with the fresh handles above.
  const toDelete = sourceItems.filter((it) => !it.isDeleted)
  for (const it of toDelete) it.delete()
  if (toDelete.length > 0) await sourceIm.batch(toDelete)

  // Verify the server recorded the deletions (see moveTasksToCollection).
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
    const retry = await Promise.all(stuck.map((uid) => sourceIm.fetch(uid)))
    for (const it of retry) it.delete()
    await sourceIm.batch(retry)
    stuck = await stillPresent()
  }
  if (stuck.length > 0) {
    throw new Error(
      `Move incomplete: ${stuck.length} contact(s) are still in the source ` +
        `book on the server (copies were created in the destination). ` +
        `Re-open the source book and move the remaining contact(s) again.`,
    )
  }

  for (const uid of itemUids) {
    itemHandles.delete(itemKey(sourceCollectionUid, uid))
  }

  const out: ContactItem[] = []
  for (let i = 0; i < created.length; i++) {
    const card = parseVCard(payloads[i].content)
    if (!card) continue
    const meta = payloads[i].meta
    const mtime = typeof meta.mtime === 'number' ? (meta.mtime as number) : null
    out.push({ itemUid: created[i].uid, card, mtime })
  }
  return out
}
