import { store } from './store'

// Durable backing for the WebView's localStorage.
//
// All app settings (sort, zoom, pane widths, sync intervals, hidden
// books, keybindings, hints, theme, …) are stored in `localStorage`,
// which is keyed by *origin*. That makes them evaporate whenever the
// origin changes — most visibly when the app is launched from a fresh
// build / dev server (`http://localhost:5173`) versus the bundled app
// (`tauri://localhost`): each origin gets its own empty localStorage, so
// settings appear to reset every relaunch. The Etebase session + data
// snapshots don't have this problem because they live in the Tauri store
// (a fixed file under the app config dir, e.g. `~/.config/com.sthetic.ete/
// ete-sthetic.json`), which is origin-independent.
//
// This bridge gives localStorage the same durability with zero call-site
// changes: on startup we copy the mirror out of the Tauri store into
// localStorage, and we patch `setItem`/`removeItem` so every later write
// is debounce-flushed back into the store. localStorage stays the fast,
// synchronous read path; the store is the source of truth across launches.

const MIRROR_KEY = 'localStorageMirror.v1'
// Only mirror keys this app owns (it prefixes everything). Avoids dragging
// along anything the WebView or a library might stash in localStorage.
const OWNED_PREFIXES = ['ete-sthetic', 'cal.']

let installed = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function isOwned(key: string): boolean {
  return OWNED_PREFIXES.some((p) => key.startsWith(p))
}

function ownedEntries(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !isOwned(k)) continue
    const v = localStorage.getItem(k)
    if (v != null) out[k] = v
  }
  return out
}

async function flushNow(): Promise<void> {
  try {
    await store.set(MIRROR_KEY, ownedEntries())
    await store.save()
  } catch {
    // best-effort; the next change reschedules a flush
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushNow(), 400)
}

// Restore localStorage from the durable store, then start mirroring future
// writes back to it. Must run BEFORE any code reads settings (theme/accent
// in main.tsx, every component's useState initializers). Idempotent.
export async function hydratePrefs(): Promise<void> {
  if (installed) return
  installed = true

  try {
    const mirror = await store.get<Record<string, string>>(MIRROR_KEY)
    if (mirror) {
      for (const [k, v] of Object.entries(mirror)) {
        // Don't clobber a value already set this session (e.g. the origin
        // did persist) — that value will be re-flushed and stays current.
        if (isOwned(k) && localStorage.getItem(k) === null) {
          localStorage.setItem(k, v)
        }
      }
    }
  } catch {
    // First run / no mirror yet — nothing to restore.
  }

  // Mirror future writes. Patch the instance methods (capturing the
  // originals first) so every existing `localStorage.setItem/removeItem`
  // call site is covered without touching it.
  const origSet = localStorage.setItem.bind(localStorage)
  const origRemove = localStorage.removeItem.bind(localStorage)
  localStorage.setItem = (key: string, value: string) => {
    origSet(key, value)
    if (isOwned(key)) scheduleFlush()
  }
  localStorage.removeItem = (key: string) => {
    origRemove(key)
    if (isOwned(key)) scheduleFlush()
  }

  // Best-effort flush on the way out. The debounced writes are the real
  // guarantee (a Tauri window close may not fire these), but these catch
  // edits made within the debounce window right before quitting.
  window.addEventListener('pagehide', () => void flushNow())
  window.addEventListener('blur', () => void flushNow())

  // Persist whatever is already present (covers the very first launch,
  // migrating any pre-existing localStorage values into the store).
  scheduleFlush()
}
