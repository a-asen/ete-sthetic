import { useEffect, useRef, useState } from 'react'
import type { CollectionInfo } from '../../types'
import type { NewVEventArgs } from '../../services/vevent'

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

export function EventComposer({
  date,
  defaultHour,
  calendars,
  defaultCalUid,
  saving,
  error,
  onCreate,
  onClose,
}: {
  date: Date
  defaultHour?: number
  calendars: CollectionInfo[]
  defaultCalUid: string
  saving: boolean
  error: string | null
  onCreate: (calUid: string, args: NewVEventArgs) => void
  onClose: () => void
}) {
  const start0 = new Date(date)
  start0.setHours(defaultHour ?? 9, 0, 0, 0)
  const end0 = new Date(start0.getTime() + 60 * 60 * 1000)

  const [calUid, setCalUid] = useState(defaultCalUid)
  const [summary, setSummary] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [startDate, setStartDate] = useState(toDateInput(start0))
  const [startTime, setStartTime] = useState(toTimeInput(start0))
  const [endDate, setEndDate] = useState(toDateInput(end0))
  const [endTime, setEndTime] = useState(toTimeInput(end0))
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
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
    onCreate(calUid, {
      summary: summary.trim(),
      start,
      end,
      allDay,
      location: location.trim() || undefined,
      description: description.trim() || undefined,
    })
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
        <h3 className="mb-4 text-sm font-medium text-text">New event</h3>

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
                className={field}
              />
              {!allDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
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
                className={field}
              />
              {!allDay && (
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={`${field} mt-1`}
                />
              )}
            </div>
          </div>

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

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
