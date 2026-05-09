import { useEffect, useMemo, useState } from 'react'
import {
  listCollections,
  listTaskItems,
  logout,
} from '../services/etebase'
import { buildTree } from '../services/tree'
import type { CollectionInfo, TaskItem } from '../types'
import { TaskTree } from './TaskTree'

interface Props {
  onLoggedOut: () => void
}

export function MainView({ onLoggedOut }: Props) {
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)
  const [activeUid, setActiveUid] = useState<string | null>(null)

  const [items, setItems] = useState<TaskItem[] | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listCollections()
      .then((cs) => {
        if (cancelled) return
        setCollections(cs)
        if (cs.length > 0) setActiveUid(cs[0].uid)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCollectionsError(
          err instanceof Error ? err.message : 'Failed to load collections',
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeUid) {
      setItems(null)
      return
    }
    let cancelled = false
    setItemsLoading(true)
    setItemsError(null)
    listTaskItems(activeUid)
      .then((data) => {
        if (cancelled) return
        setItems(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setItemsError(
          err instanceof Error ? err.message : 'Failed to load tasks',
        )
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeUid])

  const tree = useMemo(() => (items ? buildTree(items) : []), [items])
  const activeCollection = collections?.find((c) => c.uid === activeUid) ?? null

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  return (
    <div className="flex h-screen bg-bg text-text">
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
                <span className="truncate">{c.name}</span>
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

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-text">
            {activeCollection?.name ?? '—'}
          </h2>
          {itemsLoading && (
            <span className="text-xs text-text-faint">Syncing…</span>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {itemsError && (
            <p className="px-5 py-4 text-sm text-danger">{itemsError}</p>
          )}
          {items === null && !itemsError && itemsLoading && (
            <p className="px-5 py-4 text-sm text-text-faint">Loading tasks…</p>
          )}
          {items && tree.length > 0 && <TaskTree roots={tree} />}
          {items && tree.length === 0 && !itemsError && !itemsLoading && (
            <p className="px-5 py-4 text-sm text-text-faint">
              No tasks in this list.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
