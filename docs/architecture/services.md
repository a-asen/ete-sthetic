# Services layer

Everything that isn't a React component lives in `src/services/`. This is
where the real logic sits: the network, the caches, the parsers, and the
cross-cutting utilities. Components read from the stores and dispatch through
these — they never touch the network directly.

## Sync & storage

| Service | Responsibility |
| ------- | -------------- |
| **`etebase.ts`** {#etebase} | The only network module. Wraps the Etebase SDK: login / restore, `ensureAccount`, list collections, `getItemManager` / `getItem`, and per-type CRUD (e.g. `listContactItems`). |
| **`store.ts`** | Encrypted session persistence via the Tauri store plugin. |
| **`backgroundSync.ts`** | The adaptive scheduler — active collection fast, others slow, delta-on-open-if-stale. |
| **`syncStatus.ts`** | Observable sync state feeding the `SyncStatusPill`. |
| **`snapshots.ts`** | Cold-start disk cache (tasks). |
| **`taskstore.ts`** | Warm in-memory task cache. |
| **`calstore.ts`** / **`calsnapshot.ts`** | Calendar warm + cold caches. |
| **`contactstore.ts`** / **`contactsnapshot.ts`** | Contacts warm + cold caches. |
| **`icsSubscriptions.ts`** / **`icsSubscriptionSnapshot.ts`** | Remote read-only `.ics` subscriptions and their cache. |

See [Sync model](/guide/sync) for how these layers interact.

## Parsers & serializers

| Service | Responsibility |
| ------- | -------------- |
| **`vtodo.ts`** | VTODO ⇄ `VTodo` (via `ical.js`). |
| **`vevent.ts`** | VEVENT ⇄ `VEvent` (via `ical.js`). |
| **`vcard.ts`** {#vcard} | Dependency-free vCard 3.0/4.0 parser + serializer (`parseVCard` / `serializeVCard`). Preserves unmodelled properties verbatim. |
| **`ics.ts`** / **`icsImport.ts`** | iCal text utilities and `.ics` import. |

## Domain logic

| Service | Responsibility |
| ------- | -------------- |
| **`tree.ts`** {#tree} | Builds the task tree from `PARENT`/`CHILD` reltypes; flags duplicate UIDs. |
| **`rrule.ts`** | Task recurrence — the regenerate-on-complete roll-forward. |
| **`recurrence.ts`** / **`recurrence-edit.ts`** | Event `RRULE` expansion and scope-aware (this / this-and-future / all) edits. |
| **`alarms.ts`** | `VALARM` → desktop notifications. |
| **`birthdays.ts`** | Projects contact `BDAY` values onto the calendar. |
| **`caltasks.ts`** | Bridges tasks with due dates onto the calendar grid. |
| **`weather.ts`** | Experimental weather layer for the calendar. |
| **`caldate.ts`** | Date-grid helpers shared across calendar views (`startOfDay`, `dayKey`, …). |
| **`sort.ts`** | Task/contact sort comparators. |
| **`social.ts`** | Known social/messaging services + custom-service registration. |
| **`metasearch.ts`** | Cross-module search index (tasks + events + contacts). |

## Preferences & UI state

| Service | Responsibility |
| ------- | -------------- |
| **`prefs.ts`** | Generic local preference persistence. |
| **`theme.ts`** | Theme + accent colour. |
| **`moduleFlags.ts`** | Which modules (tasks/calendar/contacts) are enabled. |
| **`keybindings.ts`** | The rebindable action registry + defaults. |
| **`taskRowSettings.ts`** | What each task row displays. |
| **`inactiveOpacity.ts`** | Inactive-zone fade settings. |
| **`settingsSections.ts`** | Declarative settings-window section registry. |
| **`hints.ts`** | Contextual hint/tip state. |

::: tip Keeping this accurate
This project ships a [graphify](https://github.com/) knowledge graph under
`graphify-out/`. For questions about how a service connects to the rest of the
code, `graphify query "<question>"` returns a scoped subgraph — often faster
than reading files. Run `graphify update .` after changing code.
:::
