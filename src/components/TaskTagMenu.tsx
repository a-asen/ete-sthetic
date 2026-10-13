import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

interface Props {
  // The highlighted task's row element — the menu anchors below it.
  anchor: HTMLElement
  summary: string
  categories: string[]
  // Distinct tags across the active list, alphabetically sorted.
  availableTags: string[]
  // Full categories replacement per toggle; caller persists optimistically.
  onSetCategories: (next: string[]) => void
  onClose: () => void
}

// Attach/detach tags on the highlighted task. Toggle-a-row immediate
// semantics (no commit button): every change writes `categories` right
// away, and the menu stays open so several tags can be added in one go.
export function TaskTagMenu({
  anchor,
  summary,
  categories,
  availableTags,
  onSetCategories,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const attachedByLower = useMemo(
    () => new Map(categories.map((c) => [c.toLowerCase(), c])),
    [categories],
  )

  const queryLower = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      queryLower
        ? availableTags.filter((t) => t.toLowerCase().includes(queryLower))
        : availableTags,
    [availableTags, queryLower],
  )
  // A non-empty query that isn't a case-insensitive hit on an existing
  // tag offers the typed text as a new tag at the end of the list.
  const hasExact = queryLower
    ? availableTags.some((t) => t.toLowerCase() === queryLower)
    : false
  const newEntry = queryLower && !hasExact ? query.trim() : null
  const options = useMemo(
    () => (newEntry ? [...filtered, newEntry] : filtered),
    [filtered, newEntry],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The active option may fall out of range when the query narrows the
  // list; every consumer clamps through `activeIdx` instead of resetting
  // state in an effect.
  const activeIdx = Math.min(active, options.length - 1)

  // Clamp into the viewport below the anchor row; flip above when it
  // doesn't fit underneath.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const pad = 8
    const x = Math.max(pad, Math.min(rect.left + 16, window.innerWidth - width - pad))
    let y = rect.bottom + 6
    if (y + height > window.innerHeight - pad)
      y = Math.max(pad, rect.top - height - 6)
    setPos({ x, y })
  }, [anchor])

  // Keyboard lives in a capture-phase window listener (same pattern as
  // ContextMenu): the tree's and MainView's bubble-phase handlers must
  // not see the keys the menu owns.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        if (options.length === 0) return
        const cur = Math.min(active, options.length - 1)
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setActive((cur + delta + options.length) % options.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const opt = options[activeIdx]
        if (opt != null) commit(opt)
        return
      }
      if (e.key === 'Backspace' && query === '' && categories.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        drop(categories[categories.length - 1])
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  })

  // Keep the active option in view while arrowing through the list.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, options.length])

  function toggle(tag: string) {
    const lower = tag.toLowerCase()
    if (attachedByLower.has(lower)) {
      drop(tag)
    } else if (!categories.some((c) => c.toLowerCase() === lower)) {
      onSetCategories([...categories, tag])
    }
  }

  function drop(tag: string) {
    const lower = tag.toLowerCase()
    onSetCategories(categories.filter((c) => c.toLowerCase() !== lower))
  }

  // Enter on the free-text entry creates the tag; Enter on an existing
  // option (or an exact typed match) toggles it. Either way the query
  // field clears so the next keystrokes filter fresh.
  function commit(option: string) {
    if (newEntry != null && option === newEntry) {
      onSetCategories([...categories, option])
    } else {
      toggle(option)
    }
    setQuery('')
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Task tags"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      className="fixed z-50 w-64 rounded-md border border-border bg-surface shadow-xl"
    >
      <div className="border-b border-border px-3 py-2">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-text-faint">
          Tags
        </span>
        <span className="block truncate text-xs text-text-muted">{summary}</span>
      </div>
      <div className="p-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Filter or add tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
      </div>
      <div className="max-h-56 overflow-y-auto pb-1">
        {options.length === 0 && (
          <p className="px-3 py-2 text-xs text-text-faint">No matching tags</p>
        )}
        {options.map((opt, i) => {
          const isNew = opt === newEntry && i === options.length - 1
          const isChecked = attachedByLower.has(opt.toLowerCase())
          return (
            <button
              key={isNew ? `new:${opt}` : opt}
              type="button"
              data-active={i === activeIdx}
              onClick={() => commit(opt)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                i === activeIdx
                  ? 'bg-surface-2 text-text'
                  : 'text-text-muted hover:bg-surface-2'
              }`}
            >
              {isNew ? (
                <>
                  <span className="mr-2 text-text-faint">＋</span>
                  <span className="truncate">Add “{opt}”</span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={`mr-2 w-4 shrink-0 text-center ${
                      isChecked ? 'text-accent' : 'text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="truncate">{opt}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}