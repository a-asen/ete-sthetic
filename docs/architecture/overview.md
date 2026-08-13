# Architecture overview

ete-sthetic is a **Tauri 2** desktop app: a React front-end running in a small
native (Rust) shell.

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Shell      | [Tauri 2](https://tauri.app/) — ~10 MB native binary          |
| UI         | React 19 + TypeScript + Vite                                  |
| Styling    | Tailwind CSS v4 (dark-first monochrome + single accent)       |
| Sync       | [`etebase`](https://www.npmjs.com/package/etebase) — official EteSync SDK |
| iCalendar  | [`ical.js`](https://www.npmjs.com/package/ical.js) for VTODO/VEVENT |
| vCard      | Hand-rolled parser in `services/vcard.ts` (no dependency)     |

Tauri plugins in use: **store** (encrypted session), **notification**
(alarms), **dialog**, **fs**, and **http**.

## Shape of the code

```
src/
├── App.tsx            # auth gate + module switcher (tasks / calendar / contacts)
├── main.tsx           # React entry
├── components/        # all UI — one folder per complex module
│   ├── MainView.tsx        · TaskTree · DetailPanel        (tasks)
│   ├── CalendarView.tsx    · calendar/*                     (calendar)
│   ├── ContactsView.tsx    · contacts/*                     (contacts)
│   ├── Settings*.tsx       · Global/Meta search · modals    (shared)
│   └── SyncStatusPill · ModuleToggles · Hint · ContextMenu …
├── services/          # all non-UI logic (see Services layer)
├── hooks/             # shared React hooks
├── types.ts           # the shared data model
└── index.css          # Tailwind v4 + theme tokens

src-tauri/             # Rust shell: lib.rs, main.rs, capabilities, plugins
docs/                  # this VitePress site (+ design notes)
```

## The three layers

1. **Components** render and capture input. They read from the in-memory
   stores and dispatch actions; they never talk to the network directly.
2. **Services** hold everything else: the Etebase SDK wrapper, the
   snapshot/store caches, the iCalendar/vCard parsers, recurrence, sort,
   theme, keybindings, and the sync scheduler. This is where the real logic
   lives — see [Services layer](/architecture/services).
3. **Tauri shell** provides the window, the encrypted store, notifications,
   filesystem, and HTTP — see [Tauri shell](/architecture/tauri-shell).

## Module switching

`App.tsx` is the auth gate and the **module switcher**. Once a session is
restored it mounts one of the three module roots (`MainView`,
`CalendarView`, `ContactsView`) based on the active module, and the pill in
the bottom-left switches between them. Modules can be turned off entirely via
[module toggles](/guide/settings#modules).

## Data flow in one line

> UI ⇄ in-memory store ⇄ `etebase.ts` ⇄ EteSync server — with disk snapshots
> feeding the store on cold start and a background scheduler keeping
> collections fresh.

See [Sync model](/guide/sync) for the full picture and
[Data model](/architecture/data-model) for the types that flow through it.
