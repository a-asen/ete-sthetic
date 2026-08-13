import { useEffect, useRef, useState } from 'react'
import type { VCard, VCardAddress, VCardField } from '../../types'
import { ConfirmModal } from '../ConfirmModal'
import { PhotoCropModal } from './PhotoCropModal'
import { addCustomService, allServices } from '../../services/social'
import { registerUnsavedGuard } from '../../services/unsavedGuard'

const fieldClass =
  'w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-wider text-text-faint'

const EMAIL_TYPES = ['', 'home', 'work', 'other']
const PHONE_TYPES = ['', 'cell', 'home', 'work', 'fax', 'other']
const URL_TYPES = ['', 'home', 'work', 'other']
const ADDR_TYPES = ['', 'home', 'work', 'other']
// RFC 6350 §6.6.6 relationship types. We keep the high-frequency
// ones near the top; an unrecognised TYPE from a third-party card is
// preserved by TypeSelect's unrecognised-value handling.
const RELATED_TYPES = [
  '',
  'spouse',
  'parent',
  'child',
  'sibling',
  'friend',
  'colleague',
  'co-worker',
  'kin',
  'neighbor',
  'agent',
  'emergency',
  'other',
]
function cloneCard(c: VCard): VCard {
  return {
    ...c,
    name: { ...c.name },
    emails: c.emails.map((e) => ({ ...e })),
    phones: c.phones.map((p) => ({ ...p })),
    urls: c.urls.map((u) => ({ ...u })),
    messaging: c.messaging.map((m) => ({ ...m })),
    addresses: c.addresses.map((a) => ({ ...a })),
    related: c.related.map((r) => ({ ...r })),
    categories: [...c.categories],
    photos: [...(c.photos ?? [])],
  }
}

function emptyAddress(): VCardAddress {
  return {
    type: '',
    pobox: '',
    ext: '',
    street: '',
    locality: '',
    region: '',
    postal: '',
    country: '',
  }
}

// A <select> of common type tokens that also keeps an unrecognised value
// (a custom TYPE from the source card) selectable so an edit can't drop it.
function TypeSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const opts = options.includes(value) ? options : [...options, value]
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-1.5 text-xs text-text-muted outline-none focus:border-border-strong"
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o || '—'}
        </option>
      ))}
    </select>
  )
}

function FieldListEditor({
  label,
  fields,
  types,
  inputType,
  placeholder,
  onChange,
}: {
  label: string
  fields: VCardField[]
  types: string[]
  inputType: string
  placeholder: string
  onChange: (next: VCardField[]) => void
}) {
  const update = (i: number, patch: Partial<VCardField>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="mt-1 space-y-1.5">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <TypeSelect
              value={f.type}
              options={types}
              onChange={(t) => update(i, { type: t })}
            />
            <input
              type={inputType}
              value={f.value}
              placeholder={placeholder}
              onChange={(e) => update(i, { value: e.target.value })}
              className={`${fieldClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
              aria-label={`Remove ${label}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...fields, { value: '', type: '' }])}
          className="text-xs text-accent transition-opacity hover:opacity-80"
        >
          + Add {label.toLowerCase()}
        </button>
      </div>
    </div>
  )
}

