import { useEffect, useRef, useState } from 'react'
import type { CollectionInfo, EventItem } from '../../types'
import type { NewVEventArgs, VEventPatch } from '../../services/vevent'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// Parse the native <input type=date|time> values back into a local Date.
function fromInputs(date: string, time: string): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time ? time.split(':').map(Number) : [0, 0]
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0)
}

// Bump an "HH:MM" string by a positive or negative minute delta. Wraps
// inside [00:00, 24:00). Returns the original value if it doesn't parse.
function bumpTime(value: string, deltaMin: number): string {
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return value
  const total = Number(m[1]) * 60 + Number(m[2]) + deltaMin
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

// Bump a "YYYY-MM-DD" string by N days, respecting month/year rollover.
function bumpDate(value: string, deltaDays: number): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return value
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + deltaDays)
  return toDateInput(d)
}

// Larger-step modifier handlers for the date/time inputs. The native
// arrow-key default already does ±1 (minute or day); Shift / Ctrl+Cmd
// take over for bigger jumps. Keeps the native input — no custom
// segmented editor yet — so month / year jumps are still ±1 month and
// only fire on the segment the browser currently has focused.
function handleTimeArrowMods(
  e: React.KeyboardEvent<HTMLInputElement>,
  value: string,
  onChange: (v: string) => void,
): void {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) return
  if (!value) return
  e.preventDefault()
  const step = e.ctrlKey || e.metaKey ? 15 : 5
  const sign = e.key === 'ArrowUp' ? 1 : -1
  onChange(bumpTime(value, sign * step))
}

function handleDateArrowMods(
  e: React.KeyboardEvent<HTMLInputElement>,
  value: string,
  onChange: (v: string) => void,
): void {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) return
  if (!value) return
  e.preventDefault()
  const step = e.ctrlKey || e.metaKey ? 7 : 3
  const sign = e.key === 'ArrowUp' ? 1 : -1
  onChange(bumpDate(value, sign * step))
}

// Recurrence presets surfaced by the composer's "Repeats" dropdown.
// "Custom" is selectable only when the source event already has an
// RRULE more complex than the bare presets (BYDAY / INTERVAL / COUNT
// / UNTIL) — picking it preserves the original; picking any other
// option overwrites the RRULE with the matching FREQ string or
// removes it.
type RepeatPreset =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom'

function detectPreset(rrule?: string): RepeatPreset {
  if (!rrule) return 'none'
  const normalized = rrule.trim().toUpperCase().replace(/\s+/g, '')
  if (normalized === 'FREQ=DAILY') return 'daily'
  if (normalized === 'FREQ=WEEKLY') return 'weekly'
  if (normalized === 'FREQ=MONTHLY') return 'monthly'
  if (normalized === 'FREQ=YEARLY') return 'yearly'
  return 'custom'
}

