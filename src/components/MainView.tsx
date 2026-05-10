import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createTask,
  deleteTasks,
  listCollections,
  listTaskItems,
  logout,
  toggleComplete,
  updateTask,
} from '../services/etebase'
import {
  buildTree,
  collectDescendantItemUids,
  countTasks,
  filterCompleted,
} from '../services/tree'
import type { CollectionInfo, TaskItem, TaskNode } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { TaskTree } from './TaskTree'

interface Props {
  onLoggedOut: () => void
}

const HIDE_COMPLETED_KEY = 'ete-stethic.hideCompleted'
const PREFETCH_CONCURRENCY = 4
const HIDE_GRACE_MS = 5000

function readHideCompleted(): boolean {
  try {
    return localStorage.getItem(HIDE_COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHideCompleted(value: boolean) {
  try {
    localStorage.setItem(HIDE_COMPLETED_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage unavailable; not fatal.
  }
}

export function MainView({ onLoggedOut }: Props) {
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)
  const [activeUid, setActiveUid] = useState<string | null>(null)

  const [itemsByUid, setItemsByUid] = useState<Map<string, TaskItem[]>>(
    () => new Map(),
  )
  const [errorByUid, setErrorByUid] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [loadingUids, setLoadingUids] = useState<Set<string>>(() => new Set())

  const [hideCompleted, setHideCompletedState] = useState<boolean>(readHideCompleted)
  const setHideCompleted = useCallback((value: boolean) => {
    setHideCompletedState(value)
    writeHideCompleted(value)
  }, [])

  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pendingItemUids, setPendingItemUids] = useState<Set<string>>(
    () => new Set(),
  )
  const [creating, setCreating] = useState<{ parentUid: string | null } | null>(
    null,
  )
  const [confirmDelete, setConfirmDelete] = useState<{
    node: TaskNode
    descendantCount: number
  } | null>(null)
  // When Hide-done is on, completed tasks linger for HIDE_GRACE_MS before
  // disappearing so a misclicked checkbox can be untoggled.
  const [recentlyCompletedUids, setRecentlyCompletedUids] = useState<
    Set<string>
  >(() => new Set())
  const completionTimers = useRef<Map<string, number>>(new Map())

  const inFlightRef = useRef<Set<string>>(new Set())
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Cleanup any pending completion timers on unmount.
  useEffect(() => {
    const timers = completionTimers.current
    return () => {
      for (const id of timers.values()) clearTimeout(id)
      timers.clear()
    }
  }, [])

  const markRecentlyCompleted = useCallback((uid: string) => {
    setRecentlyCompletedUids((prev) => {
      if (prev.has(uid)) return prev
      const next = new Set(prev)
      next.add(uid)
      return next
    })
    const existing = completionTimers.current.get(uid)
    if (existing) clearTimeout(existing)
    const id = window.setTimeout(() => {
      setRecentlyCompletedUids((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Set(prev)
        next.delete(uid)
        return next
      })
      completionTimers.current.delete(uid)
    }, HIDE_GRACE_MS)
    completionTimers.current.set(uid, id)
  }, [])

  const clearRecentlyCompleted = useCallback((uid: string) => {
    const existing = completionTimers.current.get(uid)
    if (existing) {
      clearTimeout(existing)
      completionTimers.current.delete(uid)
    }
    setRecentlyCompletedUids((prev) => {
      if (!prev.has(uid)) return prev
      const next = new Set(prev)
      next.delete(uid)
      return next
    })
  }, [])

  const fetchCollection = useCallback(async (uid: string) => {
    if (inFlightRef.current.has(uid)) return
    inFlightRef.current.add(uid)
    setLoadingUids((prev) => {
      const next = new Set(prev)
      next.add(uid)
      return next
    })
    try {
      const items = await listTaskItems(uid)
      if (cancelledRef.current) return
      setItemsByUid((prev) => {
        const next = new Map(prev)
        next.set(uid, items)
        return next
      })
      setErrorByUid((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Map(prev)
        next.delete(uid)
        return next
      })
    } catch (err) {
      if (cancelledRef.current) return
      setErrorByUid((prev) => {
        const next = new Map(prev)
        next.set(
          uid,
          err instanceof Error ? err.message : 'Failed to load tasks',
        )
        return next
      })
    } finally {
      inFlightRef.current.delete(uid)
      if (!cancelledRef.current) {
        setLoadingUids((prev) => {
          const next = new Set(prev)
          next.delete(uid)
          return next
        })
      }
    }
  }, [])

  // Load collections on mount.
  useEffect(() => {
    listCollections()
      .then((cs) => {
        if (cancelledRef.current) return
        setCollections(cs)
        if (cs.length > 0) setActiveUid(cs[0].uid)
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return
        setCollectionsError(
          err instanceof Error ? err.message : 'Failed to load collections',
        )
      })
  }, [])

  // Eagerly fetch the active collection whenever it changes.
  useEffect(() => {
    if (!activeUid) return
    if (itemsByUid.has(activeUid)) return
    void fetchCollection(activeUid)
  }, [activeUid, itemsByUid, fetchCollection])

  // After the active collection is loaded, prefetch the rest in parallel
  // with bounded concurrency so sidebar counts can fill in.
  useEffect(() => {
    if (!collections || !activeUid) return
    if (!itemsByUid.has(activeUid)) return

    const remaining = collections
      .map((c) => c.uid)
      .filter((uid) => !itemsByUid.has(uid) && !inFlightRef.current.has(uid))

    if (remaining.length === 0) return

    let cancelled = false
    let i = 0
    const workers = Array.from({ length: PREFETCH_CONCURRENCY }, async () => {
      while (!cancelled) {
        const idx = i++
        if (idx >= remaining.length) break
        await fetchCollection(remaining[idx])
      }
    })
    void Promise.all(workers)
    return () => {
      cancelled = true
    }
  }, [collections, activeUid, itemsByUid, fetchCollection])

  const activeCollection = collections?.find((c) => c.uid === activeUid) ?? null
  const activeItems = activeUid ? itemsByUid.get(activeUid) : undefined
  const activeError = activeUid ? errorByUid.get(activeUid) : undefined
  const activeLoading = activeUid ? loadingUids.has(activeUid) : false

  const fullTree = useMemo(
    () => (activeItems ? buildTree(activeItems) : []),
    [activeItems],
  )
  const visibleTree = useMemo(
    () =>
      hideCompleted
        ? filterCompleted(fullTree, recentlyCompletedUids)
        : fullTree,
    [fullTree, hideCompleted, recentlyCompletedUids],
  )
  const fadingOutUids = useMemo(
    () => (hideCompleted ? recentlyCompletedUids : new Set<string>()),
    [hideCompleted, recentlyCompletedUids],
  )
  const activeCounts = useMemo(
    () => (activeItems ? countTasks(activeItems) : null),
    [activeItems],
  )

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  function replaceCachedItem(
    colUid: string,
    itemUid: string,
    replacement: TaskItem,
  ) {
    setItemsByUid((prev) => {
      const items = prev.get(colUid)
      if (!items) return prev
      const next = new Map(prev)
      next.set(
        colUid,
        items.map((it) => (it.itemUid === itemUid ? replacement : it)),
      )
      return next
    })
  }

  const handleStartCreateRoot = useCallback(() => {
    setCreating({ parentUid: null })
  }, [])

  const handleStartCreateChild = useCallback((parent: TaskNode) => {
    setCreating({ parentUid: parent.todo.uid })
  }, [])

  const handleCancelCreate = useCallback(() => setCreating(null), [])

  const handleConfirmCreate = useCallback(
    async (summary: string) => {
      const cur = creating
      setCreating(null)
      if (!activeUid || !cur) return
      const trimmed = summary.trim()
      if (!trimmed) return
      const colUid = activeUid
      try {
        const newItem = await createTask(
          colUid,
          trimmed,
          cur.parentUid ?? undefined,
        )
        if (cancelledRef.current) return
        setItemsByUid((prev) => {
          const items = prev.get(colUid) ?? []
          const next = new Map(prev)
          next.set(colUid, [...items, newItem])
          return next
        })
      } catch (err) {
        if (cancelledRef.current) return
        setMutationError(
          err instanceof Error ? err.message : 'Failed to create task',
        )
      }
    },
    [activeUid, creating],
  )

  const handleDeleteRequest = useCallback((node: TaskNode) => {
    const descendants = collectDescendantItemUids(node)
    setConfirmDelete({ node, descendantCount: descendants.length - 1 })
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    const target = confirmDelete
    setConfirmDelete(null)
    if (!target || !activeUid) return
    const colUid = activeUid
    const itemUidsToDelete = collectDescendantItemUids(target.node)
    const deleteSet = new Set(itemUidsToDelete)

    setMutationError(null)
    setItemsByUid((prev) => {
      const items = prev.get(colUid)
      if (!items) return prev
      const next = new Map(prev)
      next.set(
        colUid,
        items.filter((it) => !deleteSet.has(it.itemUid)),
      )
      return next
    })

    try {
      await deleteTasks(colUid, itemUidsToDelete)
    } catch (err) {
      if (cancelledRef.current) return
      setMutationError(
        err instanceof Error ? err.message : 'Failed to delete task',
      )
      // Refetch the collection so the cache is consistent again.
      try {
        const refreshed = await listTaskItems(colUid)
        if (cancelledRef.current) return
        setItemsByUid((prev) => {
          const next = new Map(prev)
          next.set(colUid, refreshed)
          return next
        })
      } catch {
        // best effort; leave the optimistic state in place
      }
    }
  }, [activeUid, confirmDelete])

  const handleRenameTask = useCallback(
    async (node: TaskNode, newSummary: string) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = node.itemUid
      const original: TaskItem = { itemUid, todo: node.todo }
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...node.todo, summary: newSummary },
      }
      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)
      try {
        const result = await updateTask(colUid, itemUid, {
          summary: newSummary,
        })
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        setMutationError(
          err instanceof Error ? err.message : 'Failed to rename task',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid],
  )

  const handleToggleComplete = useCallback(
    async (node: TaskNode) => {
      if (!activeUid) return
      const colUid = activeUid
      const itemUid = node.itemUid
      const original: TaskItem = { itemUid, todo: node.todo }
      const nextStatus =
        node.todo.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED'
      const optimistic: TaskItem = {
        itemUid,
        todo: { ...node.todo, status: nextStatus },
      }

      setMutationError(null)
      setPendingItemUids((prev) => {
        const next = new Set(prev)
        next.add(itemUid)
        return next
      })
      replaceCachedItem(colUid, itemUid, optimistic)

      // Grace-period bookkeeping: keep newly-completed tasks visible briefly
      // when Hide-done is on; clear the timer if the user is uncompleting.
      if (nextStatus === 'COMPLETED') {
        markRecentlyCompleted(node.todo.uid)
      } else {
        clearRecentlyCompleted(node.todo.uid)
      }

      try {
        const result = await toggleComplete(colUid, itemUid, node.todo.status)
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, result)
      } catch (err) {
        if (cancelledRef.current) return
        replaceCachedItem(colUid, itemUid, original)
        // Roll back the grace-period state too on failure.
        if (nextStatus === 'COMPLETED') {
          clearRecentlyCompleted(node.todo.uid)
        }
        setMutationError(
          err instanceof Error ? err.message : 'Failed to update task',
        )
      } finally {
        if (!cancelledRef.current) {
          setPendingItemUids((prev) => {
            const next = new Set(prev)
            next.delete(itemUid)
            return next
          })
        }
      }
    },
    [activeUid, markRecentlyCompleted, clearRecentlyCompleted],
  )

  return (
    <div className="flex h-screen bg-bg text-text">
      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.node.todo.summary || '(untitled)'}"?`}
          body={
            confirmDelete.descendantCount > 0
              ? `This will permanently delete this task and ${
                  confirmDelete.descendantCount
                } subtask${confirmDelete.descendantCount === 1 ? '' : 's'}.`
              : 'This will permanently delete this task.'
          }
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-faint">
            Lists
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {collections === null && !collectionsError && (
            <p className="px-2 py-3 text-xs text-text-faint">Loading…</p>
          )}
          {collectionsError && (
            <p className="px-2 py-3 text-xs text-danger">{collectionsError}</p>
          )}
          {collections && collections.length === 0 && (
            <p className="px-2 py-3 text-xs text-text-faint">
              No task lists found.
            </p>
          )}
          {collections?.map((c) => {
            const isActive = c.uid === activeUid
            const items = itemsByUid.get(c.uid)
            const counts = items ? countTasks(items) : null
            const failed = errorByUid.get(c.uid)
            return (
              <button
                key={c.uid}
                type="button"
                onClick={() => setActiveUid(c.uid)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: c.color || 'var(--color-border-strong)' }}
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${
                    isActive ? 'text-text-muted' : 'text-text-faint'
                  }`}
                  title={
                    counts
                      ? `${counts.open} open of ${counts.total}`
                      : failed
                        ? failed
                        : 'Loading…'
                  }
                >
                  {counts ? counts.open : failed ? '!' : '…'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-text-faint hover:text-text-muted"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col overflow-hidden">
        {mutationError && (
          <div
            role="alert"
            className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-md border border-danger/30 bg-surface px-3 py-2 text-xs text-danger shadow-lg"
          >
            <span className="flex-1">{mutationError}</span>
            <button
              type="button"
              onClick={() => setMutationError(null)}
              className="text-text-faint hover:text-text-muted"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="truncate text-sm font-medium text-text">
              {activeCollection?.name ?? '—'}
            </h2>
            {activeCounts && (
              <span className="text-xs tabular-nums text-text-faint">
                {activeCounts.open} open · {activeCounts.total}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeLoading && (
              <span className="text-xs text-text-faint">Syncing…</span>
            )}
            <button
              type="button"
              onClick={handleStartCreateRoot}
              disabled={!activeUid || !activeItems}
              title="Add task (at top of list)"
              aria-label="Add task"
              className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
              <span>Add task</span>
            </button>
            <button
              type="button"
              onClick={() => setHideCompleted(!hideCompleted)}
              aria-pressed={hideCompleted}
              title={
                hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'
              }
              className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
                hideCompleted
                  ? 'border-accent/40 bg-accent-soft text-text'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text'
              }`}
            >
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
                {hideCompleted ? (
                  <>
                    <path d="M2 8s2.5-4.5 6-4.5 6 4.5 6 4.5-2.5 4.5-6 4.5S2 8 2 8z" />
                    <circle cx="8" cy="8" r="2" />
                    <path d="M2.5 13.5l11-11" />
                  </>
                ) : (
                  <>
                    <path d="M2 8s2.5-4.5 6-4.5 6 4.5 6 4.5-2.5 4.5-6 4.5S2 8 2 8z" />
                    <circle cx="8" cy="8" r="2" />
                  </>
                )}
              </svg>
              <span>{hideCompleted ? 'Show done' : 'Hide done'}</span>
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {activeError && (
            <p className="px-5 py-4 text-sm text-danger">{activeError}</p>
          )}
          {!activeError && activeItems === undefined && (
            <p className="px-5 py-4 text-sm text-text-faint">Loading tasks…</p>
          )}
          {!activeError && activeItems && (visibleTree.length > 0 || creating) && (
            <TaskTree
              roots={visibleTree}
              onToggleComplete={handleToggleComplete}
              pendingUids={pendingItemUids}
              creatingParent={creating ? creating.parentUid : undefined}
              onAddChild={handleStartCreateChild}
              onConfirmCreate={handleConfirmCreate}
              onCancelCreate={handleCancelCreate}
              onRenameTask={handleRenameTask}
              onDeleteRequest={handleDeleteRequest}
              fadingUids={fadingOutUids}
            />
          )}
          {!activeError && activeItems && visibleTree.length === 0 && !creating && (
            <p className="px-5 py-4 text-sm text-text-faint">
              {hideCompleted && fullTree.length > 0
                ? 'All tasks completed.'
                : 'No tasks in this list.'}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
