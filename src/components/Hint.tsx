import { useEffect, useState } from 'react'
import {
  HINTS_CHANGED_EVENT,
  dismissHint,
  isHintVisible,
} from '../services/hints'

interface Props {
  id: string
  children: React.ReactNode
  // Visual variant. 'inline' = lightweight text inside its parent
  // (typical empty-state hint); 'card' = bordered surface with a softer
  // background, used for standalone callouts.
  variant?: 'inline' | 'card'
  className?: string
}

// A dismissible discoverability hint. Renders nothing when:
//   - the user has globally toggled hints off in settings, OR
//   - they've previously dismissed THIS specific hint via the × button.
// The component listens for HINTS_CHANGED_EVENT so toggling the global
// switch in the settings popover hides/shows hints live without a reload.
export function Hint({ id, children, variant = 'inline', className }: Props) {
  const [visible, setVisible] = useState(() => isHintVisible(id))

  useEffect(() => {
    const update = () => setVisible(isHintVisible(id))
    window.addEventListener(HINTS_CHANGED_EVENT, update)
    return () => window.removeEventListener(HINTS_CHANGED_EVENT, update)
  }, [id])

  if (!visible) return null

  const base =
    variant === 'card'
      ? 'flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted'
      : 'flex items-start gap-2 text-xs text-text-faint'

  return (
    <div className={className ? `${base} ${className}` : base}>
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        onClick={() => dismissHint(id)}
        aria-label="Dismiss hint"
        title="Dismiss"
        className="shrink-0 text-text-faint hover:text-text"
      >
        ×
      </button>
    </div>
  )
}
