import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
} from 'react'
import { CalendarPopover } from './CalendarPopover'
import {
  addDays,
  addMonths,
  fromIsoDate,
  mondayIndex,
  parseDigits8,
  parseFullDate,
  parseLenientDate,
  startOfDay,
  toIsoDate,
} from '../services/caldate'

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

interface Props {
  // Current value ("YYYY-MM-DD" or '').
  value: string
  onChange: (iso: string) => void
  // Input styling (border/padding/typography). Width comes from the
  // container, the input always flexes to fill it.
  className?: string
  // Sizing/positioning for the field's outer container (e.g. 'flex-1',
  // 'ml-1 w-40'). Default 'flex-1'.
  containerClassName?: string
  // Calendar toggle button size (e.g. 'h-8 w-8' in the composer).
  buttonClassName?: string
  ariaLabel?: string
  // React 19 ref-as-prop — exposes the inner text input (focus/select).
  ref?: Ref<HTMLInputElement>
  onFocus?: () => void
  // Modifier-chord passthrough (e.g. Shift/Ctrl/Alt arrow day-stepping in
  // the event composer). Only called for keys the field doesn't consume.
  onKeyMods?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
}

// Combined type-and-pick date field: a plain text input that parses
// flexible formats (10102026 / 2026-10-14 / 14.10.2026 / 101026 …) plus
// the month-grid CalendarPopover anchored right below it. Clicking (or
// arrow-keying) a day commits it AND closes the popover — no Esc needed —
// and focus stays in the input while the grid is open, so the calendar
// is visible while you type. Replaces the native <input type="date">
// dropdown (WebKitGTK), which doesn't close after picking a day.
export function DateField({
  value,
  onChange,
  className,
  containerClassName,
  buttonClassName,
  ariaLabel,
  onFocus,
  onKeyMods,
  ref,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const ownInputRef = useRef<HTMLInputElement>(null)
  // React 19 ref-as-prop: expose the inner input so parents can focus it
  // (e.g. the detail panel's restore-focus machinery).
  useImperativeHandle(
    ref,
    () => ownInputRef.current as HTMLInputElement,
    [],
  )
  const today = useMemo(() => startOfDay(new Date()), [])
  const [open, setOpen] = useState(false)
  // The grid cursor — the day arrows/Enter act on while the popover is
  // open. Re-seeded from the value each time the popover opens.
  const [cursor, setCursor] = useState<Date>(() => fromIsoDate(value) ?? today)
  // Raw input text. While focused it's what the user typed (possibly
  // incomplete); committed values always normalize to ISO.
  const [text, setText] = useState(value)
  const focusedRef = useRef(false)

  // External value changes (parent state, task switches, …) update the
  // text unless the user is mid-typing here.
  useEffect(() => {
    if (!focusedRef.current) setText(value)
  }, [value])

  // Dismiss on outside mousedown or window blur. Not on scroll: the
  // popover is absolutely positioned inside the scrolling content, so
  // it stays anchored to its field.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', closeFromWindow)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', closeFromWindow)
    }
    function closeFromWindow() {
      setOpen(false)
    }
  }, [open])

  function commit(iso: string, close: boolean) {
    onChange(iso)
    setText(iso)
    if (close) setOpen(false)
  }

  function openFromValue() {
    setCursor(fromIsoDate(value) ?? today)
    setOpen(true)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setText(raw)
    // A complete 8-digit run is unambiguous — commit as soon as the last
    // digit lands so "10102026⏎" becomes "10102026" and the popover
    // closes itself. Anything else (ISO, dotted, 6 digits) commits on
    // Enter/blur so partial input is never committed early.
    const t = raw.trim()
    if (/^\d{8}$/.test(t)) {
      const d = parseDigits8(t)
      if (d) commit(toIsoDate(d), true)
    }
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    focusedRef.current = true
    onFocus?.()
    // Select all so typing replaces the previous date in one go.
    e.target.select()
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    focusedRef.current = false
    const parsed = parseLenientDate(text)
    if (parsed) {
      const iso = toIsoDate(parsed)
      if (iso !== value) commit(iso, false)
      else setText(iso)
    } else {
      // Incomplete/invalid — revert to the committed value.
      setText(value)
    }
    // Tabbed away from the whole field → close the popover too. (Clicks
    // inside the popover never blur the input; its buttons swallow
    // mousedown.)
    const rt = e.relatedTarget
    if (!rt || !rootRef.current?.contains(rt as Node)) setOpen(false)
  }

  function nav(d: Date) {
    setCursor(d)
    // Live-preview the cursor day in the input.
    setText(toIsoDate(d))
  }

  // One keyboard brain for the whole field (input + toggle button +
  // popover all bubble here). While the popover is open the grid owns
  // plain arrows / Home/End / PageUp/Down / t; Enter picks; Escape
  // closes (and stops, so outer Esc handlers — detail-panel exit,
  // composer close — don't fire underneath it).
  function handleKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    const k = e.key
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey
    if (open) {
      if (k === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setText(value)
        setOpen(false)
        return
      }
      if (k === 'Enter') {
        // On the toggle button Enter keeps its native meaning (toggle).
        if (e.target !== ownInputRef.current) return
        e.preventDefault()
        const parsed = parseFullDate(text)
        if (parsed && toIsoDate(parsed) !== value) commit(toIsoDate(parsed), true)
        else commit(toIsoDate(cursor), true)
        return
      }
      if (plain && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
        e.preventDefault()
        const delta =
          k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -7 : 7
        nav(addDays(cursor, delta))
        return
      }
      if (k === 'PageUp' || k === 'PageDown') {
        if (e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        nav(addMonths(cursor, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)))
        return
      }
      if (plain && (k === 'Home' || k === 'End')) {
        e.preventDefault()
        nav(addDays(cursor, k === 'Home' ? -mondayIndex(cursor) : 6 - mondayIndex(cursor)))
        return
      }
      if (plain && (k === 't' || k === 'T')) {
        e.preventDefault()
        nav(today)
        return
      }
    } else {
      if (k === 'Enter' && e.target === ownInputRef.current) {
        const parsed = parseFullDate(text)
        if (parsed && toIsoDate(parsed) !== value) {
          e.preventDefault()
          commit(toIsoDate(parsed), false)
        }
        return
      }
    }
    onKeyMods?.(e as ReactKeyboardEvent<HTMLInputElement>)
  }

  const btn = buttonClassName ?? 'h-7 w-7'

  return (
    <div
      ref={rootRef}
      onKeyDown={handleKeyDown}
      className={`relative flex min-w-0 items-center gap-2 ${containerClassName ?? 'flex-1'}`}
    >
      <input
        ref={ownInputRef}
        type="text"
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseDown={() => {
          // Clicking into the field shows the grid alongside the typing
          // part (the native type="date" dropdown replacement).
          if (!open) openFromValue()
        }}
        aria-label={ariaLabel}
        placeholder="YYYY-MM-DD / DDMMYYYY"
        title="Type a date (e.g. 10102026, 2026-10-14, 14.10.2026) or pick from the calendar"
        className={`min-w-0 flex-1 ${
          className ??
          'rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
        }`}
      />
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openFromValue())}
        aria-label="Open calendar"
        aria-expanded={open}
        title="Pick a date"
        className={`flex shrink-0 items-center justify-center rounded-md border transition-colors ${btn} ${
          open
            ? 'border-accent/40 bg-accent-soft text-text'
            : 'border-border text-text-muted hover:border-border-strong hover:text-text'
        }`}
      >
        <CalendarIcon />
      </button>
      {open && (
        <CalendarPopover
          value={value}
          cursor={cursor}
          onCursorChange={setCursor}
          onPick={(d) => commit(toIsoDate(d), true)}
        />
      )}
    </div>
  )
}