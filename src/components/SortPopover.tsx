import { useEffect, useRef } from 'react'

export interface SortOption<T extends string> {
  value: T
  label: string
  hint: string
}

export interface GenericSortSpec<T extends string> {
  sort: T
  reverse: boolean
}

interface Props<T extends string> {
  title?: string
  options: Array<SortOption<T>>
  spec: GenericSortSpec<T>
  onChange: (next: GenericSortSpec<T>) => void
  onClose: () => void
  // Bumped by the parent every time the user opens via keyboard, so the
  // first radio gets focus on each open (mirrors FilterPopover's
  // focusKey).
  focusKey: number
  // Hint text under the divider; per-list vs global note, etc.
  footer?: string
  // CSS positioning class for the popover. Defaults to anchor it at
  // top-right (good for header buttons that hang off the right side).
  positionClass?: string
}

export function SortPopover<T extends string>({
  title = 'Sort',
  options,
  spec,
  onChange,
  onClose,
  focusKey,
  footer,
  positionClass = 'right-0 top-9',
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [focusKey])

  // Close on outside click or Escape, matching FilterPopover's behaviour.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      className={`absolute z-20 w-64 rounded-md border border-border bg-surface p-3 shadow-xl ${positionClass}`}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        {title}
      </p>
      <ul className="space-y-1">
        {options.map((opt, i) => {
          const active = spec.sort === opt.value
          return (
            <li key={opt.value}>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <input
                  ref={i === 0 ? firstInputRef : undefined}
                  type="radio"
                  name={`sort-${title}`}
                  checked={active}
                  onChange={() =>
                    onChange({ sort: opt.value, reverse: spec.reverse })
                  }
                  className="mt-0.5 h-3 w-3 shrink-0 accent-accent"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-text">{opt.label}</span>
                  <span className="text-[11px] text-text-faint">
                    {opt.hint}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 border-t border-border pt-3">
        <label className="flex items-center justify-between gap-2 text-sm text-text-muted">
          <span>Reverse</span>
          <input
            type="checkbox"
            checked={spec.reverse}
            onChange={(e) =>
              onChange({ sort: spec.sort, reverse: e.target.checked })
            }
            className="h-3.5 w-3.5 accent-accent"
          />
        </label>
      </div>
      {footer && (
        <p className="mt-3 text-[11px] text-text-faint">{footer}</p>
      )}
    </div>
  )
}
