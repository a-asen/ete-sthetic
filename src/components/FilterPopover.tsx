import { useEffect, useRef } from 'react'

export interface FilterSpec {
  hideCompleted: boolean
  search: string
}

export const DEFAULT_FILTER: FilterSpec = {
  hideCompleted: false,
  search: '',
}

export function isFilterActive(f: FilterSpec): boolean {
  return f.hideCompleted || f.search.trim() !== ''
}

interface Props {
  filter: FilterSpec
  onChange: (next: FilterSpec) => void
  onClose: () => void
}

export function FilterPopover({ filter, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target
      if (t instanceof Node && ref.current && !ref.current.contains(t)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Filter tasks"
      onClick={(e) => e.stopPropagation()}
      className="absolute right-3 top-full z-20 mt-1 w-72 rounded-md border border-border bg-surface p-3 shadow-xl"
    >
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-text-faint">
          Search
        </span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Filter by title or notes"
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </label>

      <div className="mt-3 border-t border-border pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted hover:text-text">
          <input
            type="checkbox"
            checked={filter.hideCompleted}
            onChange={(e) =>
              onChange({ ...filter, hideCompleted: e.target.checked })
            }
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          <span>Hide completed tasks</span>
        </label>
      </div>

      <p className="mt-3 border-t border-border pt-2 text-[10px] text-text-faint">
        Tag filter coming next. Esc to close.
      </p>
    </div>
  )
}
