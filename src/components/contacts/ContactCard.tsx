import { useEffect, useState } from 'react'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { VCard, VCardAddress } from '../../types'
import { buildSocialUrl, openExternal } from '../../services/social'
import { serializeVCard } from '../../services/vcard'
import { ContextMenu } from '../ContextMenu'

// The vCard text to export / inspect: the verbatim stored bytes when we
// have them (round-trips untouched, unmodelled props included), else a
// fresh serialisation as a fallback for a card that somehow lacks `raw`.
function rawVCardText(card: VCard): string {
  return card.raw?.trim() ? card.raw : serializeVCard(card)
}

// Filesystem-safe stem for the downloaded file, derived from the name.
function vcfFileStem(card: VCard): string {
  const base = (card.fn || 'contact').trim().replace(/[^\w.-]+/g, '_')
  return base.replace(/^_+|_+$/g, '').slice(0, 80) || 'contact'
}

// A value that opens in the browser when clicked. Plain text otherwise —
// matching the card's no-anchor rule (anchors would navigate the webview).
function LinkOrText({ text, url }: { text: string; url: string | null }) {
  if (!url) return <span className="select-text break-all text-text">{text}</span>
  return (
    <button
      type="button"
      onClick={() => void openExternal(url)}
      title={url}
      className="break-all text-left text-accent hover:underline"
    >
      {text} ↗
    </button>
  )
}

