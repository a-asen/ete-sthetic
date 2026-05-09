# ete-stethic

A small, aesthetic desktop client for [EteSync](https://www.etesync.com/) tasks.
Built because Thunderbird and the EteSync web client both flatten the
parent/child task hierarchy and look dated. ete-stethic renders the tree
faithfully and tries to stay out of the way.

> Status: early. Currently read-only — log in, browse collections, see your
> task hierarchy. CRUD, drag-to-reparent, recurring tasks, and reminders are
> on the roadmap.

## Tech

- [Tauri 2](https://tauri.app/) — small native shell (~10 MB)
- React 19 + TypeScript + Vite
- Tailwind CSS v4 — dark-first monochrome theme with a single mint accent
- [`etebase`](https://www.npmjs.com/package/etebase) — official EteSync JS SDK
- [`ical.js`](https://www.npmjs.com/package/ical.js) — VTODO parsing
- `tauri-plugin-store` — persists the encrypted Etebase session locally

## Running it

Prerequisites: Node 22+, Rust 1.77+, and the Linux GTK/WebKit deps Tauri needs
(`webkit2gtk-4.1`, `libsoup-3.0`, `pkg-config`).

```bash
npm install
npm run tauri dev
```

The first build compiles the full Rust dependency tree and takes a few minutes.
After that, dev rebuilds are quick.

## Layout

```
src/
├── App.tsx                 # auth state machine: checking → login | main
├── components/
│   ├── LoginScreen.tsx     # email/password (custom server toggle)
│   ├── MainView.tsx        # collection sidebar + main pane
│   └── TaskTree.tsx        # indented hierarchical tree
├── services/
│   ├── etebase.ts          # SDK wrapper: login/restore/list
│   ├── store.ts            # session persistence via tauri-plugin-store
│   ├── vtodo.ts            # ical.js → VTodo objects
│   └── tree.ts             # builds the tree from RELATED-TO;RELTYPE=PARENT
├── types.ts
└── index.css               # Tailwind v4 + theme tokens

src-tauri/                  # Rust shell, plugins, capabilities
```

## Roadmap

1. ~~Login + read-only hierarchical view~~ ✓
2. CRUD: add / edit / delete / complete tasks
3. Drag-to-reparent (`@dnd-kit`) + Tab/Shift+Tab keyboard outdent/indent
4. Recurring tasks (RRULE)
5. Reminders via `VALARM` → desktop notifications
6. TUI sibling using [Ink](https://github.com/vadimdemedes/ink), sharing the
   `services/` core
