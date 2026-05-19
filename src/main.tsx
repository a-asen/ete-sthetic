import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredAccent, applyStoredTheme } from './services/theme'

// Apply the saved theme + accent before React mounts so the initial
// paint matches the user's preference — no flash.
applyStoredTheme()
applyStoredAccent()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
