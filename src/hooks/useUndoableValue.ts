import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'

// Undo/redo for a *controlled* text input. React controlled inputs reset
// their value on every render, which wipes the browser's own undo buffer
// (so a native Ctrl+Z can't bring back, say, a title the user just
// cleared). This hook keeps a lightweight history alongside the field and
// handles Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y (redo).
//
// Wire it up by routing the input's onChange through the returned
// `onChange` and spreading the returned `onKeyDown`:
//
//   const undo = useUndoableValue(value, setValue)
//   <input value={value}
//          onChange={(e) => undo.onChange(e.target.value)}
//          onKeyDown={undo.onKeyDown} />

// Edits landing within this window of each other collapse into a single
// undo step, so a burst of typing/deleting reverts as one — mirroring how
// native editors coalesce keystrokes rather than undoing char by char.
const COALESCE_MS = 350
const MAX_HISTORY = 200

export function useUndoableValue(
  value: string,
  setValue: (next: string) => void,
): {
  onChange: (next: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  // Past checkpoints (oldest first); future holds undone values for redo.
  const past = useRef<string[]>([])
  const future = useRef<string[]>([])
  const lastEditAt = useRef(0)
  // The latest committed value, read inside the handlers without making
  // them depend on (and churn with) `value`. Synced after commit; event
  // handlers only run post-render, so they always see the current value.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  // Monotonic clock that's safe to call here (Date.now is fine in a DOM
  // event handler); only used for relative coalescing, never persisted.
  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : 0

  const onChange = useCallback(
    (next: string) => {
      if (next === valueRef.current) return
      const t = now()
      // Open a new undo step only at a coalescing boundary; rapid edits
      // ride on the same checkpoint so they revert together.
      if (t - lastEditAt.current > COALESCE_MS) {
        past.current.push(valueRef.current)
        if (past.current.length > MAX_HISTORY) past.current.shift()
      }
      lastEditAt.current = t
      // A fresh edit invalidates any redo branch.
      future.current = []
      setValue(next)
    },
    [setValue],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const z = e.key === 'z' || e.key === 'Z'
      const y = e.key === 'y' || e.key === 'Y'
      const isUndo = z && !e.shiftKey
      const isRedo = (z && e.shiftKey) || y
      if (isUndo) {
        if (past.current.length === 0) return
        e.preventDefault()
        future.current.push(valueRef.current)
        // Force the next edit to open a new checkpoint.
        lastEditAt.current = 0
        setValue(past.current.pop() as string)
      } else if (isRedo) {
        if (future.current.length === 0) return
        e.preventDefault()
        past.current.push(valueRef.current)
        lastEditAt.current = 0
        setValue(future.current.pop() as string)
      }
    },
    [setValue],
  )

  return { onChange, onKeyDown }
}
