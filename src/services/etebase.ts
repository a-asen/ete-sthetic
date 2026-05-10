import * as Etebase from 'etebase'
import type { CollectionInfo, TaskItem } from '../types'
import { buildVTodo, parseVTodo, updateVTodo, type VTodoPatch } from './vtodo'
import { clearSession, loadSession, saveSession } from './store'

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
}

export function isAuthenticated(): boolean {
  return account !== null
}

function requireAccount(): Etebase.Account {
  if (!account) throw new Error('Not authenticated')
  return account
}

async function getCollection(uid: string): Promise<Etebase.Collection> {
  const cached = collectionHandles.get(uid)
  if (cached) return cached
  const cm = requireAccount().getCollectionManager()
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
  const cm = requireAccount().getCollectionManager()
  const collection = await getCollection(collectionUid)
  const im = cm.getItemManager(collection)
  const item = await im.fetch(itemUid)
  itemHandles.set(itemKey(collectionUid, itemUid), item)
  return item
}

async function getItemManager(
  collectionUid: string,
): Promise<Etebase.ItemManager> {
  const collection = await getCollection(collectionUid)
  return requireAccount().getCollectionManager().getItemManager(collection)
}

export async function listCollections(): Promise<CollectionInfo[]> {
  const acc = requireAccount()
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

export async function listTaskItems(collectionUid: string): Promise<TaskItem[]> {
  const im = await getItemManager(collectionUid)

  const items: Etebase.Item[] = []
  let stoken: string | undefined
  while (true) {
    const page = await im.list({ stoken })
    items.push(...page.data)
    stoken = page.stoken
    if (page.done) break
  }

  const tasks: TaskItem[] = []
  for (const item of items) {
    if (item.isDeleted) continue
    const raw = await item.getContent(Etebase.OutputFormat.String)
    const todo = parseVTodo(raw)
    if (!todo) continue
    itemHandles.set(itemKey(collectionUid, item.uid), item)
    tasks.push({ itemUid: item.uid, todo })
  }
  return tasks
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
