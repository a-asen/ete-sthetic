import { invoke } from '@tauri-apps/api/core'

// Social / messaging services and how to turn a stored handle into an
// openable profile URL. A contact's `messaging` fields carry the service
// in `type` and the handle in `value`; this module maps known services to
// URL templates, lets the user register their own custom services, and
// opens the resulting URL in the system browser (never the Tauri webview).

export interface SocialService {
  // Lowercase key, matched against VCardField.type (case-insensitively).
  id: string
  label: string
  // URL template containing `{handle}`; omit for chat-only services that
  // have no public profile URL (Discord, Signal, …) — those stay plain
  // text. `{handle}` is filled with the handle minus any leading '@'.
  template?: string
}

// Curated services. Order roughly by how commonly they have a clickable
// public profile. Chat-only apps are listed (so they're pickable) but
// have no template.
const SEEDED: SocialService[] = [
  { id: 'facebook', label: 'Facebook', template: 'https://facebook.com/{handle}' },
  { id: 'instagram', label: 'Instagram', template: 'https://instagram.com/{handle}' },
  { id: 'x', label: 'X / Twitter', template: 'https://x.com/{handle}' },
  { id: 'twitter', label: 'Twitter', template: 'https://x.com/{handle}' },
  { id: 'telegram', label: 'Telegram', template: 'https://t.me/{handle}' },
  { id: 'snapchat', label: 'Snapchat', template: 'https://snapchat.com/add/{handle}' },
  { id: 'tiktok', label: 'TikTok', template: 'https://tiktok.com/@{handle}' },
  { id: 'youtube', label: 'YouTube', template: 'https://youtube.com/@{handle}' },
  { id: 'github', label: 'GitHub', template: 'https://github.com/{handle}' },
  { id: 'linkedin', label: 'LinkedIn', template: 'https://linkedin.com/in/{handle}' },
  { id: 'reddit', label: 'Reddit', template: 'https://reddit.com/user/{handle}' },
  { id: 'twitch', label: 'Twitch', template: 'https://twitch.tv/{handle}' },
  // Chat-only (no public profile URL) — pickable, rendered as plain text.
  { id: 'discord', label: 'Discord' },
  { id: 'signal', label: 'Signal' },
  { id: 'slack', label: 'Slack' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'xmpp', label: 'XMPP' },
  { id: 'skype', label: 'Skype' },
]

const CUSTOM_KEY = 'ete-sthetic.contacts.customServices'

export function readCustomServices(): SocialService[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.flatMap((x) => {
      if (
        x &&
        typeof (x as SocialService).id === 'string' &&
        typeof (x as SocialService).label === 'string'
      ) {
        const s = x as SocialService
        return [
          {
            id: s.id.toLowerCase(),
            label: s.label,
            template:
              typeof s.template === 'string' && s.template
                ? s.template
                : undefined,
          },
        ]
      }
      return []
    })
  } catch {
    return []
  }
}

// Add (or replace by id) a user-defined service. Returns the saved id.
export function addCustomService(label: string, template: string): string {
  const trimmed = label.trim()
  const id = trimmed.toLowerCase().replace(/\s+/g, '-')
  if (!id) return ''
  const tmpl = template.trim()
  const existing = readCustomServices().filter((s) => s.id !== id)
  const next: SocialService[] = [
    ...existing,
    { id, label: trimmed, template: tmpl || undefined },
  ]
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal — the service just won't persist this session.
  }
  return id
}

// Seeded + custom, de-duplicated by id (custom overrides seeded).
export function allServices(): SocialService[] {
  const custom = readCustomServices()
  const ids = new Set(custom.map((s) => s.id))
  return [...SEEDED.filter((s) => !ids.has(s.id)), ...custom]
}

export function serviceFor(type: string): SocialService | undefined {
  const id = type.trim().toLowerCase()
  if (!id) return undefined
  return allServices().find((s) => s.id === id)
}

// Resolve a messaging entry to an openable URL, or null when it isn't
// linkable. A handle that's already a full http(s) URL opens directly
// (covers ad-hoc custom hosts); otherwise a known/custom service template
// is filled with the handle.
export function buildSocialUrl(type: string, handle: string): string | null {
  const v = handle.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  const svc = serviceFor(type)
  const bare = v.replace(/^@+/, '')
  // Facebook profiles are reachable two ways: a vanity username
  // (facebook.com/jane.doe) or a numeric user id, which only resolves via
  // the profile.php?id= form. The seeded template covers the former; detect
  // an all-digits handle and route it to the id URL instead.
  if (svc?.id === 'facebook' && /^\d+$/.test(bare)) {
    return `https://www.facebook.com/profile.php?id=${bare}`
  }
  if (svc?.template) {
    return svc.template.replace('{handle}', encodeURIComponent(bare))
  }
  return null
}

// Open a URL in the user's default browser. Swallows errors so an older
// binary without the opener plugin (or a denied scope) degrades to a
// no-op rather than throwing into the UI.
export async function openExternal(url: string): Promise<void> {
  try {
    // Call the opener plugin's command directly rather than importing the
    // @tauri-apps/plugin-opener JS wrapper — that wrapper is an optional npm
    // dep, and a fresh `git pull` without `npm install` broke the whole
    // module graph in Vite. `@tauri-apps/api/core` is always present, and
    // the Rust plugin (registered in lib.rs) handles this command.
    await invoke('plugin:opener|open_url', { url, with: null })
  } catch {
    // Opener unavailable (older binary / not rebuilt) or not permitted —
    // nothing we can do from here.
  }
}
