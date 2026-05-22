import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Classification,
  Priority,
  RelatedLink,
  TaskItem,
  TaskStatus,
  VTodo,
} from '../types'
import type { DateValue, VTodoPatch } from '../services/vtodo'
import { CalendarPopover } from './CalendarPopover'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  task: TaskItem | null
  ancestors: VTodo[]
  // Other tasks in the active list — used to resolve dependency links to
  // titles and to offer add candidates.
  allTasks: TaskItem[]
  // CSS zoom factor for this zone (persisted/managed by MainView).
  zoom: number
  focused: boolean
  // When pinned, the panel keeps its full width even when not focused —
  // it just dims and shifts slightly. When unpinned (the default), it
  // collapses to a thin vertical strip when not focused.
  pinned: boolean
  onTogglePin: () => void
  // When true, the priority dropdown collapses to the four buckets that
  // every phone client uses (None/High/Medium/Low) so the value survives
  // a phone round-trip without normalization loss.
  phonePriority: boolean
  onRequestFocus: () => void
  onExit: () => void
  onSave: (patch: VTodoPatch) => Promise<void>
  // Raw-iCal passthrough save, used for `broken` items the normal patch
  // editor can't represent.
  onSaveRaw: (raw: string) => Promise<void>
  // Move to the previous/next task in the visible list while staying in
  // the detail view. Up = -1, Down = +1. If omitted, in-panel arrow
  // navigation is disabled.
  onNavigateTask?: (delta: -1 | 1) => void
  // Resize support. When showing the full panel the parent controls the
  // width (px); a leftward drag on the handle grows the panel.
  focusedWidth?: number
  onResizeStart?: (e: React.MouseEvent) => void
  // True while the drag is in flight — suppresses the width transition.
  isResizing?: boolean
  pending?: boolean
}

interface Draft {
  // Basic
  summary: string
  description: string
  status: TaskStatus
  priority: Priority
  dueDate: string // YYYY-MM-DD or ''
  dueTime: string // HH:MM or ''
  categories: string[]
  // Advanced
  startDate: string
  startTime: string
  percent: string // '' or '0'..'100'
  url: string
  location: string
  geoLat: string
  geoLon: string
  classification: '' | Classification
  comment: string
  resources: string[]
  relatedTo: RelatedLink[]
}

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'NEEDS-ACTION', label: 'Needs action' },
  { value: 'IN-PROCESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 0, label: 'None' },
  { value: 1, label: '1 — Highest' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4 — High' },
  { value: 5, label: '5 — Medium' },
  { value: 6, label: '6 — Low' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9 — Lowest' },
]

// Four-bucket version matching what every mobile client surfaces. Values
// chosen to be the RFC 5545 bucket representatives (1=high, 5=med, 9=low)
// so a phone round-trip is lossless.
const PHONE_PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 0, label: 'None' },
  { value: 1, label: 'High' },
  { value: 5, label: 'Medium' },
  { value: 9, label: 'Low' },
]

const CLASS_OPTIONS: Array<{ value: '' | Classification; label: string }> = [
  { value: '', label: 'Not set' },
  { value: 'PUBLIC', label: 'Public' },
  { value: 'PRIVATE', label: 'Private' },
  { value: 'CONFIDENTIAL', label: 'Confidential' },
]

const ADVANCED_OPEN_KEY = 'ete-stethic.detailAdvancedOpen'

function readAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(ADVANCED_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeAdvancedOpen(open: boolean) {
  try {
    localStorage.setItem(ADVANCED_OPEN_KEY, open ? 'true' : 'false')
  } catch {
    // not fatal
  }
}

function phoneBucket(p: Priority): Priority {
  if (p === 0) return 0
  if (p <= 4) return 1
  if (p === 5) return 5
  return 9
}

// VTODO date/date-time strings: "20260520" (date) or "20260520T140000Z" /
// "20260520T140000" (date-time). Split into <input type="date"> and
// <input type="time"> values; an empty time means "date-only".
function splitIcalDateTime(raw: string | undefined): {
  date: string
  time: string
} {
  if (!raw) return { date: '', time: '' }
  const m = raw.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/,
  )
  if (!m) return { date: '', time: '' }
  const date = `${m[1]}-${m[2]}-${m[3]}`
  const time = m[4] != null ? `${m[4]}:${m[5]}` : ''
  return { date, time }
}

