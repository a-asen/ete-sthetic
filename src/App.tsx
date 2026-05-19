import { Suspense, lazy, useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { MainView } from './components/MainView'
import { restoreSession } from './services/etebase'

// The whole calendar module (CalendarView + calendar components +
// recurrence/ics services) is dead weight for a tasks-only session, so it
// loads on demand the first time the user switches to it.
const CalendarView = lazy(() =>
  import('./components/CalendarView').then((m) => ({
    default: m.CalendarView,
  })),
)

type AuthState = 'checking' | 'unauthenticated' | 'authenticated'
type Module = 'tasks' | 'calendar'

// Slim module switcher (calendar-contacts-plan.md path A, step 2). Rendered
// as a fixed pill so MainView's full-screen layout is left untouched.
function ModuleSwitch({
  module,
  onChange,
}: {
  module: Module
  onChange: (m: Module) => void
}) {
  return (
    <div className="fixed bottom-3 left-3 z-50 flex gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs shadow-lg">
      {(['tasks', 'calendar'] as const).map((m) => (
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

function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [module, setModule] = useState<Module>('tasks')

  useEffect(() => {
    restoreSession().then((ok) => {
      setAuth(ok ? 'authenticated' : 'unauthenticated')
    })
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

  return (
    <>
      {module === 'tasks' ? (
        <MainView onLoggedOut={() => setAuth('unauthenticated')} />
      ) : (
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center bg-bg">
              <p className="text-sm text-text-faint">Loading calendar…</p>
            </div>
          }
        >
          <CalendarView />
        </Suspense>
      )}
      <ModuleSwitch module={module} onChange={setModule} />
    </>
  )
}

export default App
