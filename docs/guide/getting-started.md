# Install & run

ete-sthetic is a [Tauri 2](https://tauri.app/) app: a React front-end in a
small native shell. Running it from source needs both the JavaScript and the
Rust toolchains.

## Prerequisites

- **Node** 22 or newer
- **Rust** 1.77 or newer (via [rustup](https://rustup.rs/))
- On **Linux**, the GTK/WebKit libraries Tauri links against:
  `webkit2gtk-4.1`, `libsoup-3.0`, and `pkg-config` (package names vary by
  distro).

You'll also need an [EteSync](https://www.etesync.com/) account (or a
self-hosted Etebase server) to log in to.

## Run in development

```bash
npm install
npm run tauri dev
```

The **first** build compiles the full Rust dependency tree and takes a few
minutes. Subsequent dev rebuilds are quick, and the React side hot-reloads.

::: tip Linux file-watcher limit
On Tuxedo OS and other distros with a low default, `tauri dev`'s watcher can
exceed `fs.inotify.max_user_instances`. Raise it:

```bash
sudo sysctl fs.inotify.max_user_instances=512
```
:::

## Build a release binary

```bash
npm run tauri build
```

The bundle is written under `src-tauri/target/release/` (and platform
installers under `.../bundle/`).

## First launch

1. On the login screen, enter your EteSync **server URL** (or leave the
   default), **username**, and **password**.
2. ete-sthetic derives your encryption keys locally and stores the resulting
   session **encrypted on disk** via the Tauri store plugin — your password is
   not kept.
3. Your collections load from cache immediately (empty on a first run) and
   sync in the background.

See [Sync model](/guide/sync) for what happens after login.

## npm scripts

| Script                | What it does                                  |
| --------------------- | --------------------------------------------- |
| `npm run tauri dev`   | Run the full desktop app in dev mode          |
| `npm run tauri build` | Produce a release binary + installers         |
| `npm run dev`         | Vite dev server for the web front-end only    |
| `npm run build`       | Type-check (`tsc -b`) and build the web assets|
| `npm run lint`        | Run ESLint over the project                   |

## The docs site (this site)

The documentation is a [VitePress](https://vitepress.dev/) site under `docs/`.
To work on it locally:

```bash
npm install
npm run docs:dev      # local preview with hot reload
npm run docs:build    # production build into docs/.vitepress/dist
npm run docs:preview  # serve the production build
```

Pushing to `main` publishes it to GitHub Pages automatically — see
[Contributing](/contributing#documentation).
