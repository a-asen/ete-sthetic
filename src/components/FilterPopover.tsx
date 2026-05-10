import { useEffect, useRef } from 'react'

export interface FilterSpec {
  hideCompleted: boolean
  search: string
  // Lowercased tag values currently selected. Empty set means no tag filter.
  tags: Set<string>
}

export const DEFAULT_FILTER: FilterSpec = {
  hideCompleted: false,
  search: '',
  tags: new Set(),
}

export function isFilterActive(f: FilterSpec): boolean {
  return f.hideCompleted || f.search.trim() !== '' || f.tags.size > 0
}

interface Props {
  filter: FilterSpec
  onChange: (next: FilterSpec) => void
  onClose: () => void
  // Called when the user "commits" the search (Enter in the search input).
  // The caller typically closes the popover and pulls focus back to the
  // tasks pane so they can navigate the filtered tree right away.
  onSubmit?: () => void
  // Available tag values from the current list (preserved-case for display);
  // selection is matched lowercase against filter.tags.
  availableTags: string[]
  // Increments to request a re-focus of the search input (e.g. Ctrl+F when
  // the popover is already open).
  focusKey?: number
}

export function FilterPopover({
  filter,
  onChange,
  onClose,
  onSubmit,
  availableTags,
  focusKey = 0,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [focusKey])

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
      className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-surface p-3 shadow-xl"
    >
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-text-faint">
          Search
        </span>
        <input
          ref={searchRef}
          type="search"
          placeholder="bird, title::bird, tag::bird, notes::bird"
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit?.()
            }
          }}
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-[10px] leading-tight text-text-faint">
          Space-separated terms combine with{' '}
          <span className="text-text-muted">AND</span>. Scope with{' '}
          <code className="text-text-muted">title::</code>,{' '}
          <code className="text-text-muted">tag::</code>, or{' '}
          <code className="text-text-muted">notes::</code>. Press{' '}
          <kbd className="rounded border border-border-strong bg-surface-2 px-1 font-mono text-[9px]">
            Enter
          </kbd>{' '}
          to apply and return to tasks.
        </p>
      </label>

      {availableTags.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-text-faint">
            Tags
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => {
              const lower = tag.toLowerCase()
              const active = filter.tags.has(lower)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    const next = new Set(filter.tags)
                    if (active) next.delete(lower)
                    else next.add(lower)
                    onChange({ ...filter, tags: next })
                  }}
                  className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'border-accent/50 bg-accent-soft text-text'
                      : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>
      )}

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

      {isFilterActive(filter) && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTER)}
          className="mt-3 w-full border-t border-border pt-2 text-left text-[11px] text-text-faint hover:text-text-muted"
        >
          Reset filters
        </button>
      )}
    </div>
  )
}
