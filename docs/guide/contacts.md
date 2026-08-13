# Contacts

The contacts module (`ContactsView`) is a vCard address-book client with a
lossless, hand-rolled parser and a full editor.

## Layout

- **Address books** — your vCard collections, in the sidebar.
- **Contact list** — a searchable list of contacts in the active book.
- **Contact card** (`ContactCard`) — the read view for a selected contact.
- **Contact editor** (`ContactEditor`) — the edit view.

Panes are resizable, and zoom is remembered per zone (`Ctrl/Cmd` `+` / `-` /
`0`).

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

Typed fields (emails, phones, addresses) support multiple entries with type
labels (home, work, …).

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
