import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { parseVEvent } from './vevent'
import { splitIcs } from './ics'
import type { EventItem } from '../types'

// User-defined remote ICS calendars (public holiday feeds, sports
// schedules, sprint cadences, …). These live entirely outside etebase
// — read-only, fetched periodically via the Tauri http plugin (which
// bypasses browser CORS, since the request goes through Rust).
//
// Storage: localStorage JSON list. Small, self-contained, and there's
// no need to round-trip through etebase because subscriptions are a
// per-machine preference (the URL is universal but each device decides
// whether to subscribe). The fetched events live in calstore's
// in-memory cache instead of on disk — small enough not to need a
// snapshot, and a missed cache just triggers a re-fetch.

const STORAGE_KEY = 'ete-sthetic.cal.subscriptions'

export interface IcsSubscription {
  // Stable local id (UUID). Doubles as the React key + the lookup key
  // for `eventsBySub` and `hidden`.
  id: string
  url: string
  // User-given display name. Falls back to a domain-based suggestion
  // when the user leaves it blank.
  name: string
  // CSS colour (#rrggbb / named) — applied via colorFor for events
  // sourced from this subscription. Defaults to the accent variable
  // when unset.
  color: string
  // Background refresh cadence in minutes. 0 = manual only.
  refreshMinutes: number
  // Last successful fetch timestamp (ms epoch), or null when never.
  lastSyncedAt: number | null
  // Last failure message, cleared on next success. Persisted so the
  // sidebar can keep flagging the row.
  lastError: string | null
  // Cache validators from the previous successful response, used to
  // send `If-None-Match` / `If-Modified-Since` on the next fetch and
  // skip re-downloading/-parsing when the server replies 304. Optional
  // for back-compat — older subscription records simply omit them and
  // the first fetch is unconditional. Cleared on a non-304 success.
  etag?: string | null
  lastModified?: string | null
}

export const REFRESH_OPTIONS = [
  0, 15, 30, 60, 240, 720, 1440,
] as const

export function refreshLabel(min: number): string {
  if (min <= 0) return 'Manual only'
  if (min < 60) return `${min} min`
  const h = min / 60
  return h === 1 ? '1 hour' : h < 24 ? `${h} hours` : `${h / 24} day(s)`
}

export function listSubscriptions(): IcsSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: IcsSubscription[] = []
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.url !== 'string') continue
      out.push({
        id: o.id,
        url: o.url,
        name: typeof o.name === 'string' ? o.name : '',
        color: typeof o.color === 'string' ? o.color : '',
        refreshMinutes:
          typeof o.refreshMinutes === 'number' ? o.refreshMinutes : 60,
        lastSyncedAt:
          typeof o.lastSyncedAt === 'number' ? o.lastSyncedAt : null,
        lastError:
          typeof o.lastError === 'string' && o.lastError ? o.lastError : null,
        etag: typeof o.etag === 'string' && o.etag ? o.etag : null,
        lastModified:
          typeof o.lastModified === 'string' && o.lastModified
            ? o.lastModified
            : null,
      })
    }
    return out
  } catch {
    return []
  }
}

export function writeSubscriptions(subs: IcsSubscription[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs))
  } catch {
    // Persistence failure is non-fatal — the in-memory list keeps
    // working for the rest of the session.
  }
}

// Derive a reasonable display name from a URL when the user hasn't
// chosen one. Strips query/path noise and capitalises the basename.
export function suggestSubscriptionName(url: string): string {
  try {
    const u = new URL(url.replace(/^webcal:\/\//i, 'https://'))
    const last = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname
    const stem = last.replace(/\.(ics|ifb)$/i, '').replace(/[-_]+/g, ' ')
    return stem
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')
  } catch {
    return url.slice(0, 32)
  }
}

// Normalise webcal:// → https:// so the http plugin actually fetches
// it. webcal is a UI scheme, not a real one — the underlying transport
// is HTTP(S).
function normaliseUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, 'https://')
}

// Discriminated result from `fetchIcsSubscription`: either the server
// gave us a fresh body (parse it, save the new cache validators) or it
// returned 304 Not Modified, in which case the caller keeps the
// existing events untouched and just bumps `lastSyncedAt`.
export type FetchResult =
  | {
      kind: 'fresh'
      events: EventItem[]
      raw: string
      etag: string | null
      lastModified: string | null
    }
  | {
      kind: 'not-modified'
      etag: string | null
      lastModified: string | null
    }

interface ConditionalHeaders {
  etag?: string | null
  lastModified?: string | null
}

// Fetch + parse a remote ICS feed. Throws a typed error on transport
// failure or unparseable body so the caller can surface a clear
// message. Uses the Tauri http plugin so the request runs through Rust
// (no CORS, no preflight). When `conditional` is supplied, sends
// `If-None-Match` / `If-Modified-Since` and treats a 304 as a
// `not-modified` result so the caller can skip re-parsing.
export async function fetchIcsSubscription(
  url: string,
  signal?: AbortSignal,
  conditional?: ConditionalHeaders,
): Promise<FetchResult> {
  const target = normaliseUrl(url)
  const headers: Record<string, string> = {
    Accept: 'text/calendar, text/plain, */*',
  }
  if (conditional?.etag) headers['If-None-Match'] = conditional.etag
  if (conditional?.lastModified) {
    headers['If-Modified-Since'] = conditional.lastModified
  }
  const res = await tauriFetch(target, {
    method: 'GET',
    headers,
    signal,
  })
  if (res.status === 304) {
    // Server confirms our cached copy is still current. Echo back the
    // validators we sent so the caller can keep persisting them (some
    // servers re-mint the ETag even on 304, but most just return the
    // status with no body and no headers).
    return {
      kind: 'not-modified',
      etag:
        res.headers.get('etag') ?? conditional?.etag ?? null,
      lastModified:
        res.headers.get('last-modified') ??
        conditional?.lastModified ??
        null,
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
  }
  const raw = await res.text()
  const etag = res.headers.get('etag')
  const lastModified = res.headers.get('last-modified')
  // splitIcs returns standalone per-VEVENT VCALENDAR strings (and
  // skips items it can't parse). We rebuild EventItem locally — these
  // are display-only, no etebase round-trip — so a synthetic itemUid
  // is fine.
  const parts = splitIcs(raw)
  if (parts.length === 0) {
    throw new Error('No events found in the feed.')
  }
  const events: EventItem[] = []
  for (let i = 0; i < parts.length; i++) {
    const ev = parseVEvent(parts[i])
    if (!ev) continue
    // Subscription items are read-only and never round-trip back to a
    // server, but the rest of the render path expects a stable
    // itemUid. Use the VEVENT's own UID when present (so a re-fetch
    // dedupes naturally) and fall back to an index-derived id.
    const m = parts[i].match(/^UID:(.+)$/m)
    const itemUid = m ? m[1].trim() : `${i}`
    events.push({ itemUid, event: ev })
  }
  return { kind: 'fresh', events, raw, etag, lastModified }
}
