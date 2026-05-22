import type { VCard, VCardAddress, VCardField } from '../types'

// Hand-rolled vCard (RFC 6350 v4 / RFC 2426 v3) parser + serializer.
// ical.js does not handle vCard — it's a different grammar — and the
// project keeps its dependency list lean, so this is a focused
// implementation covering the common properties. Properties we don't
// model (PHOTO, NICKNAME, IMPP, X-*, …) are preserved verbatim across an
// edit so a round-trip never drops data.

// ---- content-line model ----

interface ContentLine {
  group: string
  // Upper-cased property name (FN, EMAIL, …).
  name: string
  // Param name (upper-cased) → values.
  params: Map<string, string[]>
  // Everything after the first unquoted ':' — raw, not unescaped.
  value: string
  // The whole unfolded line, verbatim — used to re-emit preserved props.
  rawLine: string
}

// Properties this module generates itself on serialize; preserved-line
// copying skips them so they're never written twice.
const MODELED = new Set([
  'BEGIN',
  'END',
  'VERSION',
  'UID',
  'FN',
  'N',
  'ORG',
  'TITLE',
  'EMAIL',
  'TEL',
  'URL',
  'ADR',
  'BDAY',
  'NOTE',
  'CATEGORIES',
  'REV',
])

// TYPE tokens that carry no useful "home/work/cell" meaning for display.
const NOISE_TYPES = new Set([
  'internet',
  'voice',
  'pref',
  'x400',
  'other',
])

// Unfold per RFC 6350 §3.2: a CRLF followed by a space or tab continues
// the previous logical line.
function unfold(raw: string): string[] {
  const physical = raw.split(/\r\n|\r|\n/)
  const out: string[] = []
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

// Split on `sep`, treating a backslash-escaped separator as a literal.
// Escape sequences are left intact for a later unescapeText pass.
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[i] + s[i + 1]
      i++
      continue
    }
    if (s[i] === sep) {
      out.push(cur)
      cur = ''
    } else {
      cur += s[i]
    }
  }
  out.push(cur)
  return out
}

function unescapeText(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1]
      if (n === 'n' || n === 'N') out += '\n'
      else if (n === ',' || n === ';' || n === '\\') out += n
      else out += n
      i++
    } else {
      out += s[i]
    }
  }
  return out
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

// Split the param section on ';' while respecting double-quoted runs.
function splitQuoted(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted
      cur += ch
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"')
    ? s.slice(1, -1)
    : s
}

function parseContentLine(line: string): ContentLine | null {
  if (line.trim() === '') return null
  // First ':' not inside a quoted param value ends the name+params part.
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const tokens = splitQuoted(head, ';')
  let nameToken = tokens[0] ?? ''
  let group = ''
  const dot = nameToken.indexOf('.')
  if (dot !== -1) {
    group = nameToken.slice(0, dot)
    nameToken = nameToken.slice(dot + 1)
  }
  const name = nameToken.trim().toUpperCase()
  if (!name) return null

  const params = new Map<string, string[]>()
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]
    const eq = tok.indexOf('=')
    let key: string
    let vals: string[]
    if (eq === -1) {
      // vCard 3.0 bare type token, e.g. TEL;HOME;VOICE:…
      key = 'TYPE'
      vals = [tok.trim()]
    } else {
      key = tok.slice(0, eq).trim().toUpperCase()
      vals = splitQuoted(tok.slice(eq + 1), ',').map((v) =>
        stripQuotes(v).trim(),
      )
    }
    const existing = params.get(key)
    if (existing) existing.push(...vals)
    else params.set(key, vals)
  }

  return { group, name, params, value, rawLine: line }
}

function parseLines(raw: string): ContentLine[] {
  const out: ContentLine[] = []
  for (const line of unfold(raw)) {
    const cl = parseContentLine(line)
    if (cl) out.push(cl)
  }
  return out
}

// Pick a display TYPE: the first token that isn't generic noise.
function pickType(line: ContentLine): string {
  const types = (line.params.get('TYPE') ?? []).map((t) => t.toLowerCase())
  for (const t of types) {
    if (t && !NOISE_TYPES.has(t)) return t
  }
  return ''
}