// Combine the date + (optional) time inputs into a DateValue, or null if
// the date is empty. hasTime drives date-only vs date-time serialization.
function toDateValue(dateStr: string, timeStr: string): DateValue | null {
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dm) return null
  const y = Number(dm[1])
  const mo = Number(dm[2]) - 1
  const d = Number(dm[3])
  const tm = timeStr.match(/^(\d{2}):(\d{2})$/)
  const date = tm
    ? new Date(y, mo, d, Number(tm[1]), Number(tm[2]), 0)
    : new Date(y, mo, d)
  if (Number.isNaN(date.getTime())) return null
  return { date, hasTime: tm != null }
}

function draftFromTask(task: TaskItem): Draft {
  const t = task.todo
  const due = splitIcalDateTime(t.due)
  const start = splitIcalDateTime(t.dtStart)
  return {
    summary: t.summary,
    description: t.description ?? '',
    status: t.status,
    priority: t.priority,
    dueDate: due.date,
    dueTime: due.time,
    categories: t.categories.slice(),
    startDate: start.date,
    startTime: start.time,
    percent: t.percentComplete != null ? String(t.percentComplete) : '',
    url: t.url ?? '',
    location: t.location ?? '',
    geoLat: t.geo ? String(t.geo.lat) : '',
    geoLon: t.geo ? String(t.geo.lon) : '',
    classification: t.classification ?? '',
    comment: t.comment ?? '',
    resources: (t.resources ?? []).slice(),
    relatedTo: (t.relatedTo ?? []).map((r) => ({ ...r })),
  }
}

function strArrEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function relEqual(a: RelatedLink[], b: RelatedLink[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].uid !== b[i].uid || a[i].reltype !== b[i].reltype) return false
  }
  return true
}

function buildPatch(task: TaskItem, draft: Draft): VTodoPatch {
  const t = task.todo
  const patch: VTodoPatch = {}
  if (draft.summary !== t.summary) patch.summary = draft.summary
  if (draft.status !== t.status) patch.status = draft.status
  if (draft.priority !== t.priority) patch.priority = draft.priority
  if (draft.description !== (t.description ?? '')) {
    patch.description = draft.description === '' ? null : draft.description
  }

  const curDue = splitIcalDateTime(t.due)
  if (draft.dueDate !== curDue.date || draft.dueTime !== curDue.time) {
    patch.due = draft.dueDate ? toDateValue(draft.dueDate, draft.dueTime) : null
  }
  const curStart = splitIcalDateTime(t.dtStart)
  if (draft.startDate !== curStart.date || draft.startTime !== curStart.time) {
    patch.dtStart = draft.startDate
      ? toDateValue(draft.startDate, draft.startTime)
      : null
  }

  if (!strArrEqual(draft.categories, t.categories)) {
    patch.categories = draft.categories
  }
  if (!strArrEqual(draft.resources, t.resources ?? [])) {
    patch.resources = draft.resources
  }

  const curPct = t.percentComplete != null ? String(t.percentComplete) : ''
  if (draft.percent !== curPct) {
    patch.percentComplete =
      draft.percent === '' ? null : Number(draft.percent)
  }
  if (draft.url !== (t.url ?? '')) patch.url = draft.url === '' ? null : draft.url
  if (draft.location !== (t.location ?? '')) {
    patch.location = draft.location === '' ? null : draft.location
  }
  if (draft.comment !== (t.comment ?? '')) {
    patch.comment = draft.comment === '' ? null : draft.comment
  }
  if (draft.classification !== (t.classification ?? '')) {
    patch.classification = draft.classification === '' ? null : draft.classification
  }

  const curLat = t.geo ? String(t.geo.lat) : ''
  const curLon = t.geo ? String(t.geo.lon) : ''
  if (draft.geoLat !== curLat || draft.geoLon !== curLon) {
    const lat = Number(draft.geoLat)
    const lon = Number(draft.geoLon)
    patch.geo =
      draft.geoLat !== '' &&
      draft.geoLon !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon)
        ? { lat, lon }
        : null
  }

  if (!relEqual(draft.relatedTo, t.relatedTo ?? [])) {
    patch.relatedTo = draft.relatedTo
  }
  return patch
}

