# Settings

Settings live in a dedicated **settings window** (`SettingsWindow`) with a
left-hand nav (`SettingsNav`) and grouped sections (`SettingsSection`,
`GlobalSettings`). Several modules also have their own quick popovers for
context-specific options. Preferences persist locally via
[`services/prefs.ts`](/architecture/services).

## Appearance

- **Theme & accent** — a dark-first monochrome theme with a single
  user-pickable accent colour ([`services/theme.ts`](/architecture/services)).
- **Inactive-zone fade** — panes you aren't focused on can dim to keep your
  attention on the active zone (`InactiveOpacitySettings`,
  `services/inactiveOpacity.ts`).
- **Per-zone zoom** — each pane remembers its own zoom, adjusted with
  `Ctrl/Cmd` `+` / `-` / `0`.

## Modules

**Module toggles** (`ModuleToggles`, `services/moduleFlags.ts`) turn the
Tasks, Calendar, and Contacts modules on or off. Disabled modules drop out of
the bottom-left module switcher. The **home view** (`HomeView`) is the landing
surface when no specific module is active.

## Task row display

**Task row settings** (`services/taskRowSettings.ts`) control how much each
task row shows — which fields and badges appear inline in the tree. Module
popovers such as `SortPopover`, `FilterPopover`, `SettingsPopover`, and
`SidebarSettingsPopover` expose the tasks-specific options.

## Calendar & contacts options

- **Calendar** — `CalendarSettingsPopover` covers calendar-view preferences
  (default view, visible calendars, overlays).
- **Contacts** — `ContactsSettingsPopover` covers address-book display
  options.

## Keybindings

The **keybinding editor** (`KeybindingEditor`, backed by
[`services/keybindings.ts`](/architecture/services)) lets you rebind the
Ctrl-prefixed command actions. The **keybindings modal** (`KeybindingsModal`)
is a quick cheat-sheet of what's currently bound. See the full
[keybindings reference](/reference/keybindings).

## Where settings are stored

All preferences are stored locally through the Tauri store plugin — nothing
about your configuration is synced to the EteSync server.
