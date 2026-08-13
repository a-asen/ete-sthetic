import { useEffect, useMemo, useRef, useState } from 'react'

interface SectionRef {
  id: string
  label: string
}

interface Props {
  title: string
  // Left-nav entries. Each `id` must match a `data-section-id` attribute
  // somewhere inside `children` — `SettingsSection` already emits this
  // when its `id` prop matches.
  sections: readonly SectionRef[]
  onClose: () => void
  children: React.ReactNode
}

// Full-window settings overlay. Used as the "More settings…" path off
// the per-module settings popovers when the popover gets too dense for
// the small floating frame. Layout: header + left-side hierarchy nav
// (clickable, scrolls the right pane) + scrollable right pane that
// holds the actual section content. Sections inside should be rendered
// with `<SettingsSection forceOpen>` so the left-nav stays the single
// navigation mechanism (collapsing-to-hide defeats it).
export function SettingsWindow({ title, sections, onClose, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  )

  // Esc closes; click on the backdrop closes (the inner card stops
  // propagation so clicking inside the window doesn't dismiss).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Track which section the user is currently looking at so the left
  // nav highlights it. IntersectionObserver fires on every scroll tick;
  // we pick the topmost intersecting section as "active".
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>('[data-section-id]'),
    )
    if (nodes.length === 0) return
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.sectionId
          if (!id) continue
          if (e.isIntersecting) visible.set(id, e.intersectionRatio)
          else visible.delete(id)
        }
        // Topmost visible section wins — use the order in the DOM so
        // the highlight tracks the user's reading position.
        for (const node of nodes) {
          const id = node.dataset.sectionId
          if (id && visible.has(id)) {
            setActiveId(id)
            return
          }
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [children])

  const scrollTo = (id: string) => {
    const root = scrollRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(id)}"]`,
    )
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  const navItems = useMemo(() => sections, [sections])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="flex h-[80vh] w-[min(900px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-border/60">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md px-2 py-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={`${title} sections`}
            className="w-44 shrink-0 overflow-y-auto border-r border-border bg-surface/60 py-2"
          >
            <ul>
              {navItems.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={`flex w-full items-center px-4 py-1.5 text-left text-xs transition-colors ${
                      activeId === s.id
                        ? 'bg-surface-2 font-medium text-text'
                        : 'text-text-muted hover:bg-surface-2 hover:text-text'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
