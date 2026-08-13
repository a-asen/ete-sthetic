import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  applyStoredAccent,
  applyStoredTheme,
  watchSystemTheme,
} from './services/theme'
import { hydratePrefs } from './services/prefs'

// Restore settings from the durable Tauri store into localStorage BEFORE
// anything reads them (theme/accent below, every component's useState
// initializers). Without this, settings keyed to the WebView origin
// reset whenever the launch origin changes (dev server vs bundled app).
// Then apply the saved theme + accent before React mounts so the initial
// paint matches the user's preference — no flash.
async function bootstrap() {
  await hydratePrefs()
  applyStoredTheme()
  applyStoredAccent()
  // Keep the theme in sync with the OS while the preference is 'system'.
  watchSystemTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
