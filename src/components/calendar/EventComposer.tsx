import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, EventItem } from '../../types'
import type { NewVEventArgs, VEventPatch } from '../../services/vevent'
import { CalendarPopover } from '../CalendarPopover'
import { ConfirmModal } from '../ConfirmModal'
import { useUndoableValue } from '../../hooks/useUndoableValue'
import { registerUnsavedGuard } from '../../services/unsavedGuard'
import {
  type CustomFreq,
  type CustomRrule,
  type RepeatPreset,
  type Weekday,
  MONTH_POSITIONS,
  WEEKDAYS,
  customSupportsRrule,
  detectPreset,
  emptyCustomRrule,
  ordinalLabel,
  parseRruleToCustom,
  serializeCustomRrule,
} from '../../services/rrule'

function CalendarIcon() {
  return (
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
      <rect x="2.5" y="3" width="11" height="10.5" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  )
}

// Shared styling for the small multi-select toggle pills used by the
// custom-recurrence weekday / position pickers.
function togglePill(on: boolean): string {
  return `min-w-[2.4rem] rounded-md border px-2 py-1 text-[11px] transition-colors ${
    on
      ? 'border-accent/60 bg-accent-soft text-text'
      : 'border-border bg-bg text-text-muted hover:border-border-strong hover:text-text'
  }`
}

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

// Bump a "YYYY-MM-DD" string by a mix of days / months / years,
// respecting rollover. Month steps clamp the day to the last valid day
// of the resulting month (e.g. Jan 31 +1mo → Feb 28/29). Returns the
// original value if it doesn't parse.
function bumpDateBy(
  value: string,
  { days = 0, months = 0, years = 0 }: { days?: number; months?: number; years?: number },
): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return value
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (years) d.setFullYear(d.getFullYear() + years)
  if (months) {
    const targetDay = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + months)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(targetDay, lastDay))
  }
  if (days) d.setDate(d.getDate() + days)
  return toDateInput(d)
}

// Larger-step modifier handlers for the date/time inputs. The native
// arrow-key default already does ±1 (minute or day, on the focused
// segment); modifiers take over for bigger jumps. The browser doesn't
// expose which date segment is focused, so month / year stepping is
// surfaced through dedicated Alt chords (which don't depend on the
// segment) rather than a custom segmented editor.
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
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return
  if (!value) return
  e.preventDefault()
  const sign = e.key === 'ArrowUp' ? 1 : -1
  // Alt = month jump; Alt+Shift = year jump. These work no matter which
  // date segment the native input has focused.
  if (e.altKey) {
    onChange(
      e.shiftKey
        ? bumpDateBy(value, { years: sign })
        : bumpDateBy(value, { months: sign }),
    )
    return
  }
  // Shift = ±3 days, Ctrl/Cmd = ±7 days.
  const step = e.ctrlKey || e.metaKey ? 7 : 3
  onChange(bumpDateBy(value, { days: sign * step }))
}

