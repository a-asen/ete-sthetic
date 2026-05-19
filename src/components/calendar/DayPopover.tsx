import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EventItem } from '../../types'
import type { CalTask } from '../../services/caltasks'

// "+N more" expansion: every event on a given day, anchored at the click.
export function DayPopover({
  day,
  events,
  tasks,
  colorFor,
  x,
  y,
  onOpenEvent,
  onToggleTask,
  onClose,
}: {
  day: Date
  events: EventItem[]
  tasks: CalTask[]
  colorFor: (item: EventItem) => string
  x: number
  y: number
  onOpenEvent: (item: EventItem, coords: { x: number; y: number }) => void
  onToggleTask: (t: CalTask) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

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

  const sorted = [...events].sort((a, b) => {
    if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1
    return (
      (a.event.start?.getTime() ?? 0) - (b.event.start?.getTime() ?? 0)
    )
  })

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={day.toLocaleDateString()}
        onClick={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="absolute flex max-h-80 w-64 flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold text-text">
            {day.toLocaleDateString([], {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-text-faint hover:text-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {sorted.length === 0 && tasks.length === 0 && (
            <div className="px-2 py-3 text-xs text-text-faint">
              Nothing on this day.
            </div>
          )}
          {sorted.map((item) => {
            const ev = item.event
            return (
              <button
                key={item.occId ?? item.itemUid}
                onClick={(e) =>
                  onOpenEvent(item, { x: e.clientX, y: e.clientY })
                }
                className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(item) }}
                />
                <span className="shrink-0 text-text-faint">
                  {ev.allDay
                    ? 'all day'
                    : (ev.start?.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }) ?? '')}
                </span>
                <span className="truncate text-text">
                  {ev.recurring && '↻ '}
                  {ev.summary || '(no title)'}
                </span>
              </button>
            )
          })}
          {tasks.length > 0 && (
            <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
              Tasks
            </div>
          )}
          {tasks.map((t) => {
            const done = t.status === 'COMPLETED'
            return (
              <button
                key={t.itemUid}
                onClick={() => onToggleTask(t)}
                className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2"
              >
                <span className="shrink-0 text-text-muted">
                  {done ? '☑' : '☐'}
                </span>
                <span
                  className={`truncate ${
                    done ? 'text-text-faint line-through' : 'text-text'
                  }`}
                >
                  {t.summary || '(untitled task)'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
