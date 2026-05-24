use std::sync::Mutex;

// Holds the .ics path passed via argv on launch (e.g. the user double-
// clicked a calendar invite in their file manager and the OS routed
// it to us via the bundle's fileAssociations). The frontend drains
// the slot exactly once with `take_pending_ics` on App mount.
//
// Subsequent-launch handoff (a second double-click while we're
// already running) would need tauri-plugin-single-instance; for now,
// the second launch just opens a second window with its own arg.
struct PendingIcs(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_ics(state: tauri::State<PendingIcs>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
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
    .manage(PendingIcs(Mutex::new(pending)))
    .invoke_handler(tauri::generate_handler![take_pending_ics])
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
