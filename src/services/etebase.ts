import * as Etebase from 'etebase'
import type { CollectionInfo, TaskItem } from '../types'
import { buildVTodo, parseVTodo, updateVTodo, type VTodoPatch } from './vtodo'
import { clearSession, loadSession, saveSession } from './store'
import { clearAllSnapshots } from './snapshots'

export const DEFAULT_SERVER = 'https://api.etebase.com'
const TASK_COLLECTION_TYPE = 'etebase.vtodo'

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
  await clearSession()
  await clearAllSnapshots()
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

export async function listCollections(): Promise<CollectionInfo[]> {
  const acc = await ensureAccount()
  const cm = acc.getCollectionManager()
  const result = await cm.list(TASK_COLLECTION_TYPE)
  return result.data.map((c) => {
    collectionHandles.set(c.uid, c)
    const meta = c.getMeta()
    return {
      uid: c.uid,
      name: meta.name ?? '(untitled)',
      description: meta.description,
      color: meta.color,
    }
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