function photoSrc(line: ContentLine): string | undefined {
  const v = line.value.trim()
  if (!v) return undefined
  if (v.startsWith('data:') || /^https?:/i.test(v)) return v
  const enc = (line.params.get('ENCODING') ?? []).map((e) => e.toLowerCase())
  const looksB64 = enc.includes('b') || enc.includes('base64')
  if (looksB64 || /^[A-Za-z0-9+/=\s]+$/.test(v)) {
    const fmt =
      (line.params.get('TYPE') ?? [])[0]?.toLowerCase().replace(/[^a-z]/g, '') ||
      'jpeg'
    return `data:image/${fmt};base64,${v.replace(/\s+/g, '')}`
  }
  return undefined
}

function comp(parts: string[], i: number): string {
  return unescapeText(parts[i] ?? '').trim()
}

export function emptyVCard(): VCard {
  return {
    uid: crypto.randomUUID(),
    fn: '',
    name: {
      family: '',
      given: '',
      additional: '',
      prefixes: '',
      suffixes: '',
    },
    org: '',
    title: '',
    emails: [],
    phones: [],
    urls: [],
    addresses: [],
    birthday: '',
    note: '',
    categories: [],
    raw: '',
  }
}

// Best-effort display name when a card has no FN.
function deriveFn(name: VCard['name'], emails: VCardField[]): string {
  const joined = [name.given, name.additional, name.family]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (joined) return joined
  if (emails[0]?.value) return emails[0].value
  return 'Unnamed contact'
}

export function parseVCard(raw: string): VCard | null {
  const lines = parseLines(raw)
  const begin = lines.findIndex(
    (l) => l.name === 'BEGIN' && l.value.trim().toUpperCase() === 'VCARD',
  )
  if (begin === -1) return null
  let end = lines.findIndex(
    (l, i) =>
      i > begin && l.name === 'END' && l.value.trim().toUpperCase() === 'VCARD',
  )
  if (end === -1) end = lines.length
  const body = lines.slice(begin + 1, end)

  const card = emptyVCard()
  card.raw = raw
  let sawUid = false

  for (const line of body) {
    switch (line.name) {
      case 'UID':
        card.uid = line.value.trim() || card.uid
        sawUid = sawUid || !!line.value.trim()
        break
      case 'FN':
        if (!card.fn) card.fn = unescapeText(line.value).trim()
        break
      case 'N': {
        const p = splitUnescaped(line.value, ';')
        card.name = {
          family: comp(p, 0),
          given: comp(p, 1),
          additional: comp(p, 2),
          prefixes: comp(p, 3),
          suffixes: comp(p, 4),
        }
        break
      }
      case 'ORG':
        if (!card.org) {
          card.org = splitUnescaped(line.value, ';')
            .map((c) => unescapeText(c).trim())
            .filter(Boolean)
            .join(', ')
        }
        break
      case 'TITLE':
        if (!card.title) card.title = unescapeText(line.value).trim()
        break
      case 'EMAIL': {
        const v = unescapeText(line.value).trim()
        if (v) card.emails.push({ value: v, type: pickType(line) })
        break
      }
      case 'TEL': {
        const v = unescapeText(line.value).trim()
        if (v) card.phones.push({ value: v, type: pickType(line) })
        break
      }
      case 'URL': {
        const v = unescapeText(line.value).trim()
        if (v) card.urls.push({ value: v, type: pickType(line) })
        break
      }
      case 'ADR': {
        const p = splitUnescaped(line.value, ';')
        const adr: VCardAddress = {
          type: pickType(line),
          pobox: comp(p, 0),
          ext: comp(p, 1),
          street: comp(p, 2),
          locality: comp(p, 3),
          region: comp(p, 4),
          postal: comp(p, 5),
          country: comp(p, 6),
        }
        if (
          adr.pobox ||
          adr.ext ||
          adr.street ||
          adr.locality ||
          adr.region ||
          adr.postal ||
          adr.country
        ) {
          card.addresses.push(adr)
        }
        break
      }
      case 'BDAY':
        if (!card.birthday) card.birthday = line.value.trim()
        break
      case 'NOTE':
        if (!card.note) card.note = unescapeText(line.value)
        break
      case 'CATEGORIES':
        for (const c of splitUnescaped(line.value, ',')) {
          const v = unescapeText(c).trim()
          if (v && !card.categories.includes(v)) card.categories.push(v)
        }
        break
      case 'PHOTO':
        if (!card.photo) card.photo = photoSrc(line)
        break
    }
  }

  if (!sawUid) card.uid = card.uid || crypto.randomUUID()
  if (!card.fn) card.fn = deriveFn(card.name, card.emails)
  return card
}

