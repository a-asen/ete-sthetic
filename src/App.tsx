import { useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { restoreSession } from './services/etebase'

type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

function App() {
  const [auth, setAuth] = useState<AuthState>('checking')

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
    <div className="flex h-screen items-center justify-center bg-bg">
      <p className="text-sm text-text-faint">Signed in. Main view coming next.</p>
    </div>
  )
}

export default App