export function EventComposer({
  date,
  defaultHour,
  initialStart,
  initialEnd,
  initialAllDay,
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
  // Open the composer with the all-day toggle pre-checked.
  initialAllDay?: boolean
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
  const [allDay, setAllDay] = useState(ev?.allDay ?? initialAllDay ?? false)
  const [startDate, setStartDate] = useState(toDateInput(start0))
  const [startTime, setStartTime] = useState(toTimeInput(start0))
  const [endDate, setEndDate] = useState(toDateInput(end0))
  const [endTime, setEndTime] = useState(toTimeInput(end0))
  const [location, setLocation] = useState(ev?.location ?? '')
  const [description, setDescription] = useState(ev?.description ?? '')
  const [repeat, setRepeat] = useState<RepeatPreset>(() =>
    detectPreset(ev?.rrule),
  )
  // True when the source event's RRULE is more complex than a preset.
  // The editor's surface supports FREQ + INTERVAL + BYDAY + COUNT/UNTIL;
  // anything outside that (BYMONTHDAY, BYSETPOS, EXDATE, …) drops us
  // into a "preserve verbatim" mode where the dropdown still shows
  // "Custom" but Save sends `undefined` so the stored RRULE survives.
  const sourceHadCustomRrule = detectPreset(ev?.rrule) === 'custom'
  const sourceCustomEditable = !!(
    ev?.rrule && customSupportsRrule(ev.rrule)
  )

  const [customRrule, setCustomRrule] = useState<CustomRrule>(() => {
    if (ev?.rrule && sourceCustomEditable) return parseRruleToCustom(ev.rrule)
    if (ev?.rrule) {
      // Source has a complex RRULE the editor can't fully express. Seed
      // the form with what we CAN parse — if the user explicitly edits
      // the form we'll replace; otherwise we leave the original alone.
      return parseRruleToCustom(ev.rrule)
    }
    return emptyCustomRrule()
  })
  // Tracks whether the user has touched the custom editor since the
  // composer mounted. Combined with `sourceCustomEditable` it decides
  // whether to emit the freshly-serialised RRULE or preserve the
  // original verbatim. Mutating the form turns this on; switching
  // repeat presets resets it.
  const [customDirty, setCustomDirty] = useState(false)
  const updateCustom = (patch: Partial<CustomRrule>) => {
    setCustomDirty(true)
    setCustomRrule((c) => ({ ...c, ...patch }))
  }
  const toggleByday = (w: Weekday) => {
    setCustomDirty(true)
    setCustomRrule((c) => {
      const next = new Set(c.byday)
      if (next.has(w)) next.delete(w)
      else next.add(w)
      return { ...c, byday: next }
    })
  }
  const [localErr, setLocalErr] = useState<string | null>(null)
  // Shows the "discard unsaved changes?" guard before an accidental close.
  const [confirmClose, setConfirmClose] = useState(false)
  // The form's values at mount — captured once (lazy init) so we can tell
  // whether the user actually changed anything before warning on close.
  const [initial] = useState(() => ({
    calUid: defaultCalUid,
    summary: ev?.summary ?? '',
    allDay: ev?.allDay ?? initialAllDay ?? false,
    startDate: toDateInput(start0),
    startTime: toTimeInput(start0),
    endDate: toDateInput(end0),
    endTime: toTimeInput(end0),
    location: ev?.location ?? '',
    description: ev?.description ?? '',
    repeat: detectPreset(ev?.rrule),
  }))
  // Undo/redo for the Title — controlled inputs lose the browser's native
  // Ctrl+Z, so clearing the title and undoing wouldn't bring it back.
  const summaryUndo = useUndoableValue(summary, setSummary)
  const [startCalOpen, setStartCalOpen] = useState(false)
  const [endCalOpen, setEndCalOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  // Latest submit() / requestClose(), so the window keydown effect can fire
  // Ctrl/Cmd+Enter and Escape without re-subscribing on every render.
  const submitRef = useRef<() => void>(() => {})
  const requestCloseRef = useRef<() => void>(() => {})
  const startRowRef = useRef<HTMLDivElement>(null)
  const startDateRef = useRef<HTMLInputElement>(null)
  const endRowRef = useRef<HTMLDivElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // While the discard-confirm is up, it owns the keyboard.
      if (confirmClose) return
      // Ctrl/Cmd+Enter confirms the event (create or save) from anywhere in
      // the form — on success the parent closes the composer back to the
      // calendar. A date popover owns plain Enter (pick the cursor day), so
      // skip while one's open.
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (startCalOpen || endCalOpen) return
        e.preventDefault()
        submitRef.current()
        return
      }
      if (e.key === 'Escape') {
        // A date popover swallows its own Escape (to just close itself);
        // don't tear down the whole composer underneath it.
        if (startCalOpen || endCalOpen) return
        e.preventDefault()
        // Warns first when there are unsaved edits (an easy mis-Escape).
        requestCloseRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [startCalOpen, endCalOpen, confirmClose])

  // Returns true when the event passed validation and was handed off to
  // onCreate/onUpdate; false when a validation error blocked it (so callers
  // like the module-switch guard know the save didn't happen).
  const submit = (): boolean => {
    if (!summary.trim()) {
      setLocalErr('Title is required.')
      return false
    }
    const start = fromInputs(startDate, allDay ? '00:00' : startTime)
    let end = fromInputs(endDate, allDay ? '00:00' : endTime)
    if (allDay) {
      // DTEND is exclusive — make it the day after the last day.
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
    }
    if (end.getTime() <= start.getTime() && !allDay) {
      setLocalErr('End must be after start.')
      return false
    }
    setLocalErr(null)
    // Translate the "Repeats" dropdown back into an RRULE string. On
    // create, we either emit an RRULE or omit the field. On edit, the
    // patch field uses null to mean "remove" and undefined to mean
    // "leave whatever was there alone" — that's what lets the user
    // keep a complex BYDAY/COUNT RRULE the dropdown can't represent
    // (Custom stays selected, we send undefined, vevent.ts skips the
    // property entirely).
    // Custom mode emits the freshly-serialised RRULE when the user has
    // actually touched the form OR when the source RRULE was within
    // the editor's expressible subset (so re-saving without edits
    // re-emits an equivalent string). When the source had something
    // the editor can't express AND the user hasn't touched the form,
    // we send `undefined` to leave the stored RRULE alone.
    const customOut =
      customDirty || sourceCustomEditable
        ? serializeCustomRrule(customRrule)
        : undefined
    const presetToRrule: Record<RepeatPreset, string | null | undefined> = {
      none: null,
      daily: 'FREQ=DAILY',
      weekly: 'FREQ=WEEKLY',
      monthly: 'FREQ=MONTHLY',
      yearly: 'FREQ=YEARLY',
      custom: customOut,
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
    return true
  }

  // Did the user actually change anything since mount? `customDirty`
  // covers the custom-RRULE sub-editor (no single value to diff).
  const isDirty = () =>
    calUid !== initial.calUid ||
    summary !== initial.summary ||
    allDay !== initial.allDay ||
    startDate !== initial.startDate ||
    startTime !== initial.startTime ||
    endDate !== initial.endDate ||
    endTime !== initial.endTime ||
    location !== initial.location ||
    description !== initial.description ||
    repeat !== initial.repeat ||
    customDirty

  // Every dismissal path (Esc, backdrop click, Cancel) funnels here: warn
  // before throwing away real edits, but close straight away when the form
  // is untouched so an accidental tap doesn't cost a confirm click.
  const requestClose = () => {
    if (isDirty()) setConfirmClose(true)
    else onClose()
  }

  // Register as the active unsaved-changes guard so a module switch prompts
  // to save/discard this in-progress event instead of dropping it. The ref
  // is refreshed each render so the (stable) registered guard always calls
  // the latest isDirty/submit/onClose.
  const guardRef = useRef<{
    isDirty: () => boolean
    save: () => boolean
    discard: () => void
  }>({
    isDirty: () => false,
    save: () => true,
    discard: () => {},
  })
  useEffect(() => {
    submitRef.current = submit
    requestCloseRef.current = requestClose
    guardRef.current = { isDirty, save: submit, discard: onClose }
  })
  useEffect(() => {
    return registerUnsavedGuard({
      kind: 'event',
      isDirty: () => guardRef.current.isDirty(),
      save: () => guardRef.current.save(),
      discard: () => guardRef.current.discard(),
    })
  }, [])

  // True only when a mouse press STARTED on the backdrop itself. Guards the
  // click-outside-to-close so a text selection that begins inside a field
  // and releases over the backdrop doesn't count as a dismiss click.
  const backdropDownRef = useRef(false)

  const field = 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent'

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New event"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => {
        backdropDownRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Only a click that both started and ended on the backdrop dismisses.
        if (e.target === e.currentTarget && backdropDownRef.current) {
          requestClose()
        }
      }}
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
            spellCheck
            value={summary}
            onChange={(e) => summaryUndo.onChange(e.target.value)}
            onKeyDown={summaryUndo.onKeyDown}
            placeholder="Title"
            className={field}
          />

          <div className="flex items-center gap-3">
            <CalendarSelect
              value={calUid}
              calendars={calendars}
              onChange={setCalUid}
              title={editing ? 'Change calendar to move this event' : undefined}
            />
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
              <div ref={startRowRef} className="relative flex items-center gap-1">
                <input
                  ref={startDateRef}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onKeyDown={(e) =>
                    handleDateArrowMods(e, startDate, setStartDate)
                  }
                  title="Shift+↑/↓ 3 days · Ctrl/Cmd+↑/↓ 7 days · Alt+↑/↓ 1 month · Alt+Shift+↑/↓ 1 year"
                  className={field}
                />
                <button
                  type="button"
                  onClick={() => setStartCalOpen((o) => !o)}
                  aria-label="Open calendar"
                  aria-expanded={startCalOpen}
                  title="Pick a date (arrow keys)"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    startCalOpen
                      ? 'border-accent/40 bg-accent-soft text-text'
                      : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                  }`}
                >
                  <CalendarIcon />
                </button>
                {startCalOpen && (
                  <CalendarPopover
                    value={startDate}
                    ignoreRef={startRowRef}
                    returnFocusRef={startDateRef}
                    onPick={(iso) => {
                      setStartDate(iso)
                      setStartCalOpen(false)
                    }}
                    onClose={() => setStartCalOpen(false)}
                  />
                )}
              </div>
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
              <div ref={endRowRef} className="relative flex items-center gap-1">
                <input
                  ref={endDateRef}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onKeyDown={(e) =>
                    handleDateArrowMods(e, endDate, setEndDate)
                  }
                  title="Shift+↑/↓ 3 days · Ctrl/Cmd+↑/↓ 7 days · Alt+↑/↓ 1 month · Alt+Shift+↑/↓ 1 year"
                  className={field}
                />
                <button
                  type="button"
                  onClick={() => setEndCalOpen((o) => !o)}
                  aria-label="Open calendar"
                  aria-expanded={endCalOpen}
                  title="Pick a date (arrow keys)"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    endCalOpen
                      ? 'border-accent/40 bg-accent-soft text-text'
                      : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                  }`}
                >
                  <CalendarIcon />
                </button>
                {endCalOpen && (
                  <CalendarPopover
                    value={endDate}
                    ignoreRef={endRowRef}
                    returnFocusRef={endDateRef}
                    onPick={(iso) => {
                      setEndDate(iso)
                      setEndCalOpen(false)
                    }}
                    onClose={() => setEndCalOpen(false)}
                  />
                )}
              </div>
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
              onChange={(e) => {
                const next = e.target.value as RepeatPreset
                setRepeat(next)
                // Leaving Custom mode resets the dirty flag so jumping
                // back to it doesn't accidentally overwrite a preserved
                // complex RRULE with a half-edited subset.
                if (next !== 'custom') setCustomDirty(false)
              }}
              aria-label="Repeat frequency"
              className={field}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">
                {sourceHadCustomRrule && !sourceCustomEditable
                  ? 'Custom (preserved)'
                  : 'Custom…'}
              </option>
            </select>
          </label>
          {repeat === 'custom' && (
            <CustomRruleBlock
              value={customRrule}
              onChange={updateCustom}
              onToggleByday={toggleByday}
              preserveOnly={
                sourceHadCustomRrule && !sourceCustomEditable && !customDirty
              }
            />
          )}

          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className={field}
          />
          <textarea
            spellCheck
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
            onClick={requestClose}
            className="ml-auto h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            title="Ctrl/Cmd+Enter"
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
    {confirmClose && (
      <ConfirmModal
        title={editing ? 'Discard your changes?' : 'Discard this event?'}
        body="You have unsaved changes. Close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={onClose}
        onCancel={() => setConfirmClose(false)}
      />
    )}
    </>
  )
}

