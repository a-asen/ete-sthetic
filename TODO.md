# TODO

Roadmap / backlog for ete-stethic. Newest asks at the top of each section.
See also: [`docs/task-item-options.md`](docs/task-item-options.md) (VTODO field
coverage worksheet) and [`docs/calendar-contacts-plan.md`](docs/calendar-contacts-plan.md)
(unified-client plan).

## Task lists (collections)

- [ ] **Create task lists from inside the app.**
  - Etebase SDK supports this directly: `collectionManager.create('etebase.vtodo', meta, content)`
    then `collectionManager.upload(collection)`. `meta` is `{ name, description?, color?, mtime }`,
    `content` can be an empty string for a tasks collection.
  - New `createCollection(name, opts?)` in `src/services/etebase.ts`; refresh
    the sidebar list afterward and select the new list.
  - UI: a "+" affordance in the sidebar header, keyboard-first (matches the
    existing `n`/`m` style). Reuse the inline-rename input pattern below.
- [ ] **Rename a task list.**
  - `col = await getCollection(uid); col.setMeta({ ...col.getMeta(), name, mtime: Date.now() });
    await cm.upload(col)`. The `collectionHandles` cache already holds the
    handle; invalidate/refresh after upload.
  - Inline-edit the collection name in the sidebar (double-click or a
    keybinding on the focused list).
- [ ] Stretch, same plumbing: recolor a list, edit description, delete a list
      (we already render `isDeleted` tombstones — wire the inverse), reorder lists.

## Task items

- [ ] Fill in and act on [`docs/task-item-options.md`](docs/task-item-options.md) —
      decide which currently-unsupported VTODO fields are worth adding
      (start date, recurrence, alarms, time-of-day due, etc.).

## Bigger features (tracked elsewhere)

- [ ] Unified EteSync client (calendar + contacts) — see
      [`docs/calendar-contacts-plan.md`](docs/calendar-contacts-plan.md).
- [ ] Tree-UX backlog (cascading completed-fade, per-branch reveal of completed
      subtasks, custom manual sort order) — design intent already captured;
      pick up when prioritized.
