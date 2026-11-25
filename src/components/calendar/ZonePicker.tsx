import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveZoneInput, suggestZones } from '../../services/times'

// Type-ahead timezone field with a suggestion list that mixes broad
// aliases ("Pacific Time", "PST", "UTC+02:00 (fixed)", "Seattle") with
// the canonical IANA zones. Selecting a row commits the canonical zone;
// free text is also accepted (an alias or any zone the runtime knows).
export function ZonePicker({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const suggestions = useMemo(() => suggestZones(value), [value])
  const idx = suggestions.length
    ? Math.min(active, suggestions.length - 1)
    : 0

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = (zone: string) => {
    onChange(zone)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = open ? suggestions[idx] : undefined
      if (pick) {
        choose(pick.zone)
        return
      }
      // Free text: canonicalize an alias ("Seattle" → America/…).
      const resolved = resolveZoneInput(value)
      if (resolved && resolved !== value) onChange(resolved)
      setOpen(false)
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li key={s.zone}>
              <button
                type="button"
                role="option"
                aria-selected={i === idx}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s.zone)}
                className={`flex w-full items-baseline justify-between gap-3 px-2 py-1 text-left text-xs transition-colors ${
                  i === idx
                    ? 'bg-surface-2 text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 text-[10px] text-text-faint">
                  {s.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