// Custom RRULE editor — appears beneath the "Repeats" dropdown when
// the user picks Custom. Surface stays small: frequency, interval,
// weekly weekday picker, and a Never / After N / Until DATE
// termination selector. More exotic forms (BYMONTHDAY, BYSETPOS,
// EXDATE) round-trip via the preserve-verbatim path — the dropdown
// label flips to "Custom (preserved)" and `preserveOnly` is true
// here, in which case we render an informational note instead of
// the editing controls.
function CustomRruleBlock({
  value,
  onChange,
  onToggleByday,
  preserveOnly,
}: {
  value: CustomRrule
  onChange: (patch: Partial<CustomRrule>) => void
  onToggleByday: (w: Weekday) => void
  preserveOnly: boolean
}) {
  const field =
    'rounded-md border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent'
  const DAY_LABELS: Record<Weekday, string> = {
    MO: 'Mon',
    TU: 'Tue',
    WE: 'Wed',
    TH: 'Thu',
    FR: 'Fri',
    SA: 'Sat',
    SU: 'Sun',
  }
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-2/50 p-2 text-xs text-text-muted">
      {preserveOnly && (
        <p className="text-[11px] text-text-faint">
          This event has a recurrence rule the editor can't fully
          express (e.g. monthly-by-weekday, BYMONTHDAY). Editing any
          field below will replace it with the new rule.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-text-faint">Every</span>
        <input
          type="number"
          min={1}
          max={99}
          value={value.interval}
          onChange={(e) =>
            onChange({
              interval: Math.max(1, Math.floor(Number(e.target.value) || 1)),
            })
          }
          aria-label="Interval"
          className={`${field} w-16`}
        />
        <select
          value={value.freq}
          onChange={(e) =>
            onChange({ freq: e.target.value as CustomFreq })
          }
          aria-label="Frequency"
          className={`${field} flex-1`}
        >
          <option value="DAILY">
            {value.interval === 1 ? 'day' : 'days'}
          </option>
          <option value="WEEKLY">
            {value.interval === 1 ? 'week' : 'weeks'}
          </option>
          <option value="MONTHLY">
            {value.interval === 1 ? 'month' : 'months'}
          </option>
          <option value="YEARLY">
            {value.interval === 1 ? 'year' : 'years'}
          </option>
        </select>
      </div>

      {value.freq === 'WEEKLY' && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-faint">
            On
          </p>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((w) => {
              const on = value.byday.has(w)
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => onToggleByday(w)}
                  aria-pressed={on}
                  className={togglePill(on)}
                >
                  {DAY_LABELS[w]}
                </button>
              )
            })}
          </div>
          {value.byday.size === 0 && (
            <p className="mt-1 text-[10px] text-text-faint">
              No days picked — defaults to the event's own weekday.
            </p>
          )}
        </div>
      )}

      {value.freq === 'MONTHLY' && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-text-faint">
            On
          </p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.monthlyMode === 'day'}
              onChange={() => onChange({ monthlyMode: 'day' })}
              className="accent-current"
            />
            <span>Day</span>
            <select
              value={value.monthDay}
              onChange={(e) =>
                onChange({
                  monthlyMode: 'day',
                  monthDay: Number(e.target.value),
                })
              }
              aria-label="Day of month"
              className={`${field} w-20`}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="text-text-faint">of the month</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.monthlyMode === 'weekday'}
              onChange={() => onChange({ monthlyMode: 'weekday' })}
              className="accent-current"
            />
            <span>On the…</span>
          </label>
          {value.monthlyMode === 'weekday' && (
            <div className="space-y-1.5 pl-6">
              <div className="flex flex-wrap gap-1">
                {MONTH_POSITIONS.map((p) => {
                  const on = value.monthPositions.has(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        const next = new Set(value.monthPositions)
                        if (next.has(p)) next.delete(p)
                        else next.add(p)
                        if (next.size === 0) return // keep at least one
                        onChange({ monthlyMode: 'weekday', monthPositions: next })
                      }}
                      aria-pressed={on}
                      className={togglePill(on)}
                    >
                      {ordinalLabel(p)}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((w) => {
                  const on = value.monthWeekdays.has(w)
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => {
                        const next = new Set(value.monthWeekdays)
                        if (next.has(w)) next.delete(w)
                        else next.add(w)
                        if (next.size === 0) return // keep at least one
                        onChange({ monthlyMode: 'weekday', monthWeekdays: next })
                      }}
                      aria-pressed={on}
                      className={togglePill(on)}
                    >
                      {DAY_LABELS[w]}
                    </button>
                  )
                })}
              </div>
              {(value.monthPositions.size > 1 ||
                value.monthWeekdays.size > 1) && (
                <p className="text-[10px] text-text-faint">
                  Picks the chosen occurrence(s) counting across the selected
                  weekdays — e.g. all weekdays + “last” = the last weekday of
                  the month.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-text-faint">
          Ends
        </p>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.term === 'never'}
              onChange={() => onChange({ term: 'never' })}
              className="accent-current"
            />
            <span>Never</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.term === 'count'}
              onChange={() => onChange({ term: 'count' })}
              className="accent-current"
            />
            <span>After</span>
            <input
              type="number"
              min={1}
              max={999}
              value={value.count}
              onChange={(e) =>
                onChange({
                  term: 'count',
                  count: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                })
              }
              aria-label="Occurrences"
              className={`${field} w-16`}
            />
            <span>occurrences</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.term === 'until'}
              onChange={() => onChange({ term: 'until' })}
              className="accent-current"
            />
            <span>Until</span>
            <input
              type="date"
              value={value.until}
              onChange={(e) =>
                onChange({ term: 'until', until: e.target.value })
              }
              aria-label="End date"
              className={`${field} flex-1`}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

