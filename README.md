# ete-sthetic

A small, aesthetic desktop client for [EteSync](https://www.etesync.com/).
Built because Thunderbird and the EteSync web client both flatten the
parent/child task hierarchy and look dated. ete-sthetic renders the tree
faithfully, leans keyboard-first, and tries to stay out of the way.

It started as a tasks-only viewer and grew into a unified client covering
all three EteSync data types — **tasks (VTODO)**, **calendar (VEVENT)**,
and **contacts (vCard)** — in one window, switchable from a pill in the
bottom-left.

## Modules

- **Tasks.** Hierarchical tree (`RELATED-TO;RELTYPE=PARENT`) with full
  CRUD, inline rename, optimistic create/delete, drag-and-drop cross-list
  move, `Alt+←/→/↑/↓` reparenting, per-list adaptive sync, priority hotkeys
  `0–9`, sort/filter popovers, completion-cascade fades, and a "raw iCal"
  editor for unreadable items.
- **Calendar.** Month / week / day / year views, recurring events (RRULE)
  with this/this-and-future/all scope dialogs, conflict resolution, alarms
  via desktop notifications, day and event popovers.
- **Contacts.** Address books, searchable list, vCard 3.0/4.0 view +
  editor (FN / N / ORG / TITLE / emails / phones / URLs / addresses /
  BDAY / NOTE / categories), avatar with photo or coloured initials,
  resizable + per-zone-zoomable panes.

All three share the same adaptive sync model (active collection on a fast
cadence, others slow, opening a collection delta-syncs only if stale),
right-click context menus, persisted per-zone zoom (`Ctrl/Cmd +/-/0`),
and Ctrl-prefixed shortcuts that don't fight the bare-letter typeahead.

## Tech

- [Tauri 2](https://tauri.app/) — small native shell (~10 MB)
- React 19 + TypeScript + Vite + Tailwind CSS v4
  (dark-first monochrome theme, single user-pickable accent)
- [`etebase`](https://www.npmjs.com/package/etebase) — official EteSync JS SDK
- [`ical.js`](https://www.npmjs.com/package/ical.js) — VTODO + VEVENT parsing
- Hand-rolled [`services/vcard.ts`](src/services/vcard.ts) parser /
  serializer (no extra dep; preserves unmodelled properties like `PHOTO`
  and `X-*` verbatim across an edit)
- Tauri plugins: `store` (encrypted Etebase session), `notification`
  (alarms), `dialog`, `fs`

## Running it

Prerequisites: Node 22+, Rust 1.77+, and the Linux GTK/WebKit deps Tauri
needs (`webkit2gtk-4.1`, `libsoup-3.0`, `pkg-config`).

```bash
npm install
npm run tauri dev
```

The first build compiles the full Rust dependency tree and takes a few
minutes. After that, dev rebuilds are quick.

> On Tuxedo OS (and other distros with a low default), `tauri dev`'s file
> watcher may exceed `fs.inotify.max_user_instances`. Bump it via
> `sudo sysctl fs.inotify.max_user_instances=512`.

## Layout

```
src/
├── App.tsx                       # auth + module switcher (tasks/calendar/contacts)
├── components/
│   ├── LoginScreen.tsx
│   ├── MainView.tsx              # tasks module
│   ├── TaskTree.tsx
│   ├── DetailPanel.tsx
│   ├── CalendarView.tsx          # calendar module
│   ├── calendar/                 # MonthGrid, TimeGrid, YearGrid, EventComposer, …
│   ├── ContactsView.tsx          # contacts module
│   ├── contacts/                 # ContactCard, ContactEditor
│   └── …                         # ContextMenu, ConfirmModal, CalendarPopover, hints, popovers
├── services/
│   ├── etebase.ts                # SDK wrapper: login / restore / list / CRUD per type
│   ├── store.ts                  # encrypted session via tauri-plugin-store
│   ├── snapshots.ts              # cold-start disk cache
│   ├── taskstore.ts              # warm in-memory cache (tasks)
│   ├── calstore.ts / calsnapshot.ts        # calendar caches
│   ├── contactstore.ts / contactsnapshot.ts # contacts caches
│   ├── vtodo.ts / vevent.ts / vcard.ts     # parsers + serializers
│   ├── tree.ts                   # builds task tree from PARENT/CHILD reltypes
│   ├── recurrence.ts / recurrence-edit.ts  # RRULE expansion + scope edits
│   ├── alarms.ts                 # VALARM → desktop notifications
│   ├── caldate.ts                # date-grid helpers (shared by MonthGrid + CalendarPopover)
│   ├── sort.ts / hints.ts / theme.ts
│   └── ics.ts                    # iCal text utilities
├── types.ts
└── index.css                     # Tailwind v4 + theme tokens

src-tauri/                        # Rust shell, plugins, capabilities
docs/                             # task-item-options, calendar-roadmap, calendar-contacts-plan
```

## Status & roadmap

Actively developed. The day-to-day backlog, shipped work, and known issues
live in [`TODO.md`](TODO.md); module-specific plans in [`docs/`](docs/).
The big unshipped items right now:

- Per-list manual ordering (and `Shift+↑/↓` reorder / drag-to-position) —
  blocked on a per-list manual-order store; design sketch in the
  tree-UX backlog.
- Fleshing out the remaining VTODO fields worksheet
  ([`docs/task-item-options.md`](docs/task-item-options.md)).
- A TUI sibling using [Ink](https://github.com/vadimdemedes/ink),
  sharing the `services/` core.
