import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionInfo, EventItem } from '../../types'
import type { IcsImportCandidate } from '../../services/icsImport'

interface Props {
  candidates: IcsImportCandidate[]
  calendars: CollectionInfo[]
  // Per-calendar event arrays for UID-based de-dup. The picker walks
  // these to decide whether each candidate should `createEventRaw` or
  // `replaceEventRaw` the existing item, and surfaces the count in the
  // confirm button so the user knows what's about to happen.
  eventsByCal: Map<string, EventItem[]>
  defaultCalendarUid?: string
  onCancel: () => void
  onConfirm: (target: string, plan: ImportPlanEntry[]) => Promise<void>
}

export interface ImportPlanEntry {
  candidate: IcsImportCandidate
  // null when the UID doesn't already exist in the target calendar
  // (fresh insert); otherwise the existing item's uid to replace.
  replacesItemUid: string | null
}

function formatStart(start: Date | undefined, allDay: boolean): string {
  if (!start) return 'No start time'
  if (allDay) {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  return start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ImportIcsModal({
  candidates,
  calendars,
  eventsByCal,
  defaultCalendarUid,
  onCancel,
  onConfirm,
}: Props) {
  const live = useMemo(
    () => calendars.filter((c) => !c.isDeleted),
    [calendars],
  )
  const [target, setTarget] = useState<string>(() => {
    if (defaultCalendarUid && live.some((c) => c.uid === defaultCalendarUid)) {
      return defaultCalendarUid
    }
    return live[0]?.uid ?? ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // The de-dup plan recomputes when the user picks a different target
  // calendar — replacing in calendar A doesn't mean replacing in B.
  const plan: ImportPlanEntry[] = useMemo(() => {
    const existing = eventsByCal.get(target) ?? []
    const byUid = new Map(existing.map((it) => [it.event.uid, it.itemUid]))
    return candidates.map((c) => ({
      candidate: c,
      replacesItemUid: byUid.get(c.uid) ?? null,
    }))
  }, [candidates, eventsByCal, target])

  const replaceCount = plan.filter((p) => p.replacesItemUid).length
  const insertCount = plan.length - replaceCount

  async function handleConfirm() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(target, plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import calendar invite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-2xl ring-1 ring-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-text">
          {candidates.length === 1
            ? 'Import event'
            : `Import ${candidates.length} events`}
        </h3>

        <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2 p-2 text-xs">
          {plan.map((p, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="truncate text-text">
                {p.candidate.event.summary || '(no title)'}
              </span>
              <span className="text-text-faint">
                {formatStart(
                  p.candidate.event.start,
                  p.candidate.event.allDay,
                )}
                {p.replacesItemUid && (
                  <span className="ml-1.5 rounded-sm bg-accent-soft px-1 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                    Updates existing
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <label className="block text-xs text-text-muted">
          <span className="mb-1 block">Add to</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={submitting || live.length === 0}
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
          >
            {live.length === 0 ? (
              <option value="">No calendars available</option>
            ) : (
              live.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </label>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-[11px] text-text-faint">
            {insertCount} new
            {replaceCount > 0 ? ` · ${replaceCount} updated` : ''}
          </p>
          <div className="flex gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="h-8 rounded-md border border-border px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!target || submitting || candidates.length === 0}
              className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