// ---- serialize ----

function utcStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

// Fold a logical line at 75 chars; continuation lines start with a space.
function foldLine(line: string): string {
  if (line.length <= 75) return line
  let out = line.slice(0, 75)
  let rest = line.slice(75)
  while (rest.length > 74) {
    out += '\r\n ' + rest.slice(0, 74)
    rest = rest.slice(74)
  }
  return out + '\r\n ' + rest
}

function typeParam(type: string): string {
  const clean = type.replace(/[^a-zA-Z0-9-]/g, '')
  return clean ? `;TYPE=${clean}` : ''
}

function hasName(n: VCard['name']): boolean {
  return !!(n.family || n.given || n.additional || n.prefixes || n.suffixes)
}

function hasAddr(a: VCardAddress): boolean {
  return !!(
    a.pobox ||
    a.ext ||
    a.street ||
    a.locality ||
    a.region ||
    a.postal ||
    a.country
  )
}

// Serialize a VCard. When `preserveFrom` (the card's previous raw text) is
// given, every property this module doesn't model is copied across
// verbatim, so an edit can't silently drop PHOTO / X-* / IMPP / etc.
export function serializeVCard(card: VCard, preserveFrom?: string): string {
  const out: string[] = ['BEGIN:VCARD']

  let version = '4.0'
  const preserved: ContentLine[] = preserveFrom ? parseLines(preserveFrom) : []
  const verLine = preserved.find((l) => l.name === 'VERSION')
  if (verLine && verLine.value.trim()) version = verLine.value.trim()
  out.push(`VERSION:${version}`)

  out.push(`UID:${escapeText(card.uid)}`)
  out.push(`FN:${escapeText(card.fn)}`)
  if (hasName(card.name)) {
    const n = card.name
    out.push(
      'N:' +
        [n.family, n.given, n.additional, n.prefixes, n.suffixes]
          .map(escapeText)
          .join(';'),
    )
  }
  if (card.org) out.push(`ORG:${escapeText(card.org)}`)
  if (card.title) out.push(`TITLE:${escapeText(card.title)}`)
  for (const e of card.emails) {
    if (e.value) out.push(`EMAIL${typeParam(e.type)}:${escapeText(e.value)}`)
  }
  for (const p of card.phones) {
    if (p.value) out.push(`TEL${typeParam(p.type)}:${escapeText(p.value)}`)
  }
  for (const u of card.urls) {
    if (u.value) out.push(`URL${typeParam(u.type)}:${escapeText(u.value)}`)
  }
  for (const a of card.addresses) {
    if (!hasAddr(a)) continue
    out.push(
      `ADR${typeParam(a.type)}:` +
        [a.pobox, a.ext, a.street, a.locality, a.region, a.postal, a.country]
          .map(escapeText)
          .join(';'),
    )
  }
  if (card.birthday) out.push(`BDAY:${card.birthday}`)
  if (card.note) out.push(`NOTE:${escapeText(card.note)}`)
  if (card.categories.length > 0) {
    out.push(`CATEGORIES:${card.categories.map(escapeText).join(',')}`)
  }

  // Carry every property we don't model across untouched.
  for (const l of preserved) {
    if (MODELED.has(l.name)) continue
    out.push(l.rawLine)
  }

  out.push(`REV:${utcStamp()}`)
  out.push('END:VCARD')
  return out.map(foldLine).join('\r\n') + '\r\n'
}

// Build a brand-new vCard from a draft model (no preserved properties).
export function buildVCard(card: VCard): { uid: string; raw: string } {
  return { uid: card.uid, raw: serializeVCard(card) }
}
