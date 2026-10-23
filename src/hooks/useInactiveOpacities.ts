import { useEffect, useState } from 'react'
import {
  INACTIVE_OPACITY_CHANGED_EVENT,
  readInactiveOpacity,
  type InactiveScope,
  type InactiveZone,
} from '../services/inactiveOpacity'

// Returns the three inactive-zone opacities (as 0–1 floats, ready to
// drop into a `style={{ opacity: … }}` prop) and re-renders whenever
// any settings popover flips a value. Each module calls this once and
// picks the slot they care about for each pane.

export interface InactiveOpacities {
  sidebar: number
  middle: number
  detail: number
}

function readAll(scope: InactiveScope): InactiveOpacities {
  return {
    sidebar: readInactiveOpacity('sidebar', scope) / 100,
    middle: readInactiveOpacity('middle', scope) / 100,
    detail: readInactiveOpacity('detail', scope) / 100,
  }
}

export function useInactiveOpacities(
  scope: InactiveScope = 'tasks',
): InactiveOpacities {
  const [value, setValue] = useState<InactiveOpacities>(() => readAll(scope))
  useEffect(() => {
    const refresh = () => setValue(readAll(scope))
    window.addEventListener(INACTIVE_OPACITY_CHANGED_EVENT, refresh)
    return () =>
      window.removeEventListener(INACTIVE_OPACITY_CHANGED_EVENT, refresh)
  }, [scope])
  return value
}

// Helper: pick the opacity for a zone given whether it's currently
// active. Active zones are always 100 %; inactive zones return the
// user's preference. Saves a ternary at every call site.
export function opacityFor(
  active: boolean,
  inactivePct: number,
): number {
  return active ? 1 : inactivePct
}

// Re-export for consumers that need the singular reader without
// subscribing (e.g. one-shot reads during initialisation).
export { readInactiveOpacity, type InactiveScope, type InactiveZone }
