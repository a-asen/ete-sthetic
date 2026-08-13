import { invoke } from '@tauri-apps/api/core'

// Open a single-module window (tasks / calendar / contacts) in its own
// OS window — the "split tab to a new window" feature. Implemented as a
// Rust command (open_module_window) that creates a WebviewWindow
// pointing at index.html?window=<module>; the frontend's App reads the
// query param on boot and renders ONLY that module full-screen (no
// top-bar switcher, no global sync pill). Re-requesting an already-open
// module focuses the existing window instead of opening a duplicate.
//
// Each window runs its own syncs against the same etebase account
// independently; state does NOT cross the window boundary (the in-
// memory caches are per-JS-context). This is by design for "calendar
// on the second monitor" — the two windows show different modules, so
// cache divergence is harmless.
//
// Returns void on success; throws on unknown module / window-creation
// failure. Callers treat this as fire-and-forget and surface the error
// in their own toast/popover.
export async function openModuleWindow(
  module: 'tasks' | 'calendar' | 'contacts',
): Promise<void> {
  await invoke('open_module_window', { module })
}