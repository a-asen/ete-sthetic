import { useState } from 'react'
import type { VCard, VCardAddress, VCardField } from '../../types'

const fieldClass =
  'w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-wider text-text-faint'

const EMAIL_TYPES = ['', 'home', 'work', 'other']
const PHONE_TYPES = ['', 'cell', 'home', 'work', 'fax', 'other']
const URL_TYPES = ['', 'home', 'work', 'other']
const ADDR_TYPES = ['', 'home', 'work', 'other']

function cloneCard(c: VCard): VCard {
  return {
    ...c,
    name: { ...c.name },
    emails: c.emails.map((e) => ({ ...e })),
    phones: c.phones.map((p) => ({ ...p })),
    urls: c.urls.map((u) => ({ ...u })),
    addresses: c.addresses.map((a) => ({ ...a })),
    categories: [...c.categories],
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
}: Props) {
  const [draft, setDraft] = useState<VCard>(() => cloneCard(initial))
  const [categoriesText, setCategoriesText] = useState(() =>
    initial.categories.join(', '),
  )

  const set = <K extends keyof VCard>(key: K, value: VCard[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const setName = (patch: Partial<VCard['name']>) => {
    setDraft((d) => ({ ...d, name: { ...d.name, ...patch } }))
  }

  function handleSave() {
    const categories = categoriesText
      .split(',')
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
      org: draft.org.trim(),
      title: draft.title.trim(),
      birthday: draft.birthday.trim(),
      emails: draft.emails.filter((e) => e.value.trim()),
      phones: draft.phones.filter((p) => p.value.trim()),
      urls: draft.urls.filter((u) => u.value.trim()),
      categories,
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-text">
          {isNew ? 'New contact' : 'Edit contact'}
        </h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
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
        <AddressListEditor
          addresses={draft.addresses}
          onChange={(v) => set('addresses', v)}
        />

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
          <label className={labelClass}>Note</label>
          <textarea
            value={draft.note}
            rows={3}
            onChange={(e) => set('note', e.target.value)}
            className={`${fieldClass} mt-1 resize-y`}
          />
        </div>

        <div>
          <label className={labelClass}>Categories</label>
          <input
            value={categoriesText}
            placeholder="Comma-separated"
            onChange={(e) => setCategoriesText(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-md border border-border px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
