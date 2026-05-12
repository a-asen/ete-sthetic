import { LazyStore } from '@tauri-apps/plugin-store'

const SESSION_KEY = 'etebase.session'
const SERVER_KEY = 'etebase.server'

export const store = new LazyStore('ete-stethic.json', {
  defaults: {},
  autoSave: true,
})

export async function saveSession(session: string, server: string) {
  await store.set(SESSION_KEY, session)
  await store.set(SERVER_KEY, server)
  await store.save()
}

export async function loadSession(): Promise<{ session: string; server: string } | null> {
  const session = await store.get<string>(SESSION_KEY)
  const server = await store.get<string>(SERVER_KEY)
  if (typeof session === 'string' && typeof server === 'string') {
    return { session, server }
  }
  return null
}

export async function clearSession() {
  await store.delete(SESSION_KEY)
  await store.delete(SERVER_KEY)
  await store.save()
}
