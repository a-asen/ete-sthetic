use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindowBuilder};

// Holds the .ics path passed via argv on launch (e.g. the user double-
// clicked a calendar invite in their file manager and the OS routed
// it to us via the bundle's fileAssociations). The frontend drains
// the slot exactly once with `take_pending_ics` on App mount.
//
// Subsequent-launch handoff (a second double-click while we're already
// running) is covered by tauri-plugin-single-instance: instead of
// spawning a second window, the OS hands the new argv to the running
// instance's callback, which stashes the path here AND emits an
// `ics-open` event so the already-mounted frontend reacts immediately.
// single-instance forwards argv on Linux / Windows; macOS doesn't pass
// file-opens through argv at all, so there the same handoff arrives via
// `RunEvent::Opened { urls }` in the run loop below — both funnel through
// `stash_and_emit_ics` so the frontend path is identical everywhere.
struct PendingIcs(Mutex<Option<String>>);

// The Tauri event emitted to the running instance when a second launch
// hands us an .ics path. Mirrors the frontend's `take_pending_ics`
// drain so both cold-start and warm-handoff funnel into the same picker.
const ICS_OPEN_EVENT: &str = "ics-open";

// Module labels the frontend can request to pop into their own window.
// Each gets a stable window label so re-requesting an already-open
// module focuses the existing window instead of opening a duplicate.
const MODULE_LABELS: &[(&str, &str)] = &[
  ("tasks", "tasks-window"),
  ("calendar", "calendar-window"),
  ("contacts", "contacts-window"),
];

#[tauri::command]
fn take_pending_ics(state: tauri::State<PendingIcs>) -> Option<String> {
  state.0.lock().ok().and_then(|mut g| g.take())
}

// Open a single-module window (e.g. "calendar on the second monitor").
// Loads the same frontend URL with a `?window=<module>` query param the
// App reads on boot to render ONLY that module (no top-bar switcher, no
// global sync pill). Re-requesting an already-open module focuses the
// existing window instead of opening a second one. Returns nothing on
// success / failure — the frontend treats this as fire-and-forget.
#[tauri::command]
fn open_module_window(app: tauri::AppHandle, module: String) -> Result<(), String> {
  let label = MODULE_LABELS
    .iter()
    .find(|(m, _)| *m == module.as_str())
    .map(|(_, label)| *label)
    .ok_or_else(|| format!("Unknown module: {}", module))?;

  // Already open → focus and return. WebviewWindow labels are unique;
  // a second create with the same label would panic.
  if let Some(existing) = app.get_webview_window(label) {
    let _ = existing.unminimize();
    let _ = existing.set_focus();
    return Ok(());
  }

  // Derive the URL the main window loaded, then append our query param.
  // In dev this is the Vite server; in the bundled app it's the dist
  // asset. The frontend's App.tsx reads `?window=` and branches into a
  // single-module render.
  let url = {
    let main = app
      .get_webview_window("main")
      .ok_or_else(|| "main window not found".to_string())?;
    let raw = main.url().map_err(|e| e.to_string())?;
    // The main window's URL has no query string; append ours. If it
    // somehow already has one, `?` would be wrong — but the base URL
    // is a bare path (tauri://localhost or http://localhost:5173),
    // so a single `?` is always correct here.
    format!("{}?window={}", raw, module)
  };

  let title = format!(
    "{} — ete-sthetic",
    match module.chars().next() {
      Some(c) => c.to_uppercase().collect::<String>() + &module[c.len_utf8()..],
      None => module.clone(),
    }
  );

  let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
  // Match how Tauri itself chooses the variant: http/https → External,
  // any other scheme (tauri://, ipc://, …) → CustomProtocol. This keeps
  // the new window's URL scheme identical to the main window's, so the
  // frontend loads the same way in dev (http://localhost:5173) and in
  // the bundled app (tauri://localhost).
  let webview_url = if parsed.scheme() == "http" || parsed.scheme() == "https" {
    tauri::WebviewUrl::External(parsed)
  } else {
    tauri::WebviewUrl::CustomProtocol(parsed)
  };
  WebviewWindowBuilder::new(&app, label, webview_url)
    .title(title)
    .inner_size(1100.0, 720.0)
    .min_inner_size(720.0, 480.0)
    .build()
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn ics_arg_in<'a>(mut args: impl Iterator<Item = &'a String>) -> Option<String> {
    args.find(|a| a.to_lowercase().ends_with(".ics")).cloned()
}

// Stash an incoming .ics path for the cold-drain command and push an
// `ics-open` event so a live frontend reacts immediately. Shared by the
// single-instance argv callback (Linux / Windows) and the macOS
// RunEvent::Opened handler.
fn stash_and_emit_ics<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: String) {
    if let Some(state) = app.try_state::<PendingIcs>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(path.clone());
        }
    }
    let _ = app.emit(ICS_OPEN_EVENT, path);
}

fn detect_ics_arg() -> Option<String> {
    let mut args = std::env::args();
    // Skip argv[0] — the binary path itself.
    args.next();
    args.find(|a| a.to_lowercase().ends_with(".ics"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let pending = detect_ics_arg();

  tauri::Builder::default()
    // Must be the first plugin registered. On a second launch the OS
    // routes the new argv here instead of spawning another window; we
    // pull any .ics path out, stash it for the cold-drain command, push
    // an `ics-open` event for the live frontend, and refocus the window.
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(path) = ics_arg_in(argv.iter()) {
        stash_and_emit_ics(app, path);
      }
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
      }
    }))
    .manage(PendingIcs(Mutex::new(pending)))
    .invoke_handler(tauri::generate_handler![take_pending_ics, open_module_window])
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    // macOS routes "Open with" / double-clicked files through the run
    // loop (not argv), so drain any .ics URL here and funnel it through
    // the same stash+emit path. The arm is mac/iOS-only — RunEvent::Opened
    // doesn't exist on other targets — and the params stay underscored so
    // the closure still compiles cleanly on Linux / Windows.
    .run(|_app_handle, _event| {
      #[cfg(any(target_os = "macos", target_os = "ios"))]
      {
        if let tauri::RunEvent::Opened { urls } = &_event {
          for url in urls {
            if let Ok(path) = url.to_file_path() {
              if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("ics"))
              {
                if let Some(p) = path.to_str() {
                  stash_and_emit_ics(_app_handle, p.to_string());
                }
              }
            }
          }
        }
      }
    });
}