function AddressListEditor({
  addresses,
  onChange,
}: {
  addresses: VCardAddress[]
  onChange: (next: VCardAddress[]) => void
}) {
  const update = (i: number, patch: Partial<VCardAddress>) => {
    onChange(addresses.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  return (
    <div>
      <label className={labelClass}>Addresses</label>
      <div className="mt-1 space-y-3">
        {addresses.map((a, i) => (
          <div
            key={i}
            className="space-y-1.5 rounded-md border border-border bg-surface-2/40 p-2"
          >
            <div className="flex items-center gap-1.5">
              <TypeSelect
                value={a.type}
                options={ADDR_TYPES}
                onChange={(t) => update(i, { type: t })}
              />
              <input
                value={a.street}
                placeholder="Street"
                onChange={(e) => update(i, { street: e.target.value })}
                className={`${fieldClass} flex-1`}
              />
              <button
                type="button"
                onClick={() =>
                  onChange(addresses.filter((_, idx) => idx !== i))
                }
                aria-label="Remove address"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={a.locality}
                placeholder="City"
                onChange={(e) => update(i, { locality: e.target.value })}
                className={fieldClass}
              />
              <input
                value={a.region}
                placeholder="Region / State"
                onChange={(e) => update(i, { region: e.target.value })}
                className={fieldClass}
              />
              <input
                value={a.postal}
                placeholder="Postal code"
                onChange={(e) => update(i, { postal: e.target.value })}
                className={fieldClass}
              />
              <input
                value={a.country}
                placeholder="Country"
                onChange={(e) => update(i, { country: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...addresses, emptyAddress()])}
          className="text-xs text-accent transition-opacity hover:opacity-80"
        >
          + Add address
        </button>
      </div>
    </div>
  )
}

interface Props {
  initial: VCard
  isNew: boolean
  saving: boolean
  onSave: (card: VCard) => void
  onCancel: () => void
  // Tags already in use across the address book, for the tag editor's
  // suggestions so the same tag is reused (and spelled) consistently —
  // these double as the calendar's birthday-visibility groups.
  knownCategories?: string[]
}

// Full create / edit form for a contact. Holds its own draft (seeded once
// per mount — the parent re-keys it per contact). Unmodelled vCard
// properties ride along inside `draft` untouched and are preserved by
// serializeVCard on save.
export function ContactEditor({
  initial,
  isNew,
  saving,
  onSave,
  onCancel,
  knownCategories = [],
}: Props) {
  const [draft, setDraft] = useState<VCard>(() => cloneCard(initial))
  // Messaging-service options (seeded + user-defined). Held in state so a
  // newly-added custom service shows up in the type dropdown immediately.
  const [serviceIds, setServiceIds] = useState<string[]>(() => [
    '',
    ...allServices().map((s) => s.id),
  ])
  // Photo editor state — the data URL the user picked, held until the
  // crop modal commits or cancels. Null = modal closed.
  const [pendingPhotoSrc, setPendingPhotoSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Discard-confirm guard. `initialJson` is the draft serialized at mount;
  // diffing the live draft against it tells us whether the user changed
  // anything (cloneCard on both sides keeps key order identical).
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [initialJson] = useState(() => JSON.stringify(cloneCard(initial)))
  // Prefix / middle / suffix are tucked behind a reveal (most contacts only
  // need given + family), but auto-shown when the card already has any.
  const [nameExtras, setNameExtras] = useState(
    () =>
      !!(
        initial.name.additional ||
        initial.name.prefixes ||
        initial.name.suffixes
      ),
  )

  const set = <K extends keyof VCard>(key: K, value: VCard[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const setName = (patch: Partial<VCard['name']>) => {
    setDraft((d) => ({ ...d, name: { ...d.name, ...patch } }))
  }
  // Photo list edits (functional updates so quick successive clicks don't
  // race on a stale draft). First entry = the primary/avatar.
  const addPhoto = (dataUrl: string) =>
    setDraft((d) => ({ ...d, photos: [...d.photos, dataUrl] }))
  const removePhoto = (index: number) =>
    setDraft((d) => ({
      ...d,
      photos: d.photos.filter((_, i) => i !== index),
    }))
  const makePrimaryPhoto = (index: number) =>
    setDraft((d) => {
      if (index <= 0 || index >= d.photos.length) return d
      const photos = [...d.photos]
      const [pick] = photos.splice(index, 1)
      photos.unshift(pick)
      return { ...d, photos }
    })

  function handleSave() {
    const categories = draft.categories
      .map((c) => c.trim())
      .filter(Boolean)
    let fn = draft.fn.trim()
    if (!fn) {
      fn =
        [draft.name.given, draft.name.family].filter(Boolean).join(' ').trim() ||
        draft.emails.find((e) => e.value)?.value ||
        'Unnamed contact'
    }
    onSave({
      ...draft,
      fn,
      nickname: draft.nickname.trim(),
      org: draft.org.trim(),
      title: draft.title.trim(),
      birthday: draft.birthday.trim(),
      anniversary: draft.anniversary.trim(),
      emails: draft.emails.filter((e) => e.value.trim()),
      phones: draft.phones.filter((p) => p.value.trim()),
      urls: draft.urls.filter((u) => u.value.trim()),
      messaging: draft.messaging.filter((m) => m.value.trim()),
      related: draft.related.filter((r) => r.value.trim()),
      categories,
    })
  }

  // Exit (Cancel button / Esc): warn before throwing away real edits,
  // otherwise just leave. Mirrors the calendar event composer's guard.
  const requestCancel = () => {
    if (JSON.stringify(draft) !== initialJson) setConfirmCancel(true)
    else onCancel()
  }

  // Latest handleSave / requestCancel, so the keyboard listener fires the
  // current draft without re-subscribing on every keystroke.
  const saveRef = useRef(handleSave)
  const cancelRef = useRef(requestCancel)
  const guardRef = useRef({
    isDirty: () => false,
    save: (): boolean => true,
    discard: () => {},
  })
  useEffect(() => {
    saveRef.current = handleSave
    cancelRef.current = requestCancel
    guardRef.current = {
      isDirty: () => JSON.stringify(draft) !== initialJson,
      save: () => {
        handleSave()
        return true
      },
      discard: onCancel,
    }
  })
  // Register as the active unsaved-changes guard so switching modules prompts
  // to save/discard this in-progress contact instead of dropping it.
  useEffect(() => {
    return registerUnsavedGuard({
      kind: 'contact',
      isDirty: () => guardRef.current.isDirty(),
      save: () => guardRef.current.save(),
      discard: () => guardRef.current.discard(),
    })
  }, [])
  // Ctrl/Cmd+Enter saves; Esc exits (warning first if there are unsaved
  // changes). Both stand down while a sub-dialog — the discard confirm or
  // the photo-crop modal — is up, since that owns the keyboard then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmCancel || pendingPhotoSrc) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (saving) return
        e.preventDefault()
        saveRef.current()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, pendingPhotoSrc, confirmCancel])

  return (
    <>
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-text">
          {isNew ? 'New contact' : 'Edit contact'}
        </h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <PhotoField
          photos={draft.photos}
          onPick={() => fileInputRef.current?.click()}
          onRemove={removePhoto}
          onMakePrimary={makePrimaryPhoto}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result
              if (typeof result === 'string') setPendingPhotoSrc(result)
            }
            reader.readAsDataURL(file)
            // Reset so picking the same file twice re-fires `onChange`.
            e.target.value = ''
          }}
        />
        {pendingPhotoSrc && (
          <PhotoCropModal
            imageUrl={pendingPhotoSrc}
            onCancel={() => setPendingPhotoSrc(null)}
            onConfirm={(dataUrl) => {
              addPhoto(dataUrl)
              setPendingPhotoSrc(null)
            }}
          />
        )}

        <div>
          <label className={labelClass}>Display name</label>
          <input
            value={draft.fn}
            autoFocus
            placeholder="Shown in the list; left blank, derived from the name"
            onChange={(e) => set('fn', e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Given name</label>
            <input
              value={draft.name.given}
              onChange={(e) => setName({ given: e.target.value })}
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass}>Family name</label>
            <input
              value={draft.name.family}
              onChange={(e) => setName({ family: e.target.value })}
              className={`${fieldClass} mt-1`}
            />
          </div>
        </div>

        {nameExtras ? (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelClass}>Prefix</label>
              <input
                value={draft.name.prefixes}
                placeholder="Dr., Ms.…"
                onChange={(e) => setName({ prefixes: e.target.value })}
                className={`${fieldClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass}>Middle name</label>
              <input
                value={draft.name.additional}
                onChange={(e) => setName({ additional: e.target.value })}
                className={`${fieldClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass}>Suffix</label>
              <input
                value={draft.name.suffixes}
                placeholder="Jr., PhD…"
                onChange={(e) => setName({ suffixes: e.target.value })}
                className={`${fieldClass} mt-1`}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNameExtras(true)}
            className="text-xs text-accent transition-opacity hover:opacity-80"
          >
            + Prefix, middle name, suffix
          </button>
        )}

        <div>
          <label className={labelClass}>Nickname</label>
          <input
            value={draft.nickname}
            placeholder="Optional"
            onChange={(e) => set('nickname', e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Organization</label>
            <input
              value={draft.org}
              onChange={(e) => set('org', e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass}>Title</label>
            <input
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </div>
        </div>

        <FieldListEditor
          label="Email"
          fields={draft.emails}
          types={EMAIL_TYPES}
          inputType="email"
          placeholder="name@example.com"
          onChange={(v) => set('emails', v)}
        />
        <FieldListEditor
          label="Phone"
          fields={draft.phones}
          types={PHONE_TYPES}
          inputType="tel"
          placeholder="+1 555 0100"
          onChange={(v) => set('phones', v)}
        />
        <FieldListEditor
          label="Website"
          fields={draft.urls}
          types={URL_TYPES}
          inputType="url"
          placeholder="https://example.com"
          onChange={(v) => set('urls', v)}
        />
        <div>
          <FieldListEditor
            label="Messaging & social"
            fields={draft.messaging}
            types={serviceIds}
            inputType="text"
            placeholder="@handle / username / full profile URL"
            onChange={(v) => set('messaging', v)}
          />
          <CustomServiceAdder
            onAdd={(label, template) => {
              const id = addCustomService(label, template)
              if (!id) return
              setServiceIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
              // Drop in a row for the new service immediately, so "Add
              // custom service" has a visible result the user can type into
              // — instead of the form silently closing with nothing added
              // (it used to only register the service type).
              setDraft((d) => ({
                ...d,
                messaging: [...d.messaging, { value: '', type: id }],
              }))
            }}
          />
          <p className="mt-1 text-[11px] text-text-faint">
            Pick a service and enter the username — known services become
            clickable links. For others, paste the full profile URL, or add
            a custom service with its own link template.
          </p>
        </div>
        <AddressListEditor
          addresses={draft.addresses}
          onChange={(v) => set('addresses', v)}
        />

        {/* Date fields get their own divider-separated group so the
            Birthday field doesn't read as a stray input tacked onto the
            Addresses section above it. */}
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
          <div>
            <label className={labelClass}>Birthday</label>
            <input
              value={draft.birthday}
              placeholder="YYYY-MM-DD"
              onChange={(e) => set('birthday', e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass}>Anniversary</label>
            <input
              value={draft.anniversary}
              placeholder="YYYY-MM-DD"
              onChange={(e) => set('anniversary', e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </div>
        </div>

        <FieldListEditor
          label="Related"
          fields={draft.related}
          types={RELATED_TYPES}
          inputType="text"
          placeholder="Name (e.g. Jane Smith) or mailto:/urn:uuid:"
          onChange={(v) => set('related', v)}
        />

        <div>
          <label className={labelClass}>Note</label>
          <textarea
            spellCheck
            value={draft.note}
            rows={3}
            onChange={(e) => set('note', e.target.value)}
            className={`${fieldClass} mt-1 resize-y`}
          />
        </div>

        <TagInput
          value={draft.categories}
          onChange={(next) => set('categories', next)}
          suggestions={knownCategories}
        />
      </div>

      {/* Save (primary) on the left — nearest the cursor / the fields you
          were just in; Cancel sits beside it. Mirrors the read-only card's
          left-aligned actions. */}
      <div className="flex items-center justify-start gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={requestCancel}
          disabled={saving}
          className="h-8 rounded-md border border-border px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
    {confirmCancel && (
      <ConfirmModal
        title={isNew ? 'Discard this contact?' : 'Discard your changes?'}
        body="You have unsaved changes. Close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    )}
    </>
  )
}

// Chip-based tag editor for a contact's CATEGORIES. Replaces the old
// comma-separated text box: tags show as removable chips, Enter / comma
// commits the typed tag, Backspace on an empty input deletes the last,
// and matching tags already used elsewhere are offered as one-click
// suggestions so the same tag (and spelling) is reused. These tags drive
// the calendar's birthday-visibility grouping.
function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
}) {
  const [input, setInput] = useState('')
  const has = (t: string) =>
    value.some((v) => v.toLowerCase() === t.toLowerCase())
  const add = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    if (!has(t)) onChange([...value, t])
    setInput('')
  }
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const q = input.trim().toLowerCase()
  const filtered = suggestions
    .filter((s) => !has(s) && (!q || s.toLowerCase().includes(q)))
    .slice(0, 10)
  return (
    <div>
      <label className={labelClass}>Tags</label>
      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface-2 p-1.5 focus-within:border-border-strong">
        {value.map((tag, i) => (
          <span
            key={i}
            className="flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove tag ${tag}`}
              className="leading-none text-accent/70 hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(input)
            } else if (e.key === 'Backspace' && !input && value.length) {
              e.preventDefault()
              removeAt(value.length - 1)
            }
          }}
          placeholder={value.length ? 'Add tag…' : 'Add tags (Enter to add)'}
          className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-sm text-text outline-none placeholder:text-text-faint"
        />
      </div>
      {filtered.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-text-faint">
        Used for grouping and birthday visibility in the calendar.
      </p>
    </div>
  )
}

// Inline "add a custom messaging service" affordance: a name plus an
// optional URL template containing {handle}. Saved to the local service
// registry so the new service appears in the type dropdown and its
// entries become clickable links.
function CustomServiceAdder({
  onAdd,
}: {
  onAdd: (label: string, template: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-xs text-accent transition-opacity hover:opacity-80"
      >
        + Add custom service
      </button>
    )
  }
  const commit = () => {
    if (!name.trim()) return
    onAdd(name.trim(), template.trim())
    setName('')
    setTemplate('')
    setOpen(false)
  }
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-surface-2/50 p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Service name (e.g. Mastodon)"
        className={fieldClass}
      />
      <input
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        placeholder="Link template, optional — https://example.com/{handle}"
        className={fieldClass}
        spellCheck={false}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setName('')
            setTemplate('')
          }}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={!name.trim()}
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// A strip of contact photos. The first is the primary (shown as the
// avatar everywhere); the user adds as many as they like, removes any, and
// clicks an alternate to promote it to primary — the quick "alternate
// between them" surface. No drag-reorder; click-to-promote keeps it simple.
function PhotoField({
  photos,
  onPick,
  onRemove,
  onMakePrimary,
}: {
  photos: string[]
  onPick: () => void
  onRemove: (index: number) => void
  onMakePrimary: (index: number) => void
}) {
  return (
    <div>
      <span className={labelClass}>Photos</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <div key={i} className="group relative h-16 w-16 shrink-0">
            <img
              src={p}
              alt={i === 0 ? 'Primary contact photo' : `Contact photo ${i + 1}`}
              draggable={false}
              onClick={() => onMakePrimary(i)}
              title={i === 0 ? 'Primary photo' : 'Click to make primary'}
              className={`h-16 w-16 rounded-full border object-cover transition-colors ${
                i === 0
                  ? 'border-accent ring-2 ring-accent/40'
                  : 'cursor-pointer border-border hover:border-border-strong'
              }`}
            />
            {i === 0 && (
              <span className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1.5 py-px text-[9px] font-medium text-bg">
                Primary
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="Remove photo"
              title="Remove"
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-[10px] leading-none text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={onPick}
          aria-label="Add photo"
          className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full border border-dashed border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
        >
          <span className="text-lg leading-none">＋</span>
          <span className="text-[9px]">{photos.length ? 'Add' : 'Photo'}</span>
        </button>
      </div>
      {/* Explicit text affordance too — matches the other "+ Add …" links
          in this editor, since the dashed tile is easy to miss. */}
      <button
        type="button"
        onClick={onPick}
        className="mt-1.5 text-xs text-accent transition-opacity hover:opacity-80"
      >
        + Add {photos.length ? 'another photo' : 'photo'}
      </button>
      {photos.length > 1 && (
        <p className="mt-1 text-[10px] text-text-faint">
          Click a photo to make it the primary (used as the avatar).
        </p>
      )}
    </div>
  )
}
