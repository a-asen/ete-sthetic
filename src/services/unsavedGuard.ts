// A single global "unsaved changes" guard. Any open editor (task detail,
// event composer, contact editor) registers itself here while mounted; App
// consults it before switching modules so a half-finished task / event /
// contact isn't silently dropped.
//
// Only one editor is ever open at a time (one module is mounted, and a
// module shows at most one editor), so a single-slot registry is enough.
// The unregister returned by registerUnsavedGuard clears the slot only if
// it still holds the same guard, so an out-of-order unmount can't wipe a
// newer registration.

export type UnsavedKind = 'task' | 'event' | 'contact'

export interface UnsavedGuard {
  kind: UnsavedKind
  // True when the editor has unsaved changes worth prompting about.
  isDirty: () => boolean
  // Commit the edit. Resolves true when saved (safe to leave), false when
  // it couldn't (e.g. validation blocked it) so the caller stays put.
  save: () => Promise<boolean> | boolean
  // Abandon the in-progress edit (close the editor without saving).
  discard: () => void
}

let current: UnsavedGuard | null = null

export function registerUnsavedGuard(guard: UnsavedGuard): () => void {
  current = guard
  return () => {
    if (current === guard) current = null
  }
}

export function getUnsavedGuard(): UnsavedGuard | null {
  return current
}
