import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { LoginScreen } from './components/LoginScreen'
import { HomeView } from './components/HomeView'
import { GlobalSettings } from './components/GlobalSettings'
import { MainView } from './components/MainView'
import { MetaSearchModal, type MetaHit } from './components/MetaSearchModal'
import { SyncStatusPill } from './components/SyncStatusPill'
import { restoreSession } from './services/etebase'
import {
  syncCalendarsInBackground,
  syncContactsInBackground,
} from './services/backgroundSync'
import {
  MODULE_FLAGS_CHANGED_EVENT,
  readModuleEnabled,
  readModuleOrder,
  setModuleEnabled,
  type ModuleName,
} from './services/moduleFlags'
import { triggerSyncAll } from './services/syncStatus'
import { runBlueprintSpawn } from './services/blueprints'
import { getUnsavedGuard, type UnsavedKind } from './services/unsavedGuard'
import { UnsavedSwitchModal } from './components/UnsavedSwitchModal'

// Custom event the OS "Open with" → argv path uses to hand a parsed
// .ics file path to the calendar view. App.tsx invokes the Tauri
// command on launch, switches to the calendar module, and dispatches
// this so CalendarView can read the file + open the picker.
export const ICS_OPEN_EVENT = 'ete-sthetic:ics-file-open'
export interface IcsOpenDetail {
  path: string
}

// Cross-module navigation: any module can dispatch this to ask App
// to switch to contacts and select a specific contact. Used by the
// calendar birthdays overlay so clicking a birthday entry opens
// the underlying contact card. App handles the module switch + a
// stashed "pending open" that ContactsView consumes on mount.
export const CONTACT_OPEN_EVENT = 'ete-sthetic:contact-open'
export interface ContactOpenDetail {
  bookUid: string
  contactItemUid: string
}

// The calendar and contacts modules are dead weight for a tasks-only
// session, so each loads on demand the first time the user switches to it.
const CalendarView = lazy(() =>
  import('./components/CalendarView').then((m) => ({
    default: m.CalendarView,
  })),
)
const ContactsView = lazy(() =>
  import('./components/ContactsView').then((m) => ({
    default: m.ContactsView,
  })),
)

type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

