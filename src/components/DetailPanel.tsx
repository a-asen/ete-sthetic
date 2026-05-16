import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Priority, TaskItem, TaskStatus, VTodo } from '../types'
import type { VTodoPatch } from '../services/vtodo'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  task: TaskItem | null
  ancestors: VTodo[]
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
  pending?: boolean
}

interface Draft {
  summary: string
  description: string
  status: TaskStatus
  priority: Priority
  due: string // YYYY-MM-DD or '' (matches <input type="date">)
  categories: string[]
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

function phoneBucket(p: Priority): Priority {
  if (p === 0) return 0
  if (p <= 4) return 1
  if (p === 5) return 5
  return 9
}

// VTODO due strings look like "20260520" (date) or "20260520T140000Z" (datetime).
// Reduce to a YYYY-MM-DD value for <input type="date">.
function dueToInputValue(due: string | undefined): string {
  if (!due) return ''
  const m = due.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return ''
  return `${m[1]}-${m[2]}-${m[3]}`
}

function inputValueToDate(v: string): Date | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function draftFromTask(task: TaskItem): Draft {
  return {
    summary: task.todo.summary,
    description: task.todo.description ?? '',
    status: task.todo.status,
    priority: task.todo.priority,
    due: dueToInputValue(task.todo.due),
    categories: task.todo.categories.slice(),
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function buildPatch(task: TaskItem, draft: Draft): VTodoPatch {
  const patch: VTodoPatch = {}
  if (draft.summary !== task.todo.summary) patch.summary = draft.summary
  if (draft.status !== task.todo.status) patch.status = draft.status
  if (draft.priority !== task.todo.priority) patch.priority = draft.priority
  if (draft.description !== (task.todo.description ?? '')) {
    patch.description = draft.description === '' ? null : draft.description
  }
  const currentDue = dueToInputValue(task.todo.due)
  if (draft.due !== currentDue) {
    patch.due = draft.due === '' ? null : inputValueToDate(draft.due)
  }
  if (!arraysEqual(draft.categories, task.todo.categories)) {
    patch.categories = draft.categories
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

export function DetailPanel({
  task,
  ancestors,
  focused,
  pinned,
  onTogglePin,
  phonePriority,
  onRequestFocus,
  onExit,
  onSave,
  pending = false,
}: Props) {
  // Draft is seeded once per mount. MainView re-keys this component on
  // selected uid change so a different task gets fresh state without an
  // imperative reset effect; in-flight server updates for the same task
  // therefore won't clobber what the user is typing.
  const [draft, setDraft] = useState<Draft | null>(
    task ? draftFromTask(task) : null,
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const summaryRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const statusRef = useRef<HTMLSelectElement>(null)
  const priorityRef = useRef<HTMLSelectElement>(null)
  const dueRef = useRef<HTMLInputElement>(null)
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
  const isDirty = Object.keys(patch).length > 0

  // Blur whatever's focused inside the panel so the global keyboard
  // handlers in MainView / TaskTree can pick up arrow keys again. Without
  // this the caret stays in the title/notes input after Esc and every
  // keystroke gets typed into the field instead of navigating the tree.
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
        e.preventDefault()
        requestExit()
        return
      }
      if (e.key === 'Escape') {
        const target = e.target
        // Let Escape inside the tag input clear it first.
        if (
          target instanceof HTMLInputElement &&
          target.dataset.tagInput === 'true' &&
          target.value !== ''
        ) {
          return
        }
        e.preventDefault()
        requestExit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focused, task, requestExit])

  async function commitSave() {
    if (!task || !draft) {
      setConfirming(false)
      return
    }
    const p = buildPatch(task, draft)
    setSaving(true)
    try {
      await onSave(p)
    } finally {
      setSaving(false)
      setConfirming(false)
      blurInsidePanel()
      onExit()
    }
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function addTagFromInput() {
    const v = tagInput.trim()
    if (!v) return
    if (!draft) return
    if (draft.categories.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setTagInput('')
      return
    }
    update('categories', [...draft.categories, v])
    setTagInput('')
  }

  const collapsedTitle = task?.todo.summary || '(no task selected)'
  // Two display modes:
  //   • pinned: stays w-80 always, just dims + slides slightly on focus loss
  //   • unpinned (default): collapses to a w-10 vertical strip on focus loss
  const showFullPanel = focused || pinned
  const asideClasses = pinned
    ? `w-80 ${focused ? 'opacity-100 translate-x-0' : 'opacity-60 translate-x-1'}`
    : focused
      ? 'w-80 opacity-100'
      : 'w-10 opacity-80'

  return (
    <aside
      data-detail-zone
      onMouseDownCapture={() => {
        if (!focused) onRequestFocus()
      }}
      className={`flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface transition-[width,opacity,transform] duration-300 ease-out ${asideClasses}`}
      aria-expanded={focused}
    >
      {confirming && (
        <ConfirmModal
          title="Save changes?"
          body={
            saving
              ? 'Saving…'
              : 'Ctrl+Enter saves and exits. Esc exits without saving (your edits stay in the draft). Cancel keeps you in the editor.'
          }
          confirmLabel={saving ? 'Saving…' : 'Save'}
          cancelLabel="Cancel"
          onCancel={() => {
            if (!saving) setConfirming(false)
          }}
          onDismiss={() => {
            if (saving) return
            setConfirming(false)
            blurInsidePanel()
            onExit()
          }}
          onConfirm={() => {
            if (!saving) void commitSave()
          }}
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
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
            }}
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

                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                  Title
                </label>
                <input
                  ref={summaryRef}
                  type="text"
                  value={draft.summary}
                  onChange={(e) => update('summary', e.target.value)}
                  onFocus={() => {
                    lastFocusedRef.current = 'summary'
                  }}
                  className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
                />

                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                  Notes
                </label>
                <textarea
                  ref={descriptionRef}
                  value={draft.description}
                  onChange={(e) => update('description', e.target.value)}
                  onFocus={() => {
                    lastFocusedRef.current = 'description'
                  }}
                  rows={6}
                  placeholder="Plain-text description…"
                  className="mt-1 w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong placeholder:text-text-faint"
                />

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                      Status
                    </label>
                    <select
                      ref={statusRef}
                      value={draft.status}
                      onChange={(e) =>
                        update('status', e.target.value as TaskStatus)
                      }
                      onFocus={() => {
                        lastFocusedRef.current = 'status'
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                      Priority
                    </label>
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
                      className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
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

                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                  Due
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={dueRef}
                    type="date"
                    value={draft.due}
                    onChange={(e) => update('due', e.target.value)}
                    onFocus={() => {
                      lastFocusedRef.current = 'due'
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
                  />
                  {draft.due && (
                    <button
                      type="button"
                      onClick={() => update('due', '')}
                      title="Clear due date"
                      className="h-7 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                  Tags
                </label>
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
                    data-tag-input="true"
                    onChange={(e) => setTagInput(e.target.value)}
                    onFocus={() => {
                      lastFocusedRef.current = 'tag'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addTagFromInput()
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
                    onBlur={addTagFromInput}
                    placeholder={
                      draft.categories.length === 0 ? 'Add tag…' : ''
                    }
                    className="min-w-[6rem] flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                  />
                </div>
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