type FieldName =
  | 'summary'
  | 'description'
  | 'status'
  | 'priority'
  | 'due'
  | 'tag'

const fieldClass =
  'mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-wider text-text-faint'

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

export function DetailPanel({
  task,
  ancestors,
  allTasks,
  zoom,
  focused,
  pinned,
  onTogglePin,
  phonePriority,
  onRequestFocus,
  onExit,
  onSave,
  onSaveRaw,
  onNavigateTask,
  focusedWidth,
  onResizeStart,
  isResizing = false,
  pending = false,
}: Props) {
  // Draft is seeded once per mount. MainView re-keys this component on
  // selected uid change so a different task gets fresh state without an
  // imperative reset effect; in-flight server updates for the same task
  // therefore won't clobber what the user is typing.
  const [draft, setDraft] = useState<Draft | null>(
    task ? draftFromTask(task) : null,
  )
  // Raw-iCal editor state for `broken` items (seeded once per mount,
  // like draft — MainView re-keys on uid change).
  const broken = task?.todo.broken === true
  const [rawDraft, setRawDraft] = useState(task?.todo.raw ?? '')
  const [savingRaw, setSavingRaw] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [resourceInput, setResourceInput] = useState('')
  const [depQuery, setDepQuery] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(() => readAdvancedOpen())
  // Which date field, if any, has its arrow-key calendar popover open.
  const [dueCalOpen, setDueCalOpen] = useState(false)
  const [startCalOpen, setStartCalOpen] = useState(false)
  const summaryRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const statusRef = useRef<HTMLSelectElement>(null)
  const priorityRef = useRef<HTMLSelectElement>(null)
  const dueRef = useRef<HTMLInputElement>(null)
  const dueRowRef = useRef<HTMLDivElement>(null)
  const startDateRef = useRef<HTMLInputElement>(null)
  const startRowRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<HTMLInputElement>(null)
  // Which field the user last focused inside the panel. Persists across
  // Esc/Ctrl+Enter exits and re-entries so the caret returns to where the
  // user was, not back to the title each time.
  const lastFocusedRef = useRef<FieldName>('summary')

  function refFor(field: FieldName) {
    switch (field) {
      case 'summary':
        return summaryRef
      case 'description':
        return descriptionRef
      case 'status':
        return statusRef
      case 'priority':
        return priorityRef
      case 'due':
        return dueRef
      case 'tag':
        return tagRef
    }
  }

  const toggleAdvanced = useCallback(() => {
    setAdvancedOpen((cur) => {
      const next = !cur
      writeAdvancedOpen(next)
      return next
    })
  }, [])

  // When focus moves into the panel, restore focus to the last-touched
  // field (defaults to summary on first entry). For text fields we also
  // pre-select so typing replaces the existing value.
  useEffect(() => {
    if (!focused) return
    const target = refFor(lastFocusedRef.current).current
    if (!target) return
    target.focus()
    if (
      target instanceof HTMLInputElement &&
      (target.type === 'text' || target.type === 'date')
    ) {
      try {
        target.select()
      } catch {
        // <input type="date"> doesn't support select() in all browsers.
      }
    }
  }, [focused])

  const patch = useMemo(() => {
    if (!task || !draft) return {} as VTodoPatch
    return buildPatch(task, draft)
  }, [task, draft])
  const rawDirty = broken && rawDraft !== (task?.todo.raw ?? '')
  const isDirty = broken
    ? rawDirty
    : Object.keys(patch).length > 0

  // Blur whatever's focused inside the panel so the global keyboard
  // handlers in MainView / TaskTree can pick up arrow keys again.
  const blurInsidePanel = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('[data-detail-zone]')) {
      active.blur()
    }
  }, [])

  const requestExit = useCallback(() => {
    if (isDirty) {
      setConfirming(true)
    } else {
      blurInsidePanel()
      onExit()
    }
  }, [isDirty, onExit, blurInsidePanel])

  // Move to the prev/next task while staying in the detail view. Fires
  // any pending save in the background (mirrors commitSave's save calls
  // but doesn't exit) so navigation stays fluid — no confirm prompt.
  const requestNavigate = useCallback(
    (delta: -1 | 1) => {
      if (!onNavigateTask) return
      if (isDirty && task && draft) {
        if (broken) void onSaveRaw(rawDraft).catch(() => {})
        else void onSave(buildPatch(task, draft))
      }
      blurInsidePanel()
      onNavigateTask(delta)
    },
    [
      onNavigateTask,
      isDirty,
      task,
      draft,
      broken,
      rawDraft,
      onSave,
      onSaveRaw,
      blurInsidePanel,
    ],
  )

  // Local Ctrl+Enter / Ctrl+ArrowLeft / Escape handler while the panel is
  // focused. All three keys go through the same "save/cancel" gate when
  // dirty so the user can't accidentally orphan unsaved edits by leaving.
  useEffect(() => {
    if (!focused || !task) return
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'Enter' || e.key === 'ArrowLeft')
      ) {
        // Ctrl+← is native word-jump inside text fields; don't hijack it
        // there or the user can't move the cursor by word while editing.
        // Ctrl+Enter has no standard editing meaning, so it always exits.
        if (
          e.key === 'ArrowLeft' &&
          (e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement)
        ) {
          return
        }
        e.preventDefault()
        requestExit()
        return
      }
      if (e.key === 'Escape') {
        const target = e.target
        // Let Escape inside a chip input clear it first.
        if (
          target instanceof HTMLInputElement &&
          target.dataset.chipInput === 'true' &&
          target.value !== ''
        ) {
          return
        }
        e.preventDefault()
        requestExit()
        return
      }
      // Prev/next task while staying in details. Ctrl/Cmd+Up/Down works
      // from anywhere (handy from inside a text field too); plain
      // Up/Down only when focus isn't in a text input/textarea so it
      // doesn't fight the cursor.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const delta: -1 | 1 = e.key === 'ArrowUp' ? -1 : 1
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          requestNavigate(delta)
          return
        }
        const t = e.target
        if (
          !(t instanceof HTMLInputElement) &&
          !(t instanceof HTMLTextAreaElement)
        ) {
          e.preventDefault()
          requestNavigate(delta)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focused, task, requestExit, requestNavigate])

  function commitSave() {
    if (!task || !draft) {
      setConfirming(false)
      return
    }
    setConfirming(false)
    blurInsidePanel()
    onExit()
    // Return to the task view immediately; the save runs in the
    // background and the row shows a "saving…" marker (pendingUids /
    // optimistic update are handled by the caller) until it syncs.
    if (broken) {
      void onSaveRaw(rawDraft).catch(() => {})
    } else {
      void onSave(buildPatch(task, draft))
    }
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function addChip(key: 'categories' | 'resources', raw: string) {
    const v = raw.trim()
    if (!v || !draft) return
    const list = draft[key]
    if (list.some((c) => c.toLowerCase() === v.toLowerCase())) return
    update(key, [...list, v])
  }

  const depCandidates = useMemo(() => {
    if (!task) return []
    const q = depQuery.trim().toLowerCase()
    const linked = new Set((draft?.relatedTo ?? []).map((r) => r.uid))
    return allTasks
      .filter(
        (it) =>
          it.todo.uid !== task.todo.uid &&
          !linked.has(it.todo.uid) &&
          (q === '' || it.todo.summary.toLowerCase().includes(q)),
      )
      .slice(0, 6)
  }, [allTasks, task, depQuery, draft?.relatedTo])

  function summaryForUid(uid: string): string {
    return allTasks.find((it) => it.todo.uid === uid)?.todo.summary || uid
  }

  const collapsedTitle = task?.todo.summary || '(no task selected)'
  const showFullPanel = focused || pinned
  // Width: drag-controlled px when expanded, fixed thin strip when
  // collapsed. Class stays w-10 in collapsed mode so we don't conflict
  // with the inline style.
  const asideClasses = !showFullPanel
    ? 'w-10 opacity-60'
    : pinned && !focused
      ? 'opacity-40 translate-x-1'
      : 'opacity-100'
  const widthPx = showFullPanel ? (focusedWidth ?? 320) : undefined

  return (
    <aside
      data-detail-zone
      onMouseDownCapture={() => {
        if (!focused) onRequestFocus()
      }}
      style={{
        zoom,
        ...(widthPx != null ? { width: widthPx } : null),
      }}
      className={`relative flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface ${
        isResizing
          ? 'select-none'
          : 'transition-[width,opacity,transform] duration-300 ease-out'
      } ${asideClasses}`}
      aria-expanded={focused}
    >
      {showFullPanel && onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize detail panel"
          title="Drag to resize"
          className="group absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize"
        >
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-accent/40" />
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title="Save changes?"
          body="Save returns you to the list (it syncs in the background). Esc exits without saving (your edits stay in the draft). Cancel keeps you in the editor."
          confirmLabel="Save"
          cancelLabel="Cancel"
          zoom={zoom}
          onCancel={() => setConfirming(false)}
          onDismiss={() => {
            setConfirming(false)
            blurInsidePanel()
            onExit()
          }}
          onConfirm={commitSave}
        />
      )}
      {!showFullPanel ? (
        <button
          type="button"
          onClick={onRequestFocus}
          title={`Open detail — ${collapsedTitle}`}
          aria-label={`Open detail for ${collapsedTitle}`}
          className="flex h-full w-full flex-col items-center gap-2 px-1 py-3 text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
        >
          <span className="text-xs font-semibold uppercase tracking-wider">
            ‹
          </span>
          <span
            className="mt-1 max-h-[18rem] truncate text-[11px] uppercase tracking-wider"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {collapsedTitle}
          </span>
          {pending && (
            <span className="mt-auto text-[10px] text-text-faint">…</span>
          )}
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-faint">
              Detail
            </span>
            <div className="flex items-center gap-2">
              {pending && (
                <span className="text-[10px] text-text-faint">syncing…</span>
              )}
              <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                title={
                  pinned
                    ? 'Unpin — collapse to a strip when not focused'
                    : 'Pin — keep the panel visible when not focused'
                }
                aria-label={pinned ? 'Unpin detail panel' : 'Pin detail panel'}
                className={`flex h-6 w-6 items-center justify-center rounded-md border text-[11px] transition-colors ${
                  pinned
                    ? 'border-accent/40 bg-accent-soft text-text'
                    : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M10 2l4 4-3 1-2 4-1-1-4 4 0-1-2-2 1 0 4-4-1-1 4-2z" />
                </svg>
              </button>
            </div>
          </div>
          {!task || !draft ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-text-faint">
              Select a task to view and edit its details.
            </div>
          ) : broken ? (
            <>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-text-muted">
                  ⚠ This item's iCal couldn't be parsed, so it's shown
                  read-as-raw. Fix the text below and save to repair it —
                  nothing was lost.
                </div>
                <label className={labelClass}>Raw iCal</label>
                <textarea
                  value={rawDraft}
                  spellCheck={false}
                  onChange={(e) => setRawDraft(e.target.value)}
                  rows={18}
                  className={`${fieldClass} resize-y font-mono text-[12px] leading-snug`}
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <span className="text-[11px] text-text-faint">
                  {rawDraft !== (task.todo.raw ?? '')
                    ? 'Unsaved raw edits'
                    : 'No changes'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRawDraft(task.todo.raw ?? '')}
                    disabled={
                      savingRaw || rawDraft === (task.todo.raw ?? '')
                    }
                    className="h-7 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Revert
                  </button>
                  <button
                    type="button"
                    disabled={
                      savingRaw || rawDraft === (task.todo.raw ?? '')
                    }
                    onClick={() => {
                      setSavingRaw(true)
                      void onSaveRaw(rawDraft)
                        .then(() => {
                          blurInsidePanel()
                          onExit()
                        })
                        .catch(() => {
                          /* error shown by caller */
                        })
                        .finally(() => setSavingRaw(false))
                    }}
                    className="h-7 rounded-md bg-accent px-2 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savingRaw ? 'Saving…' : 'Save raw'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {ancestors.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1 text-[11px] text-text-faint">
                    {ancestors.map((a, i) => (
                      <span key={a.uid} className="flex items-center gap-1">
                        {i > 0 && <span aria-hidden>›</span>}
                        <span
                          className="max-w-[10rem] truncate"
                          title={a.summary}
                        >
                          {a.summary || '(untitled)'}
                        </span>
                      </span>
                    ))}
                    <span aria-hidden className="text-text-faint">
                      ›
                    </span>
                    <span className="text-text-muted">this task</span>
                  </div>
                )}

                {/* ---- Basic ---- */}
                <label className={labelClass}>Title</label>
                <input
                  ref={summaryRef}
                  type="text"
                  value={draft.summary}
                  onChange={(e) => update('summary', e.target.value)}
                  onFocus={() => {
                    lastFocusedRef.current = 'summary'
                  }}
                  className={fieldClass}
                />

                <label className={`mt-3 ${labelClass}`}>Notes</label>
                <textarea
                  ref={descriptionRef}
                  value={draft.description}
                  onChange={(e) => update('description', e.target.value)}
                  onFocus={() => {
                    lastFocusedRef.current = 'description'
                  }}
                  rows={5}
                  placeholder="Plain-text description…"
                  className={`${fieldClass} resize-y placeholder:text-text-faint`}
                />

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Status</label>
                    <select
                      ref={statusRef}
                      value={draft.status}
                      onChange={(e) =>
                        update('status', e.target.value as TaskStatus)
                      }
                      onFocus={() => {
                        lastFocusedRef.current = 'status'
                      }}
                      className={fieldClass}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Priority</label>
                    <select
                      ref={priorityRef}
                      value={
                        phonePriority
                          ? phoneBucket(draft.priority)
                          : draft.priority
                      }
                      onChange={(e) =>
                        update('priority', Number(e.target.value) as Priority)
                      }
                      onFocus={() => {
                        lastFocusedRef.current = 'priority'
                      }}
                      className={fieldClass}
                    >
                      {(phonePriority
                        ? PHONE_PRIORITY_OPTIONS
                        : PRIORITY_OPTIONS
                      ).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className={`mt-3 ${labelClass}`}>Due</label>
                <div
                  ref={dueRowRef}
                  className="relative mt-1 flex items-center gap-2"
                >
                  <input
                    ref={dueRef}
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) => update('dueDate', e.target.value)}
                    onFocus={() => {
                      lastFocusedRef.current = 'due'
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
                  />
                  <button
                    type="button"
                    onClick={() => setDueCalOpen((o) => !o)}
                    aria-label="Open calendar"
                    aria-expanded={dueCalOpen}
                    title="Pick a date (arrow keys)"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      dueCalOpen
                        ? 'border-accent/40 bg-accent-soft text-text'
                        : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                    }`}
                  >
                    <CalendarIcon />
                  </button>
                  <input
                    type="time"
                    value={draft.dueTime}
                    disabled={!draft.dueDate}
                    onChange={(e) => update('dueTime', e.target.value)}
                    className="w-28 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong disabled:opacity-40"
                  />
                  {(draft.dueDate || draft.dueTime) && (
                    <button
                      type="button"
                      onClick={() => {
                        update('dueDate', '')
                        update('dueTime', '')
                      }}
                      title="Clear due date"
                      className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
                    >
                      Clear
                    </button>
                  )}
                  {dueCalOpen && (
                    <CalendarPopover
                      value={draft.dueDate}
                      ignoreRef={dueRowRef}
                      returnFocusRef={dueRef}
                      onPick={(iso) => {
                        update('dueDate', iso)
                        setDueCalOpen(false)
                      }}
                      onClose={() => setDueCalOpen(false)}
                    />
                  )}
                </div>

                <label className={`mt-3 ${labelClass}`}>Tags</label>
                <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
                  {draft.categories.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-text-muted"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            'categories',
                            draft.categories.filter((c) => c !== tag),
                          )
                        }
                        aria-label={`Remove ${tag}`}
                        className="text-text-faint hover:text-text"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    ref={tagRef}
                    type="text"
                    value={tagInput}
                    data-chip-input="true"
                    onChange={(e) => setTagInput(e.target.value)}
                    onFocus={() => {
                      lastFocusedRef.current = 'tag'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addChip('categories', tagInput)
                        setTagInput('')
                      } else if (
                        e.key === 'Backspace' &&
                        tagInput === '' &&
                        draft.categories.length > 0
                      ) {
                        e.preventDefault()
                        update('categories', draft.categories.slice(0, -1))
                      } else if (e.key === 'Escape' && tagInput !== '') {
                        e.preventDefault()
                        setTagInput('')
                      }
                    }}
                    onBlur={() => {
                      addChip('categories', tagInput)
                      setTagInput('')
                    }}
                    placeholder={draft.categories.length === 0 ? 'Add tag…' : ''}
                    className="min-w-[6rem] flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                  />
                </div>

                {/* ---- Advanced ---- */}
                <button
                  type="button"
                  onClick={toggleAdvanced}
                  aria-expanded={advancedOpen}
                  className="mt-4 flex w-full items-center gap-1.5 border-t border-border pt-3 text-[11px] font-semibold uppercase tracking-wider text-text-faint transition-colors hover:text-text-muted"
                >
                  <span
                    aria-hidden
                    className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                  >
                    ▸
                  </span>
                  Advanced
                </button>

                {advancedOpen && (
                  <div className="mt-2 space-y-3">
                    {task.todo.completed &&
                      (() => {
                        const c = splitIcalDateTime(task.todo.completed)
                        if (!c.date) return null
                        return (
                          <div>
                            <label className={labelClass}>Completed</label>
                            <p className="mt-1 text-sm text-text-muted tabular-nums">
                              {c.date}
                              {c.time ? ` · ${c.time} UTC` : ''}
                            </p>
                          </div>
                        )
                      })()}
                    <div>
                      <label className={labelClass}>Start</label>
                      <div
                        ref={startRowRef}
                        className="relative mt-1 flex items-center gap-2"
                      >
                        <input
                          ref={startDateRef}
                          type="date"
                          value={draft.startDate}
                          onChange={(e) =>
                            update('startDate', e.target.value)
                          }
                          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
                        />
                        <button
                          type="button"
                          onClick={() => setStartCalOpen((o) => !o)}
                          aria-label="Open calendar"
                          aria-expanded={startCalOpen}
                          title="Pick a date (arrow keys)"
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                            startCalOpen
                              ? 'border-accent/40 bg-accent-soft text-text'
                              : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                          }`}
                        >
                          <CalendarIcon />
                        </button>
                        <input
                          type="time"
                          value={draft.startTime}
                          disabled={!draft.startDate}
                          onChange={(e) =>
                            update('startTime', e.target.value)
                          }
                          className="w-28 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong disabled:opacity-40"
                        />
                        {(draft.startDate || draft.startTime) && (
                          <button
                            type="button"
                            onClick={() => {
                              update('startDate', '')
                              update('startTime', '')
                            }}
                            title="Clear start date"
                            className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
                          >
                            Clear
                          </button>
                        )}
                        {startCalOpen && (
                          <CalendarPopover
                            value={draft.startDate}
                            ignoreRef={startRowRef}
                            returnFocusRef={startDateRef}
                            onPick={(iso) => {
                              update('startDate', iso)
                              setStartCalOpen(false)
                            }}
                            onClose={() => setStartCalOpen(false)}
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>
                        Progress{' '}
                        <span className="text-text-muted">
                          {draft.percent === '' ? '—' : `${draft.percent}%`}
                        </span>
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={draft.percent === '' ? 0 : Number(draft.percent)}
                          onChange={(e) => update('percent', e.target.value)}
                          className="flex-1 accent-accent"
                        />
                        {draft.percent !== '' && (
                          <button
                            type="button"
                            onClick={() => update('percent', '')}
                            title="Clear progress"
                            className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>URL</label>
                      <input
                        type="url"
                        value={draft.url}
                        onChange={(e) => update('url', e.target.value)}
                        placeholder="https://…"
                        className={`${fieldClass} placeholder:text-text-faint`}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Location</label>
                      <input
                        type="text"
                        value={draft.location}
                        onChange={(e) => update('location', e.target.value)}
                        className={fieldClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Geo (lat, lon)</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          step="any"
                          value={draft.geoLat}
                          onChange={(e) => update('geoLat', e.target.value)}
                          placeholder="lat"
                          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong placeholder:text-text-faint"
                        />
                        <input
                          type="number"
                          step="any"
                          value={draft.geoLon}
                          onChange={(e) => update('geoLon', e.target.value)}
                          placeholder="lon"
                          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong placeholder:text-text-faint"
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Class</label>
                      <select
                        value={draft.classification}
                        onChange={(e) =>
                          update(
                            'classification',
                            e.target.value as '' | Classification,
                          )
                        }
                        className={fieldClass}
                      >
                        {CLASS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>Comment</label>
                      <textarea
                        value={draft.comment}
                        onChange={(e) => update('comment', e.target.value)}
                        rows={3}
                        className={`${fieldClass} resize-y`}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Resources</label>
                      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
                        {draft.resources.map((r) => (
                          <span
                            key={r}
                            className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-text-muted"
                          >
                            {r}
                            <button
                              type="button"
                              onClick={() =>
                                update(
                                  'resources',
                                  draft.resources.filter((x) => x !== r),
                                )
                              }
                              aria-label={`Remove ${r}`}
                              className="text-text-faint hover:text-text"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={resourceInput}
                          data-chip-input="true"
                          onChange={(e) => setResourceInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault()
                              addChip('resources', resourceInput)
                              setResourceInput('')
                            } else if (
                              e.key === 'Backspace' &&
                              resourceInput === '' &&
                              draft.resources.length > 0
                            ) {
                              e.preventDefault()
                              update('resources', draft.resources.slice(0, -1))
                            } else if (
                              e.key === 'Escape' &&
                              resourceInput !== ''
                            ) {
                              e.preventDefault()
                              setResourceInput('')
                            }
                          }}
                          onBlur={() => {
                            addChip('resources', resourceInput)
                            setResourceInput('')
                          }}
                          placeholder={
                            draft.resources.length === 0 ? 'Add resource…' : ''
                          }
                          className="min-w-[6rem] flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Dependencies</label>
                      <div className="mt-1 space-y-1">
                        {draft.relatedTo.map((r) => (
                          <div
                            key={`${r.reltype}:${r.uid}`}
                            className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
                          >
                            <span className="rounded bg-bg px-1 py-0.5 text-[10px] uppercase tracking-wider text-text-faint">
                              {r.reltype}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-text-muted"
                              title={r.uid}
                            >
                              {summaryForUid(r.uid)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                update(
                                  'relatedTo',
                                  draft.relatedTo.filter(
                                    (x) =>
                                      !(
                                        x.uid === r.uid &&
                                        x.reltype === r.reltype
                                      ),
                                  ),
                                )
                              }
                              aria-label="Remove dependency"
                              className="text-text-faint hover:text-text"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <input
                          type="text"
                          value={depQuery}
                          data-chip-input="true"
                          onChange={(e) => setDepQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape' && depQuery !== '') {
                              e.preventDefault()
                              setDepQuery('')
                            }
                          }}
                          placeholder="Link another task (DEPENDS-ON)…"
                          className={`${fieldClass} placeholder:text-text-faint`}
                        />
                        {depQuery.trim() !== '' && depCandidates.length > 0 && (
                          <div className="overflow-hidden rounded-md border border-border">
                            {depCandidates.map((it) => (
                              <button
                                key={it.todo.uid}
                                type="button"
                                onClick={() => {
                                  update('relatedTo', [
                                    ...draft.relatedTo,
                                    {
                                      uid: it.todo.uid,
                                      reltype: 'DEPENDS-ON',
                                    },
                                  ])
                                  setDepQuery('')
                                }}
                                className="block w-full truncate px-2 py-1 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                              >
                                {it.todo.summary || '(untitled)'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <span className="text-[11px] text-text-faint">
                  {isDirty
                    ? `${Object.keys(patch).length} change${
                        Object.keys(patch).length === 1 ? '' : 's'
                      }`
                    : 'No changes'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (task) setDraft(draftFromTask(task))
                      setTagInput('')
                      setResourceInput('')
                      setDepQuery('')
                    }}
                    disabled={!isDirty}
                    className="h-7 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isDirty) setConfirming(true)
                      else {
                        blurInsidePanel()
                        onExit()
                      }
                    }}
                    disabled={!isDirty}
                    className="h-7 rounded-md bg-accent px-2 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Save (Ctrl+Enter)"
                  >
                    Save
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  )
}