// Slim module switcher (calendar-contacts-plan.md path A, step 2).
// Rendered inline inside the top bar in App's flex-column layout —
// previously a fixed pill at bottom-left, but it overshadowed the
// last items of the sidebar lists when the list got long. Putting it
// at the top of the window above every module's content surface
// resolves that and gives the global-nav element a structurally
// natural home. Modules disabled via the settings flag aren't
// rendered here so the switcher shrinks to whatever the user actually
// uses.
function ModuleSwitch({
  module,
  onChange,
  enabled,
  order,
}: {
  module: ModuleName
  onChange: (m: ModuleName) => void
  enabled: ReadonlySet<ModuleName>
  order: readonly ModuleName[]
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs">
      {order.filter((m) => enabled.has(m)).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded-md px-2.5 py-1 capitalize ${
            module === m
              ? 'bg-accent-soft text-accent'
              : 'text-text-muted hover:bg-surface-2'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function readEnabledSet(): Set<ModuleName> {
  return new Set(readModuleOrder().filter(readModuleEnabled))
}

// First enabled module in the user's switcher order — the safe fallback
// when the active module gets hidden. moduleFlags guarantees at least one
// stays on.
function firstEnabledModule(): ModuleName {
  return readModuleOrder().find(readModuleEnabled) ?? 'home'
}

// Land on tasks when it's enabled (the common case), otherwise the first
// enabled module (home may itself be hidden now).
function initialModule(): ModuleName {
  return readModuleEnabled('tasks') ? 'tasks' : firstEnabledModule()
}

function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [module, setModule] = useState<ModuleName>(initialModule)
  const [enabledModules, setEnabledModules] =
    useState<Set<ModuleName>>(readEnabledSet)
  // User-customisable module order (drives the switcher + Ctrl+Alt+1..4).
  const [moduleOrder, setModuleOrder] =
    useState<ModuleName[]>(readModuleOrder)
  // Global ("general") settings overlay, opened from the top-bar gear.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A module switch the user requested while an editor had unsaved changes —
  // parked until they choose Save / Discard / Keep-editing in the prompt.
  const [pendingSwitch, setPendingSwitch] = useState<{
    target: ModuleName
    kind: UnsavedKind
  } | null>(null)
  const [switchSaving, setSwitchSaving] = useState(false)
  // Stash for "open this contact" requests from other modules
  // (e.g. the calendar birthdays overlay). ContactsView consumes it on
  // mount via the pendingOpen prop and calls onPendingOpenConsumed
  // once it's selected the contact.
  const [pendingContactOpen, setPendingContactOpen] =
    useState<ContactOpenDetail | null>(null)
  // Global Ctrl/Cmd+K "meta search" across every module + the same
  // reveal-the-item handoff for tasks and calendar that contacts already has.
  const [metaSearchOpen, setMetaSearchOpen] = useState(false)
  const [pendingTaskOpen, setPendingTaskOpen] = useState<{
    collectionUid: string
    taskUid: string
  } | null>(null)
  const [pendingCalendarOpen, setPendingCalendarOpen] = useState<{
    calUid: string
    itemUid: string
    startMs: number | null
  } | null>(null)

  useEffect(() => {
    restoreSession().then((ok) => {
      setAuth(ok ? 'authenticated' : 'unauthenticated')
    })
  }, [])

  // Keep the current module readable from stable callbacks without making
  // them depend on it (so they don't re-create on every switch).
  const moduleRef = useRef(module)
  useEffect(() => {
    moduleRef.current = module
  }, [module])

  // Every user-initiated module switch funnels through here. If an editor
  // (task / event / contact) has unsaved changes, park the switch and prompt
  // instead of silently dropping the in-progress item.
  const requestModule = useCallback((target: ModuleName) => {
    if (target === moduleRef.current) return
    const guard = getUnsavedGuard()
    if (guard && guard.isDirty()) {
      setPendingSwitch({ target, kind: guard.kind })
    } else {
      setModule(target)
    }
  }, [])

  const cancelSwitch = () => setPendingSwitch(null)

  const discardAndSwitch = () => {
    getUnsavedGuard()?.discard()
    const target = pendingSwitch?.target
    setPendingSwitch(null)
    if (target) setModule(target)
  }

  const saveAndSwitch = async () => {
    const guard = getUnsavedGuard()
    const target = pendingSwitch?.target
    if (!guard) {
      setPendingSwitch(null)
      if (target) setModule(target)
      return
    }
    setSwitchSaving(true)
    let ok: boolean
    try {
      ok = await guard.save()
    } catch {
      ok = false
    }
    setSwitchSaving(false)
    setPendingSwitch(null)
    // On a save that couldn't complete (e.g. missing title), stay put so the
    // editor keeps focus and shows its own validation error.
    if (ok && target) setModule(target)
  }

  // Kick off a background sync for each lazy module the moment the user
  // is authenticated, so the calendar and contacts caches start refreshing
  // before the user navigates to them. Tasks already syncs through
  // MainView's own mount effects; the lazy Views don't, so without this
  // they'd stay frozen at their last cached state until the user either
  // visited the module or clicked the sync pill. Reacts to module-flag
  // flips too — turning a module on triggers its first sync without
  // a reload. The service-level in-flight guards dedupe re-renders.
  useEffect(() => {
    if (auth !== 'authenticated') return
    if (readModuleEnabled('calendar')) void syncCalendarsInBackground()
    if (readModuleEnabled('contacts')) void syncContactsInBackground()
  }, [auth, enabledModules])

  // Task Blueprints: materialise any due blueprint for *today* on launch,
  // and again whenever the app crosses local midnight while left open (that
  // new day is still "a day the app is open"). Never back-fills closed days.
  // The spawn engine itself is idempotent + concurrency-guarded.
  useEffect(() => {
    if (auth !== 'authenticated') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const runAndReschedule = () => {
      if (cancelled) return
      void runBlueprintSpawn(new Date())
      const now = new Date()
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        30, // small buffer past midnight
      )
      timer = setTimeout(runAndReschedule, nextMidnight.getTime() - now.getTime())
    }
    runAndReschedule()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [auth])

  // OS "Open with → ete-sthetic" handoff. Two arrival paths funnel
  // through the same routing:
  //  - Cold start: the Tauri Rust side stashes an .ics argv path in
  //    shared state; we drain it via take_pending_ics once authenticated.
  //  - Warm handoff: a second double-click while we're already running
  //    is routed by tauri-plugin-single-instance, which emits an
  //    `ics-open` event instead of opening a second window.
  // Either way, if the calendar module is disabled we force-enable it
  // first (the user explicitly asked to open a calendar file; the
  // alternative is the path getting silently dropped), switch to it,
  // then dispatch ICS_OPEN_EVENT, which CalendarView listens for.
  useEffect(() => {
    if (auth !== 'authenticated') return
    let done = false

    const routeIcsPath = (path: string) => {
      if (done || !path) return
      if (!readModuleEnabled('calendar')) {
        setModuleEnabled('calendar', true)
      }
      setModule('calendar')
      // Defer one tick so the calendar view has time to mount its
      // event listener before we fire.
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent<IcsOpenDetail>(ICS_OPEN_EVENT, {
            detail: { path },
          }),
        )
      })
    }

    invoke<string | null>('take_pending_ics')
      .then((path) => {
        if (path) routeIcsPath(path)
      })
      .catch(() => {
        // Command isn't registered (dev mode against an older binary,
        // or non-Tauri build). Silently skip — drag-drop and Paste
        // invite still cover the use case.
      })

    // Warm-handoff listener for second launches. Resolves to a no-op
    // unlisten in non-Tauri / older builds where the import or the
    // event channel isn't available.
    let unlisten: (() => void) | undefined
    listen<string>('ics-open', (event) => routeIcsPath(event.payload)).then(
      (fn) => {
        if (done) fn()
        else unlisten = fn
      },
      () => {
        // No Tauri event channel — drag-drop / paste still cover it.
      },
    )

    return () => {
      done = true
      unlisten?.()
    }
  }, [auth])

  // Reflect flips made from any module's settings popover. If the
  // currently-active module gets disabled, fall back to the first enabled
  // module (moduleFlags guarantees at least one stays on).
  useEffect(() => {
    const refresh = () => {
      const next = readEnabledSet()
      setEnabledModules(next)
      setModuleOrder(readModuleOrder())
      setModule((cur) => (next.has(cur) ? cur : firstEnabledModule()))
    }
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
  }, [])

  // Ctrl/Cmd+Alt+1..4 jump to the Nth *visible* view in the user's order;
  // Ctrl/Cmd+Alt+←/→ cycle through those views (wrapping). Mapping to the
  // enabled-and-ordered list (not fixed positions) means hiding a module
  // shifts the rest down. Guarded to not fire while typing in a field.
  useEffect(() => {
    if (auth !== 'authenticated') return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return
      const visible = readModuleOrder().filter(readModuleEnabled)
      if (visible.length === 0) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const cur = visible.indexOf(module)
        const next =
          cur < 0
            ? dir === 1
              ? 0
              : visible.length - 1
            : (cur + dir + visible.length) % visible.length
        requestModule(visible[next])
        return
      }
      const idx = ['1', '2', '3', '4'].indexOf(e.key)
      if (idx < 0) return
      const target = visible[idx]
      if (!target) return
      e.preventDefault()
      requestModule(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [auth, module, requestModule])

  // Ctrl/Cmd+Alt+S → force a full sync across every enabled module
  // (tasks + calendars + contacts). Ctrl/Cmd+Shift+S (sync only the
  // active list) is handled inside each module's view, which knows what
  // "active" means there.
  useEffect(() => {
    if (auth !== 'authenticated') return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return
      if (e.key !== 's' && e.key !== 'S') return
      e.preventDefault()
      void triggerSyncAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [auth])

  // Suppress the webview's native "Inspect element" context menu app-wide,
  // so a right-click either shows one of our own menus or nothing — never
  // the browser default. Editable text keeps its native menu (copy / paste
  // / spellcheck). Individual surfaces (task rows, contact card/list, etc.)
  // add their own onContextMenu that opens a relevant menu; this is the
  // catch-all beneath them.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return
      e.preventDefault()
    }
    window.addEventListener('contextmenu', onCtx)
    return () => window.removeEventListener('contextmenu', onCtx)
  }, [])

  // Ctrl/Cmd+K → global meta-search across every module. Honored from
  // anywhere (including text fields — it's not a text-editing key).
  useEffect(() => {
    if (auth !== 'authenticated') return
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'k' || e.key === 'K')
      ) {
        e.preventDefault()
        setMetaSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [auth])

  // Cross-module contact-open requests. Source today: the calendar's
  // birthdays overlay. If the contacts module is disabled, force-enable
  // it — the user clicked a contact, the alternative is silently
  // ignoring the click.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ContactOpenDetail>).detail
      if (!detail) return
      if (!readModuleEnabled('contacts')) setModuleEnabled('contacts', true)
      setModule('contacts')
      setPendingContactOpen(detail)
    }
    window.addEventListener(CONTACT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CONTACT_OPEN_EVENT, onOpen)
  }, [])

  if (auth === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="text-sm text-text-faint">Loading…</p>
      </div>
    )
  }

  if (auth === 'unauthenticated') {
    return <LoginScreen onAuthenticated={() => setAuth('authenticated')} />
  }

  const onLoggedOut = () => setAuth('unauthenticated')

  // A meta-search pick: switch to the item's module (enabling it if off) and
  // stash a "reveal this item" request the module consumes on mount.
  const handleMetaPick = (hit: MetaHit) => {
    setMetaSearchOpen(false)
    if (hit.kind === 'task') {
      if (!readModuleEnabled('tasks')) setModuleEnabled('tasks', true)
      setModule('tasks')
      setPendingTaskOpen({
        collectionUid: hit.collectionUid,
        taskUid: hit.item.todo.uid,
      })
    } else if (hit.kind === 'event') {
      if (!readModuleEnabled('calendar')) setModuleEnabled('calendar', true)
      setModule('calendar')
      setPendingCalendarOpen({
        calUid: hit.calUid,
        itemUid: hit.item.itemUid,
        startMs: hit.item.event.start?.getTime() ?? null,
      })
    } else {
      if (!readModuleEnabled('contacts')) setModuleEnabled('contacts', true)
      setModule('contacts')
      setPendingContactOpen({
        bookUid: hit.bookUid,
        contactItemUid: hit.item.itemUid,
      })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {/* Top bar — module switcher on the left, global sync pill on
          the right. Both share the bar so neither floats in dead
          space. */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 py-1">
        <ModuleSwitch
          module={module}
          onChange={requestModule}
          enabled={enabledModules}
          order={moduleOrder}
        />
        <div className="flex items-center gap-2">
          <SyncStatusPill />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings (appearance, modules, account)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
            </svg>
          </button>
        </div>
      </header>
      {settingsOpen && (
        <GlobalSettings
          onClose={() => setSettingsOpen(false)}
          onLoggedOut={onLoggedOut}
        />
      )}
      {pendingSwitch && (
        <UnsavedSwitchModal
          kind={pendingSwitch.kind}
          saving={switchSaving}
          onSave={saveAndSwitch}
          onDiscard={discardAndSwitch}
          onCancel={cancelSwitch}
        />
      )}
      {metaSearchOpen && (
        <MetaSearchModal
          onPick={handleMetaPick}
          onClose={() => setMetaSearchOpen(false)}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {module === 'home' && <HomeView onLoggedOut={onLoggedOut} />}
        {module === 'tasks' && enabledModules.has('tasks') && (
          <MainView
            onLoggedOut={onLoggedOut}
            pendingOpen={pendingTaskOpen}
            onPendingOpenConsumed={() => setPendingTaskOpen(null)}
          />
        )}
        {module === 'calendar' && enabledModules.has('calendar') && (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center bg-bg">
                <p className="text-sm text-text-faint">Loading calendar…</p>
              </div>
            }
          >
            <CalendarView
              onLoggedOut={onLoggedOut}
              pendingOpen={pendingCalendarOpen}
              onPendingOpenConsumed={() => setPendingCalendarOpen(null)}
            />
          </Suspense>
        )}
        {module === 'contacts' && enabledModules.has('contacts') && (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center bg-bg">
                <p className="text-sm text-text-faint">Loading contacts…</p>
              </div>
            }
          >
            <ContactsView
              onLoggedOut={onLoggedOut}
              pendingOpen={pendingContactOpen}
              onPendingOpenConsumed={() => setPendingContactOpen(null)}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}

export default App
