use std::sync::Mutex;
use tauri::{Emitter, Manager};

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

#[tauri::command]
fn take_pending_ics(state: tauri::State<PendingIcs>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
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
    .invoke_handler(tauri::generate_handler![take_pending_ics])
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
