# Contacts

The contacts module (`ContactsView`) is a vCard address-book client with a
lossless, hand-rolled parser and a full editor.

## Layout

- **Address books** — your vCard collections, in the sidebar.
- **Contact list** — a searchable list of contacts in the active book.
- **Contact card** (`ContactCard`) — the read view for a selected contact.
- **Contact editor** (`ContactEditor`) — the edit view.

Panes are resizable, and zoom is remembered per zone (`Ctrl/Cmd` `+` / `-` /
`0`). Use **←/→** to move between the panes — address books, contact list,
and contact card — the same horizontal navigation as the tasks module
(`Ctrl`/`Cmd`+`←`/`→` also still works). Unlike the tasks module, contacts
panes **do not fade by default** — the three columns fit on one page, so
keeping them all legible is usually better. Settings → Advanced → Inactive
zone fade still lets you dim unfocused panes if you prefer.

## Lossless vCard handling

Contacts are parsed and serialized by a dependency-free parser
([`services/vcard.ts`](/architecture/services#vcard)) that supports both
**vCard 3.0 and 4.0**. Crucially, it **preserves properties it doesn't model**
— `PHOTO`, `X-*` extensions, and anything else — **verbatim across an edit**.
Editing a contact in ete-sthetic will not silently drop data that another
client wrote.

## Editable fields

The editor models the common vCard properties:

| Field        | vCard property        |
| ------------ | --------------------- |
| Display name | `FN`                  |
| Structured name | `N`                |
| Organization | `ORG`                 |
| Title        | `TITLE`               |
| Emails       | `EMAIL` (typed)       |
| Phones       | `TEL` (typed)         |
| URLs         | `URL`                 |
| Addresses    | `ADR` (typed)         |
| Birthday     | `BDAY`                |
| Note         | `NOTE`                |
| Categories   | `CATEGORIES`          |

Typed fields (emails, phones, URLs, addresses) support multiple entries with
type labels (home, work, personal, school, old, …). Use the ▲/▼ buttons beside
an entry to reorder it; the first email/phone/URL/address is the one shown
first on the contact card.

## Selecting and moving contacts

- **Shift+click** (or **Shift+↑/↓**) selects a contiguous range from the
  current anchor.
- **`Ctrl`/`Cmd`+click** adds or removes an individual contact.
- Drag any selected contact onto an address book to move the whole
  selection. Right-clicking inside the selection offers **Move N contacts
  to …** and **Delete N contacts**.
- Plain clicks and arrow keys collapse the selection to one contact; the
  last clicked one drives the detail pane.

## Quick actions on the contact card

The read view is actionable without opening the editor:

- **Emails and phone numbers** are clickable (`mailto:` / `tel:` and the
  system handler), as are websites, addresses (OpenStreetMap), social
  handles, and related contacts.
- **Copy** buttons sit beside each value; **pencil** buttons open the editor
  for that contact directly, so you don't have to travel back to the header
  Edit button.
- From the contact list, **Enter** or **`Ctrl`/`Cmd`+`E`** opens the
  selected contact in the editor. `Ctrl`+`E` only edits when a contact is
  selected; otherwise it moves focus to the detail pane as before.

### Social / messaging services

The editor recognises common social and messaging services and lets you add
custom ones ([`services/social.ts`](/architecture/services)). Birthdays
entered here also feed the [calendar birthday overlay](/guide/calendar#overlays).

## Avatars & photos

A contact's avatar shows its embedded `PHOTO` if present, otherwise coloured
initials. The **photo crop modal** (`PhotoCropModal`) lets you crop an image
before it's stored on the contact.

## Search

- **In-book search** — the contact list filters as you type.
- **Cross-book search** (`ContactSearchModal`) — search across every address
  book at once. See [Search](/guide/search).

## Related

- [Data model › vCard](/architecture/data-model#vcard)
- [Calendar overlays](/guide/calendar#overlays) — where `BDAY` shows up
