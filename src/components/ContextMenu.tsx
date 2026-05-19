import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface Props {
  menu: ContextMenuState
  onClose: () => void
}

// A small right-click menu: positioned at the cursor (clamped to the
// viewport), keyboard-navigable (↑/↓/Enter/Esc), and dismissed on
// click-away / scroll / another right-click / blur.
export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = menu.items
    .map((it, i) => (it.disabled ? -1 : i))
    .filter((i) => i >= 0)
  const [active, setActive] = useState<number>(enabled[0] ?? -1)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  // Clamp into the viewport once we know the menu's size.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - pad),
      y: Math.min(menu.y, window.innerHeight - height - pad),
    })
  }, [menu.x, menu.y, menu.items])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (enabled.length === 0) return
        const cur = enabled.indexOf(active)
        const delta = e.key === 'ArrowDown' ? 1 : -1
        const next =
          enabled[
            (cur + delta + enabled.length) % enabled.length
          ]
        setActive(next)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = menu.items[active]
        if (item && !item.disabled) {
          onClose()
          item.onSelect()
        }
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
  }, [active, enabled, menu.items, onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-surface py-1 text-sm shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onMouseEnter={() => !it.disabled && setActive(i)}
          onClick={() => {
            if (it.disabled) return
            onClose()
            it.onSelect()
          }}
          className={`flex w-full items-center px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            it.danger ? 'text-danger' : 'text-text-muted'
          } ${
            i === active && !it.disabled
              ? 'bg-surface-2 text-text'
              : 'hover:bg-surface-2'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
