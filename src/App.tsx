import { Suspense, lazy, useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { MainView } from './components/MainView'
import { SyncStatusPill } from './components/SyncStatusPill'
import { restoreSession } from './services/etebase'
import {
  MODULE_FLAGS_CHANGED_EVENT,
  readModuleEnabled,
  type ModuleName,
} from './services/moduleFlags'

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