export function EventComposer({
  date,
  defaultHour,
  initialStart,
  initialEnd,
  editing,
  calendars,
  defaultCalUid,
  saving,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
  serverChanged,
  onReload,
}: {
  date: Date
  defaultHour?: number
  // Precise prefill for drag-create (overrides date/defaultHour).
  initialStart?: Date
  initialEnd?: Date
  // When set, the composer is in edit mode for this event.
  editing?: EventItem
  calendars: CollectionInfo[]
  defaultCalUid: string
  saving: boolean
  error: string | null
  onCreate: (calUid: string, args: NewVEventArgs) => void
  onUpdate?: (patch: VEventPatch, calUid: string) => void
  onDelete?: () => void
  onClose: () => void
  // The event changed on the server while it was open here.
  serverChanged?: boolean
  onReload?: () => void
}) {
  const ev = editing?.event
  const start0 = ev?.start
    ? new Date(ev.start)
    : initialStart
      ? new Date(initialStart)
      : new Date(date)
  if (!ev?.start && !initialStart) start0.setHours(defaultHour ?? 9, 0, 0, 0)
  // Stored all-day DTEND is exclusive; show the inclusive last day.
  const end0 = ev?.end
    ? new Date(
        ev.allDay ? ev.end.getTime() - 24 * 60 * 60 * 1000 : ev.end.getTime(),
      )
    : initialEnd
      ? new Date(initialEnd)
      : new Date(start0.getTime() + 60 * 60 * 1000)

  const [calUid, setCalUid] = useState(defaultCalUid)
  const [summary, setSummary] = useState(ev?.summary ?? '')
  const [allDay, setAllDay] = useState(ev?.allDay ?? false)
  const [startDate, setStartDate] = useState(toDateInput(start0))
  const [startTime, setStartTime] = useState(toTimeInput(start0))
  const [endDate, setEndDate] = useState(toDateInput(end0))
  const [endTime, setEndTime] = useState(toTimeInput(end0))
  const [location, setLocation] = useState(ev?.location ?? '')
  const [description, setDescription] = useState(ev?.description ?? '')
  const [repeat, setRepeat] = useState<RepeatPreset>(() =>
    detectPreset(ev?.rrule),
  )
  // True when the source event's RRULE is more complex than a preset
  // (BYDAY, INTERVAL, COUNT, UNTIL, etc.). The dropdown surfaces a
  // "Custom" option that's only selectable while we still hold the
  // original RRULE — picking any other option will replace it.
  const sourceHadCustomRrule = detectPreset(ev?.rrule) === 'custom'
  const [localErr, setLocalErr] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

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

  const submit = () => {
    if (!summary.trim()) {
      setLocalErr('Title is required.')
      return
    }
    const start = fromInputs(startDate, allDay ? '00:00' : startTime)
    let end = fromInputs(endDate, allDay ? '00:00' : endTime)
    if (allDay) {
      // DTEND is exclusive — make it the day after the last day.
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
    }
    if (end.getTime() <= start.getTime() && !allDay) {
      setLocalErr('End must be after start.')
      return
    }
    setLocalErr(null)
    // Translate the "Repeats" dropdown back into an RRULE string. On
    // create, we either emit an RRULE or omit the field. On edit, the
    // patch field uses null to mean "remove" and undefined to mean
    // "leave whatever was there alone" — that's what lets the user
    // keep a complex BYDAY/COUNT RRULE the dropdown can't represent
    // (Custom stays selected, we send undefined, vevent.ts skips the
    // property entirely).
    const presetToRrule: Record<RepeatPreset, string | null | undefined> = {
      none: null,
      daily: 'FREQ=DAILY',
      weekly: 'FREQ=WEEKLY',
      monthly: 'FREQ=MONTHLY',
      yearly: 'FREQ=YEARLY',
      custom: undefined,
    }
    if (editing && onUpdate) {
      onUpdate(
        {
          summary: summary.trim(),
          start,
          end,
          allDay,
          location: location.trim() || null,
          description: description.trim() || null,
          rrule: presetToRrule[repeat],
        },
        calUid,
      )
    } else {
      onCreate(calUid, {
        summary: summary.trim(),
        start,
        end,
        allDay,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        rrule: presetToRrule[repeat] ?? undefined,
      })
    }
  }

  const field = 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New event"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-sm font-medium text-text">
          {editing ? 'Edit event' : 'New event'}
        </h3>

        {serverChanged && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
            <span className="min-w-0 flex-1">
              This event changed on the server while you had it open.
              Saving will prompt to resolve the conflict.
            </span>
            {onReload && (
              <button
                type="button"
                onClick={onReload}
                className="shrink-0 rounded border border-danger/50 px-2 py-0.5 hover:bg-danger/20"
              >
                Discard &amp; reload
              </button>
            )}
          </div>
        )}

        <div className="space-y-3">
          <input
            ref={titleRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Title"
            className={field}
          />

          <div className="flex items-center gap-3">
            <select
              value={calUid}
              onChange={(e) => setCalUid(e.target.value)}
              title={editing ? 'Change calendar to move this event' : undefined}
              className={field}
            >
              {calendars.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[11px] text-text-faint">Start</div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onKeyDown={(e) =>
                  handleDateArrowMods(e, startDate, setStartDate)
                }
                title="Shift+↑/↓ jumps 3 days · Ctrl/Cmd+↑/↓ jumps 7 days"
                className={field}
              />
              {!allDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  onKeyDown={(e) =>
                    handleTimeArrowMods(e, startTime, setStartTime)
                  }
                  title="Shift+↑/↓ jumps 5 min · Ctrl/Cmd+↑/↓ jumps 15 min"
                  className={`${field} mt-1`}
                />
              )}
            </div>
            <div>
              <div className="mb-1 text-[11px] text-text-faint">End</div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onKeyDown={(e) =>
                  handleDateArrowMods(e, endDate, setEndDate)
                }
                title="Shift+↑/↓ jumps 3 days · Ctrl/Cmd+↑/↓ jumps 7 days"
                className={field}
              />
              {!allDay && (
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  onKeyDown={(e) =>
                    handleTimeArrowMods(e, endTime, setEndTime)
                  }
                  title="Shift+↑/↓ jumps 5 min · Ctrl/Cmd+↑/↓ jumps 15 min"
                  className={`${field} mt-1`}
                />
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-text-muted">
            <span className="shrink-0">Repeats</span>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as RepeatPreset)}
              aria-label="Repeat frequency"
              className={field}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              {sourceHadCustomRrule && (
                <option value="custom">Custom (preserved)</option>
              )}
            </select>
          </label>

          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className={field}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className={`${field} resize-none`}
          />
        </div>

        {(localErr || error) && (
          <p className="mt-3 text-xs text-danger">{localErr || error}</p>
        )}

        <div className="mt-5 flex items-center gap-2">
          {editing && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="h-8 rounded-md border border-border px-3 text-xs text-danger hover:border-danger disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