// Best-effort URL for a website field: accept a bare host and assume https.
function webUrl(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

// Normalise a vCard BDAY value for display. Accepts the common shapes the
// parser preserves verbatim: vCard 3.0 `YYYY-MM-DD`, vCard 4.0 `YYYYMMDD`,
// and the year-omitted `--MM-DD` / `--MMDD` partial form. Returns the raw
// value untouched if it doesn't match (e.g. a free-form `circa 1990`).
function formatBirthday(raw: string): string {
  const s = raw.trim()
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^--(\d{2})-?(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}`
  return s
}

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
  const primary = card.photos?.[0]
  if (primary && !failed) {
    return (
      <img
        src={primary}
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

// OpenStreetMap search URL for an address. Falls back to null when the
// address has no usable text (so we render it as plain text instead of a
// dead link). The query is the address on one line — OSM's Nominatim
// search resolves it to a pin.
function osmUrl(a: VCardAddress): string | null {
  const query = formatAddress(a).replace(/\n/g, ', ').trim()
  if (!query) return null
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`
}

// Embeddable OSM map (with a marker) for a known lat/lon. The bbox is a
// small box around the point so the marker sits roughly centred at a
// street-level zoom.
function osmEmbedUrl(lat: number, lon: number): string {
  const d = 0.005
  const bbox = [lon - d, lat - d, lon + d, lat + d].join('%2C')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`
}

// Full-map OSM link for a known lat/lon — opens the location with a pin.
function osmGeoUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
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
  // Resolve a RELATED value to another contact's itemUid (or null). Lets
  // related people render as links to their card.
  resolveRelated?: (value: string) => string | null
  onOpenContact?: (itemUid: string) => void
}

// Copy to clipboard with a graceful fallback — navigator.clipboard isn't
// always available in the Tauri webview, so fall back to a hidden textarea
// + execCommand. Best-effort: errors are swallowed.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// Small inline "copy this value" button. Shows a brief ✓ on success.
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  if (!value.trim()) return null
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        if (await copyToClipboard(value)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }
      }}
      title="Copy"
      aria-label={`Copy ${value}`}
      className="shrink-0 rounded p-0.5 text-text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

// Read-only raw-vCard inspector. Shows the verbatim source in a mono
// textarea with copy-to-clipboard; closes on Esc / backdrop click.
// Mirrors the calendar/paste modal pattern (no shared Modal primitive).
function RawVCardModal({
  title,
  text,
  onClose,
}: {
  title: string
  text: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Raw vCard for ${title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
            Raw vCard · {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-text-faint transition-colors hover:text-text"
          >
            ✕
          </button>
        </div>
        <textarea
          value={text}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-surface-2 p-2 font-mono text-[11px] leading-snug text-text outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={async () => {
              if (await copyToClipboard(text)) {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }
            }}
            className="h-7 rounded-md border border-border px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// Read-only contact card. Field values are plain selectable text (no
// anchor navigation — that would steer the Tauri webview away from the
// app); the user can select and copy them.
export function ContactCard({
  card,
  pending,
  onEdit,
  onDelete,
  resolveRelated,
  onOpenContact,
}: Props) {
  const hasName =
    !!card.name.given || !!card.name.family || !!card.name.additional
  const [rawOpen, setRawOpen] = useState(false)
  // Transient download feedback: '' idle, 'ok' saved, 'err' failed.
  const [dl, setDl] = useState<'' | 'ok' | 'err'>('')
  // Right-click actions menu for the detail pane.
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)

  async function downloadVcf() {
    setDl('')
    try {
      const path = await saveDialog({
        defaultPath: `${vcfFileStem(card)}.vcf`,
        filters: [{ name: 'vCard', extensions: ['vcf'] }],
      })
      if (!path) return // user cancelled
      await writeTextFile(path, rawVCardText(card))
      setDl('ok')
      setTimeout(() => setDl(''), 1500)
    } catch {
      setDl('err')
      setTimeout(() => setDl(''), 2500)
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      onContextMenu={(e) => {
        e.preventDefault()
        setCtx({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        {/* Actions on the left — nearest the contact list you came from, so
            Edit/Delete are a short hop from the cursor. */}
        <div className="flex shrink-0 items-center gap-2">
          {pending && (
            <span className="text-[10px] text-text-faint">saving…</span>
          )}
          {dl === 'err' && (
            <span className="text-[10px] text-danger">save failed</span>
          )}
          <button
            type="button"
            onClick={() => void downloadVcf()}
            title="Download as .vcf"
            aria-label="Download contact as vCard"
            className={`flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-border-strong hover:text-text ${
              dl === 'ok' ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {dl === 'ok' ? (
              '✓'
            ) : (
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M8 2v8M5 7l3 3 3-3M3 13h10" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => setRawOpen(true)}
            title="View the raw vCard"
            className="h-7 rounded-md border border-border px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Raw
          </button>
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
        {/* Name + a larger avatar, grouped on the right. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <div className="min-w-0 text-right">
            <h2 className="truncate text-lg font-semibold text-text">
              {card.fn || '(no name)'}
              {card.nickname && (
                <span className="ml-2 text-sm font-normal text-text-muted">
                  “{card.nickname}”
                </span>
              )}
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
          <Avatar card={card} size={72} />
        </div>
      </div>
      {rawOpen && (
        <RawVCardModal
          title={card.fn || '(no name)'}
          text={rawVCardText(card)}
          onClose={() => setRawOpen(false)}
        />
      )}
      {ctx && (
        <ContextMenu
          menu={{
            x: ctx.x,
            y: ctx.y,
            items: [
              { label: 'Edit', onSelect: onEdit },
              { label: 'Download .vcf', onSelect: () => void downloadVcf() },
              { label: 'View raw vCard', onSelect: () => setRawOpen(true) },
              { label: 'Delete', danger: true, onSelect: onDelete },
            ],
          }}
          onClose={() => setCtx(null)}
        />
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        {card.emails.length > 0 && (
          <section>
            <p className={labelClass}>Email</p>
            <ul className="mt-1 space-y-1">
              {card.emails.map((e, i) => (
                <li key={i} className="group flex items-center gap-2">
                  <span className="select-text break-all text-text">
                    {e.value}
                  </span>
                  <TypeBadge type={e.type} />
                  <CopyButton value={e.value} />
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
                <li key={i} className="group flex items-center gap-2">
                  <span className="select-text text-text">{p.value}</span>
                  <TypeBadge type={p.type} />
                  <CopyButton value={p.value} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.addresses.length > 0 && (
          <section>
            <p className={labelClass}>Address</p>
            <ul className="mt-1 space-y-2">
              {card.addresses.map((a, i) => {
                const map = osmUrl(a)
                return (
                  <li key={i} className="group flex items-start gap-2">
                    {map ? (
                      <button
                        type="button"
                        onClick={() => void openExternal(map)}
                        title="Open in OpenStreetMap"
                        className="select-text whitespace-pre-line text-left text-text hover:text-accent hover:underline"
                      >
                        {formatAddress(a)} ↗
                      </button>
                    ) : (
                      <span className="select-text whitespace-pre-line text-text">
                        (empty)
                      </span>
                    )}
                    <TypeBadge type={a.type} />
                    <CopyButton value={formatAddress(a).replace(/\n/g, ', ')} />
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {card.geo && (
          <section>
            <p className={labelClass}>Location</p>
            <div className="mt-1 overflow-hidden rounded-md border border-border">
              <iframe
                title="Map preview"
                src={osmEmbedUrl(card.geo.lat, card.geo.lon)}
                loading="lazy"
                className="block h-40 w-full border-0"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                card.geo &&
                void openExternal(osmGeoUrl(card.geo.lat, card.geo.lon))
              }
              title="Open in OpenStreetMap"
              className="mt-1 text-xs text-accent hover:underline"
            >
              View larger map ↗
            </button>
          </section>
        )}

        {card.urls.length > 0 && (
          <section>
            <p className={labelClass}>Website</p>
            <ul className="mt-1 space-y-1">
              {card.urls.map((u, i) => (
                <li key={i} className="group flex items-center gap-2">
                  <LinkOrText text={u.value} url={webUrl(u.value)} />
                  <TypeBadge type={u.type} />
                  <CopyButton value={u.value} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.messaging.length > 0 && (
          <section>
            <p className={labelClass}>Messaging</p>
            <ul className="mt-1 space-y-1">
              {card.messaging.map((m, i) => (
                <li key={i} className="group flex items-center gap-2">
                  <LinkOrText
                    text={m.value}
                    url={buildSocialUrl(m.type, m.value)}
                  />
                  <TypeBadge type={m.type} />
                  <CopyButton value={m.value} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {(card.birthday || card.anniversary) && (
          <section className="grid grid-cols-2 gap-3">
            {card.birthday && (
              <div>
                <p className={labelClass}>Birthday</p>
                <p className="mt-1 select-text text-text">
                  {formatBirthday(card.birthday)}
                </p>
              </div>
            )}
            {card.anniversary && (
              <div>
                <p className={labelClass}>Anniversary</p>
                <p className="mt-1 select-text text-text">
                  {formatBirthday(card.anniversary)}
                </p>
              </div>
            )}
          </section>
        )}

        {card.related.length > 0 && (
          <section>
            <p className={labelClass}>Related</p>
            <ul className="mt-1 space-y-1">
              {card.related.map((r, i) => {
                const targetUid = resolveRelated?.(r.value) ?? null
                return (
                  <li key={i} className="group flex items-center gap-2">
                    {targetUid && onOpenContact ? (
                      <button
                        type="button"
                        onClick={() => onOpenContact(targetUid)}
                        title={`Open ${r.value}`}
                        className="break-all text-left text-accent hover:underline"
                      >
                        {r.value} →
                      </button>
                    ) : (
                      <span className="select-text break-all text-text">
                        {r.value}
                      </span>
                    )}
                    <TypeBadge type={r.type} />
                    <CopyButton value={r.value} />
                  </li>
                )
              })}
            </ul>
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
