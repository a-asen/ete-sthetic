import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import type { EventItem, VAlarm } from '../types'
import { getCalMemory } from './calstore'
import { expandEvents } from './recurrence'

// In-app VALARM reminder scheduler (roadmap U2). The app is a long-running
// desktop process, so a lightweight poll is enough: every TICK_MS we expand
// the (visible) calendar events over a short forward window and fire an OS
// notification for any alarm whose trigger time just passed.
//
// Design notes:
// - Reads straight from calstore (process-lifetime memory) instead of React
//   state, so reminders keep firing even while the user is in the Tasks
//   module — the calendar only has to have been opened once this session.
// - Recurrence is handled by reusing expandEvents over a day-aligned range
//   so its internal cache stays warm across ticks.
// - We only fire alarms whose time fell in the last MAX_LATE_MS, so
//   reopening the app hours later doesn't replay a backlog of old reminders.

const TICK_MS = 30_000
const FORWARD_DAYS = 2
// Grace band: fire if the trigger passed within this window (covers the
// poll interval plus slack). Anything older is considered missed, not
// replayed.
const MAX_LATE_MS = 90_000

let timer: ReturnType<typeof setInterval> | null = null
let permission: 'unknown' | 'granted' | 'denied' = 'unknown'
const fired = new Set<string>()

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

async function ensurePermission(): Promise<boolean> {
  if (permission === 'granted') return true
  if (permission === 'denied') return false
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    permission = granted ? 'granted' : 'denied'
    return granted
  } catch {
    // Not running under Tauri (plain vite preview) — silently no-op.
    permission = 'denied'
    return false
  }
}

function collectVisibleEvents(): EventItem[] {
  const m = getCalMemory()
  const out: EventItem[] = []
  for (const [uid, list] of m.eventsByCal) {
    if (m.hidden.has(uid)) continue
    out.push(...list)
  }
  return out
}

function fireTime(startMs: number, endMs: number, al: VAlarm): number | null {
  if (al.at) return al.at.getTime()
  if (al.relSeconds == null) return null
  const base = al.relTo === 'end' ? endMs : startMs
  return base + al.relSeconds * 1000
}

function bodyFor(startMs: number, al: VAlarm): string {
  const when = new Date(startMs).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  if (al.at) return `Reminder · starts ${when}`
  const mins = Math.round(Math.abs(al.relSeconds ?? 0) / 60)
  if (mins === 0) return `Starts now (${when})`
  const lead =
    mins % 60 === 0 ? `${mins / 60}h` : mins >= 60 ? `${mins} min` : `${mins} min`
  return `In ${lead} · starts ${when}`
}

async function tick(): Promise<void> {
  const events = collectVisibleEvents()
  if (events.length === 0) return

  const now = Date.now()
  const rangeStart = startOfDay(new Date(now))
  const rangeEnd = new Date(
    rangeStart.getTime() + (FORWARD_DAYS + 1) * 86_400_000,
  )
  const occ = expandEvents(events, rangeStart, rangeEnd)

  const due: { title: string; body: string }[] = []
  for (const it of occ) {
    const start = it.event.start?.getTime()
    if (start == null || it.event.alarms.length === 0) continue
    const end = it.event.end?.getTime() ?? start
    it.event.alarms.forEach((al, idx) => {
      if (al.action === 'EMAIL') return // no mail transport
      const at = fireTime(start, end, al)
      if (at == null) return
      if (at > now || now - at > MAX_LATE_MS) return
      const key = `${it.itemUid}|${start}|${idx}`
      if (fired.has(key)) return
      fired.add(key)
      due.push({
        title: it.event.summary || '(untitled event)',
        body: bodyFor(start, al),
      })
    })
  }

  if (due.length === 0) return
  if (!(await ensurePermission())) return
  for (const d of due) {
    try {
      sendNotification({ title: d.title, body: d.body })
    } catch {
      // Ignore a single failed notification; keep the rest.
    }
  }
  // The MAX_LATE_MS window already prevents re-fire storms; just keep the
  // dedupe set from growing without bound across a long session.
  if (fired.size > 4000) fired.clear()
}

// Idempotent: safe to call on every CalendarView mount. Runs one immediate
// pass so an alarm that came due while away fires promptly.
export function startAlarmScheduler(): void {
  if (timer != null) return
  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
}

export function stopAlarmScheduler(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
  fired.clear()
  permission = 'unknown'
}
