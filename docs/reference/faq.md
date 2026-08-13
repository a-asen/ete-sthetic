# FAQ

### Is this an official EteSync client?

No. ete-sthetic is an independent hobby project and is **not affiliated with**
EteSync or Etebase. It uses the official
[`etebase`](https://www.npmjs.com/package/etebase) JS SDK to talk to the
server.

### Does it work with a self-hosted Etebase server?

Yes — set your server URL on the login screen. Anything the Etebase SDK can
reach will work.

### Where is my password stored?

Nowhere. Keys are derived locally at login and only the resulting **session**
is persisted, **encrypted on disk** via the Tauri store plugin. Logging out
clears it. See [Sync model › Session & encryption](/guide/sync#session-encryption).

### Why did editing a contact *not* lose the fields it doesn't show?

The vCard parser round-trips properties it doesn't model (`PHOTO`, `X-*`, …)
verbatim. See [Contacts › Lossless vCard handling](/guide/contacts#lossless-vcard-handling).

### A task shows up in the wrong place / is flagged as a duplicate.

Two items in the same list share a VTODO `UID`. Parent links reference UIDs,
so nesting can only resolve to one of them; the rest are a best-effort guess
and are flagged so you can fix them. See
[Tasks › Reparenting](/guide/tasks#reparenting).

### A task's details look broken and I can only edit raw text.

Its source iCalendar couldn't be parsed, so ete-sthetic preserved the original
and opened the [raw iCal editor](/guide/tasks#raw-ical-editor) instead of
guessing.

### Completing a recurring task didn't create a new row — is that a bug?

No. Recurring tasks **regenerate on complete** — the due/start date rolls
forward to the next occurrence instead of spawning a separate row. See
[Tasks › Recurring tasks](/guide/tasks#recurring-tasks).

### `tauri dev` fails on Linux with an inotify / file-watcher error.

Raise the watcher limit:
`sudo sysctl fs.inotify.max_user_instances=512`. See
[Install & run](/guide/getting-started#run-in-development).

### How do I change a keyboard shortcut?

Command shortcuts are rebindable in the
[keybinding editor](/guide/settings#keybindings). See the
[keybindings reference](/reference/keybindings).

---

## Design notes

Deeper design write-ups (not user documentation) are checked into the repo and
also published on this site:

- [Calendar + contacts plan](/calendar-contacts-plan)
- [Calendar roadmap](/calendar-roadmap)
- [Task item options](/task-item-options)

The live backlog lives in
[`TODO.md`](https://github.com/a-asen/ete-sthetic/blob/main/TODO.md).
