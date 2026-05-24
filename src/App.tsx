import { Suspense, lazy, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { LoginScreen } from './components/LoginScreen'
import { MainView } from './components/MainView'
import { SyncStatusPill } from './components/SyncStatusPill'
import { restoreSession } from './services/etebase'
import {
  MODULE_FLAGS_CHANGED_EVENT,
  readModuleEnabled,
  setModuleEnabled,
  type ModuleName,
} from './services/moduleFlags'

// Custom event the OS "Open with" → argv path uses to hand a parsed
// .ics file path to the calendar view. App.tsx invokes the Tauri
// command on launch, switches to the calendar module, and dispatches
// this so CalendarView can read the file + open the picker.
export const ICS_OPEN_EVENT = 'ete-sthetic:ics-file-open'
export interface IcsOpenDetail {
  path: string
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

const MODULE_ORDER: readonly ModuleName[] = ['tasks', 'calendar', 'contacts']

// Slim module switcher (calendar-contacts-plan.md path A, step 2). Rendered
// as a fixed pill so MainView's full-screen layout is left untouched.
// Modules disabled via the settings flag aren't rendered here so the
// switcher shrinks to whatever the user actually uses.
function ModuleSwitch({
  module,
  onChange,
  enabled,
}: {
  module: ModuleName
  onChange: (m: ModuleName) => void
  enabled: ReadonlySet<ModuleName>
}) {
  return (
    <div className="fixed bottom-3 left-3 z-50 flex gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs shadow-lg">
      {MODULE_ORDER.filter((m) => enabled.has(m)).map((m) => (
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
  return new Set(MODULE_ORDER.filter(readModuleEnabled))
}

function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [module, setModule] = useState<ModuleName>('tasks')
  const [enabledModules, setEnabledModules] =
    useState<Set<ModuleName>>(readEnabledSet)

  useEffect(() => {
    restoreSession().then((ok) => {
      setAuth(ok ? 'authenticated' : 'unauthenticated')
    })
  }, [])

  // OS "Open with → ete-sthetic" handoff. The Tauri Rust side stashes
  // an .ics argv path in shared state on startup; we drain it via the
  // take_pending_ics command once the user is authenticated. If the
  // calendar module is disabled, force-enable it first — the user
  // explicitly asked to open a calendar file, the alternative is the
  // path getting silently dropped. Routes to the actual import flow
  // by dispatching ICS_OPEN_EVENT, which CalendarView listens for.
  useEffect(() => {
    if (auth !== 'authenticated') return
    let done = false
    invoke<string | null>('take_pending_ics')
      .then((path) => {
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
      })
      .catch(() => {
        // Command isn't registered (dev mode against an older binary,
        // or non-Tauri build). Silently skip — drag-drop and Paste
        // invite still cover the use case.
      })
    return () => {
      done = true
    }
  }, [auth])

  // Reflect flips made from any module's settings popover. If the
  // currently-active module gets disabled, fall back to tasks (always
  // enabled — see moduleFlags.ts's tasks-can't-be-off guard).
  useEffect(() => {
    const refresh = () => {
      const next = readEnabledSet()
      setEnabledModules(next)
      setModule((cur) => (next.has(cur) ? cur : 'tasks'))
    }
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
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
  return (
    <>
      {module === 'tasks' && <MainView onLoggedOut={onLoggedOut} />}
      {module === 'calendar' && enabledModules.has('calendar') && (
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center bg-bg">
              <p className="text-sm text-text-faint">Loading calendar…</p>
            </div>
          }
        >
          <CalendarView onLoggedOut={onLoggedOut} />
        </Suspense>
      )}
      {module === 'contacts' && enabledModules.has('contacts') && (
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center bg-bg">
              <p className="text-sm text-text-faint">Loading contacts…</p>
            </div>
          }
        >
          <ContactsView onLoggedOut={onLoggedOut} />
        </Suspense>
      )}
      <ModuleSwitch
        module={module}
        onChange={setModule}
        enabled={enabledModules}
      />
      <SyncStatusPill />
    </>
  )
}

export default App
