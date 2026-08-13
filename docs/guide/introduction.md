# Introduction

**ete-sthetic** is a small, aesthetic desktop client for
[EteSync](https://www.etesync.com/) — the end-to-end-encrypted sync service
for tasks, calendars, and contacts.

It exists because the common EteSync front-ends (Thunderbird, the EteSync web
client) flatten the parent/child task hierarchy and feel dated. ete-sthetic
renders the task tree faithfully, leans keyboard-first, and tries to stay out
of the way.

It began as a tasks-only viewer and grew into a unified client covering all
three EteSync data types in one window, switchable from a pill in the
bottom-left:

| Module       | EteSync type    | Format |
| ------------ | --------------- | ------ |
| **Tasks**    | `etebase.vtodo` | VTODO  |
| **Calendar** | `etebase.vevent`| VEVENT |
| **Contacts** | `etebase.vcard` | vCard  |

## What makes it different

- **The tree stays a tree.** Tasks are linked with
  `RELATED-TO;RELTYPE=PARENT` and rendered as a real hierarchy, not a flat
  list — with drag-and-drop cross-list moves and `Alt`+arrow reparenting.
- **Keyboard-first, but not keyboard-hostile.** Bare-letter *typeahead* jumps
  around lists, while every command shortcut is `Ctrl`-prefixed so the two
  never collide. Shortcuts are fully rebindable.
- **Lossless editing.** The vCard parser preserves properties it doesn't model
  (`PHOTO`, `X-*`, …) verbatim, so editing a contact never silently drops data
  another client wrote.
- **Adaptive sync.** The collection you're looking at syncs frequently; the
  rest sync lazily. Cold starts read from a local disk snapshot so the window
  is populated instantly.

## Design goals

1. **Faithful** to the underlying iCalendar/vCard data — round-trip what it
   can't model.
2. **Fast to open** — snapshot-backed cold start, optimistic writes.
3. **Quiet** — a dark-first monochrome theme with a single user-pickable
   accent, and no chrome you didn't ask for.
4. **Small** — a native Tauri shell (~10 MB), not a bundled browser.

## Status

Actively developed as a hobby project. It is **not affiliated with** EteSync
or Etebase. The day-to-day backlog and known issues live in
[`TODO.md`](https://github.com/a-asen/ete-sthetic/blob/main/TODO.md); deeper
design notes live in the [Reference › Design notes](/reference/faq) section.

Next: [Install & run →](/guide/getting-started)
