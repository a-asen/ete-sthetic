import * as Etebase from 'etebase'
import type { CollectionInfo, TaskItem } from '../types'
import { parseVTodo } from './vtodo'
import { clearSession, loadSession, saveSession } from './store'

export const DEFAULT_SERVER = 'https://api.etebase.com'
const TASK_COLLECTION_TYPE = 'etebase.vtodo'

let account: Etebase.Account | null = null

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
  await clearSession()
}

export function isAuthenticated(): boolean {
  return account !== null
}

function requireAccount(): Etebase.Account {
  if (!account) throw new Error('Not authenticated')
  return account
}

export async function listCollections(): Promise<CollectionInfo[]> {
  const acc = requireAccount()
  const cm = acc.getCollectionManager()
  const result = await cm.list(TASK_COLLECTION_TYPE)
  return result.data.map((c) => {
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
  const acc = requireAccount()
  const cm = acc.getCollectionManager()
  const collection = await cm.fetch(collectionUid)
  const im = cm.getItemManager(collection)

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
    tasks.push({ itemUid: item.uid, todo })
  }
  return tasks
}
