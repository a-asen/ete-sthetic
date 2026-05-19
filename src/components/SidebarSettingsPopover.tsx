import { useEffect, useRef } from 'react'

interface SortOpt {
  value: string
  label: string
  hint: string
}

interface Props {
  sortOptions: SortOpt[]
  sortValue: string
  reverse: boolean
  onSort: (value: string) => void
  onToggleReverse: () => void
  showDeleted: boolean
  onToggleShowDeleted: () => void
  onClose: () => void
}

// Settings for the list (sidebar) view — the low-frequency controls
// (sort order, show deleted) pulled out of the crowded sidebar header.
// Per-list actions (rename / recolour / delete) live in the row's
// right-click menu, so they're intentionally not duplicated here.
export function SidebarSettingsPopover({
  sortOptions,
  sortValue,
  reverse,
  onSort,
  onToggleReverse,
  showDeleted,
  onToggleShowDeleted,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="List settings"]')) return
      if (!ref.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="List settings popover"
      className="absolute right-0 top-6 z-30 w-60 rounded-md border border-border bg-surface p-2 shadow-xl"
    >
      <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        Sort lists
      </p>
      <ul className="space-y-0.5">
        {sortOptions.map((opt) => {
          const active = sortValue === opt.value
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onSort(opt.value)}
                className={`flex w-full flex-col rounded-md px-2 py-1 text-left text-sm transition-colors ${
                  active
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-[11px] text-text-faint">
                  {opt.hint}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <label className="mt-1 flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-text-muted">
        <span>Reverse order</span>
        <input
          type="checkbox"
          checked={reverse}
          onChange={onToggleReverse}
          className="h-3.5 w-3.5 accent-accent"
        />
      </label>

      <div className="mt-1 border-t border-border px-2 py-2">
        <label className="flex items-center justify-between gap-2 text-sm text-text-muted">
          <span>Show deleted lists</span>
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={onToggleShowDeleted}
            className="h-3.5 w-3.5 accent-accent"
          />
        </label>
        <p className="mt-1 text-[11px] text-text-faint">
          Tombstones from other clients (read-only cached items).
        </p>
      </div>
    </div>
  )
}
