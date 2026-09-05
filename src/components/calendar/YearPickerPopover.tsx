import { useEffect, useRef, useState } from 'react'

interface Props {
  // The currently-focused year (anchor's year). Highlighted + scrolled into view.
  year: number
  // Pick a year. The caller jumps anchor (+ selected) to Jan 1 of that year
  // (or to the same month/day if the caller prefers — the popover itself
  // only picks the year).
  onPick: (year: number) => void
  onClose: () => void
}

// How many years to render per row / how many rows to show. A 5x6 grid
// covers a 30-year window centered on the current year — enough to
// click-jump a decade or two in either direction without paging, and
// small enough to fit in the toolbar without taking over the screen.
const ROWS = 6
const COLS = 5
const WINDOW = ROWS * COLS // 30

export function YearPickerPopover({ year, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  // Center the 30-year window on the current year. We bias the start so
  // the current year sits in the middle row, then clamp to a sane range.
  const start = year - Math.floor(WINDOW / 2) + Math.floor(COLS / 2)
  const years: number[] = []
  for (let i = 0; i < WINDOW; i++) years.push(start + i)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // Don't close when clicking the title button itself (it toggles).
      if (t.closest('[data-year-picker-toggle]')) return
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
      className="absolute left-0 top-full z-40 mt-1 w-[15rem] rounded-md border border-border bg-surface p-2 shadow-lg"
    >
      <div className="mb-1 text-xs text-text-muted">
        Jump to year
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {years.map((y) => {
          const isCurrent = y === year
          const isHover = hoverYear === y
          return (
            <button
              key={y}
              type="button"
              onMouseEnter={() => setHoverYear(y)}
              onMouseLeave={() => setHoverYear(null)}
              onClick={() => {
                onPick(y)
                onClose()
              }}
              className={`rounded px-1 py-1.5 text-xs ${
                isCurrent
                  ? 'bg-accent-soft text-accent'
                  : isHover
                    ? 'bg-surface-2 text-text'
                    : 'text-text-muted hover:bg-surface-2'
              }`}
            >
              {y}
            </button>
          )
        })}
      </div>
    </div>
  )
}