// Searchable calendar picker replacing the native <select>. Native selects
// only do single-character first-letter typeahead (and inconsistently in
// WebKitGTK), so this offers a seamless search box: type to filter, with
// name-prefix matches floated to the top and the closest match
// highlighted; ↑/↓ move, Enter selects, Esc closes. Falls back to showing
// the full list when the query is empty.
function CalendarSelect({
  value,
  calendars,
  onChange,
  title,
}: {
  value: string
  calendars: CollectionInfo[]
  onChange: (uid: string) => void
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = calendars.find((c) => c.uid === value)
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return calendars
    const starts = calendars.filter((c) => c.name.toLowerCase().startsWith(q))
    const rest = calendars.filter(
      (c) =>
        !c.name.toLowerCase().startsWith(q) &&
        c.name.toLowerCase().includes(q),
    )
    return [...starts, ...rest]
  }, [calendars, q])

  useEffect(() => setActiveIdx(0), [q])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = (uid: string) => {
    onChange(uid)
    setOpen(false)
    setQuery('')
  }
  const swatch = (c: CollectionInfo | undefined) => (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: c?.color ?? 'var(--color-accent)' }}
    />
  )

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open) return
          // Tab here and just start typing: open the picker pre-seeded with
          // the first character so it filters immediately, instead of
          // needing Enter/Space to open first. Space still toggles open
          // (its native button behaviour), and chords are left alone.
          if (
            e.key.length === 1 &&
            e.key !== ' ' &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            e.preventDefault()
            setQuery(e.key)
            setOpen(true)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-left text-sm text-text outline-none focus:border-accent"
      >
        {swatch(current)}
        <span className="truncate">{current?.name ?? 'Select calendar'}</span>
        <span className="ml-auto shrink-0 text-text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-xl">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const c = filtered[activeIdx]
                if (c) choose(c.uid)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                setQuery('')
              }
            }}
            placeholder="Search calendars…"
            className="w-full border-b border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-faint"
          />
          <ul role="listbox" className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-text-faint">
                No matching calendar
              </li>
            ) : (
              filtered.map((c, i) => (
                <li key={c.uid}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.uid === value}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => choose(c.uid)}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                      i === activeIdx
                        ? 'bg-surface-2 text-text'
                        : 'text-text-muted'
                    } ${c.uid === value ? 'font-medium' : ''}`}
                  >
                    {swatch(c)}
                    <span className="truncate">{c.name}</span>
                    {c.uid === value && (
                      <span className="ml-auto shrink-0 text-accent">✓</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
