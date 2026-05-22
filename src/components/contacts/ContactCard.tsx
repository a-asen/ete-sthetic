import { useState } from 'react'
import type { VCard, VCardAddress } from '../../types'

// Initials for the avatar fallback — first letter of the first two words.
function initialsOf(fn: string): string {
  const words = fn.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// Stable pastel-ish background hue derived from the name, so the avatar
// colour is consistent per contact and the list is easy to scan.
function avatarHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360
  }
  return h
}

export function Avatar({
  card,
  size,
}: {
  card: VCard
  size: number
}) {
  const [failed, setFailed] = useState(false)
  const hue = avatarHue(card.fn || card.uid)
  if (card.photo && !failed) {
    return (
      <img
        src={card.photo}
        alt=""
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: `hsl(${hue} 45% 32%)`,
        fontSize: size * 0.4,
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      aria-hidden
    >
      {initialsOf(card.fn)}
    </div>
  )
}

function formatAddress(a: VCardAddress): string {
  const street = [a.pobox, a.ext, a.street].filter(Boolean).join(' ')
  const cityLine = [a.locality, a.region, a.postal].filter(Boolean).join(' ')
  return [street, cityLine, a.country].filter(Boolean).join('\n')
}

const labelClass =
  'text-[11px] font-semibold uppercase tracking-wider text-text-faint'

function TypeBadge({ type }: { type: string }) {
  if (!type) return null
  return (
    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-faint">
      {type}
    </span>
  )
}

interface Props {
  card: VCard
  pending: boolean
  onEdit: () => void
  onDelete: () => void
}

// Read-only contact card. Field values are plain selectable text (no
// anchor navigation — that would steer the Tauri webview away from the
// app); the user can select and copy them.
export function ContactCard({ card, pending, onEdit, onDelete }: Props) {
  const hasName =
    !!card.name.given || !!card.name.family || !!card.name.additional
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <Avatar card={card} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-text">
            {card.fn || '(no name)'}
          </h2>
          {(card.title || card.org) && (
            <p className="truncate text-sm text-text-muted">
              {[card.title, card.org].filter(Boolean).join(' · ')}
            </p>
          )}
          {hasName && (
            <p className="mt-0.5 truncate text-xs text-text-faint">
              {[
                card.name.prefixes,
                card.name.given,
                card.name.additional,
                card.name.family,
                card.name.suffixes,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pending && (
            <span className="text-[10px] text-text-faint">saving…</span>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="h-7 rounded-md border border-border px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="h-7 rounded-md border border-border px-2.5 text-xs text-danger transition-colors hover:border-danger/50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        {card.emails.length > 0 && (
          <section>
            <p className={labelClass}>Email</p>
            <ul className="mt-1 space-y-1">
              {card.emails.map((e, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="select-text break-all text-text">
                    {e.value}
                  </span>
                  <TypeBadge type={e.type} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.phones.length > 0 && (
          <section>
            <p className={labelClass}>Phone</p>
            <ul className="mt-1 space-y-1">
              {card.phones.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="select-text text-text">{p.value}</span>
                  <TypeBadge type={p.type} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.addresses.length > 0 && (
          <section>
            <p className={labelClass}>Address</p>
            <ul className="mt-1 space-y-2">
              {card.addresses.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="select-text whitespace-pre-line text-text">
                    {formatAddress(a) || '(empty)'}
                  </span>
                  <TypeBadge type={a.type} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.urls.length > 0 && (
          <section>
            <p className={labelClass}>Website</p>
            <ul className="mt-1 space-y-1">
              {card.urls.map((u, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="select-text break-all text-text">
                    {u.value}
                  </span>
                  <TypeBadge type={u.type} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.birthday && (
          <section>
            <p className={labelClass}>Birthday</p>
            <p className="mt-1 select-text text-text">{card.birthday}</p>
          </section>
        )}

        {card.note && (
          <section>
            <p className={labelClass}>Note</p>
            <p className="mt-1 select-text whitespace-pre-wrap text-text">
              {card.note}
            </p>
          </section>
        )}

        {card.categories.length > 0 && (
          <section>
            <p className={labelClass}>Categories</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {card.categories.map((c) => (
                <span
                  key={c}
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
