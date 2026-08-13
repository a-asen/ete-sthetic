# Tauri shell

The native side lives in `src-tauri/`. It's a thin Rust shell whose job is to
host the WebView, expose a few OS capabilities to the front-end, and produce a
small binary — the app logic stays in the React/services layer.

## Layout

```
src-tauri/
├── src/
│   ├── main.rs     # binary entry — calls into lib
│   └── lib.rs      # builder: registers plugins & commands
├── capabilities/
│   └── default.json  # which plugin permissions the WebView gets
├── Cargo.toml
└── tauri.conf.json   # window, bundle, and app config
```

## Plugins

The shell registers the Tauri plugins the front-end depends on:

| Plugin         | Used for                                                    |
| -------------- | ----------------------------------------------------------- |
| `store`        | Persisting the **encrypted EteSync session** locally        |
| `notification` | Firing event/task **alarms** as OS notifications            |
| `fs`           | Reading/writing `.ics` and other files                      |
| `dialog`       | Native open/save dialogs                                     |
| `http`         | Fetching remote resources (e.g. ICS subscriptions, weather) |
| `opener`       | Opening URLs in the system browser                          |

## Capabilities

Tauri 2 is deny-by-default: the WebView can only call the plugin commands
listed in `capabilities/default.json`. The granted permissions are
deliberately narrow, for example:

- `store:default`
- `notification:default`
- `dialog:default`
- `fs:default`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:scope`
- `http:default`, `http:allow-fetch`
- `opener:default`, `opener:allow-open-url`

If a new front-end feature needs an OS capability that isn't listed here, the
call will be **rejected at runtime** until the matching permission is added to
this file.

## Why Tauri

Bundling the OS WebView instead of a full browser keeps the binary around
**~10 MB** and memory use modest, while still letting the whole UI be built in
React. See the [architecture overview](/architecture/overview) for how the
shell fits under the app.
