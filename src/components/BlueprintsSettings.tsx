import { useEffect, useState } from 'react'
import type { Blueprint, BlueprintNode, CollectionInfo, Priority } from '../types'
import {
  BLUEPRINTS_CHANGED_EVENT,
  TITLE_TOKENS,
  applyTokens,
  deleteBlueprint,
  newBlueprint,
  newBlueprintNode,
  readBlueprints,
  runBlueprintSpawn,
  saveBlueprint,
} from '../services/blueprints'
import { listCollections } from '../services/etebase'
import { humanizeRrule } from '../services/rrule'
import { RecurrenceEditor } from './RecurrenceEditor'
import { SettingsSection } from './SettingsSection'

const fieldClass =
  'mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-wider text-text-faint'

// ---- Immutable subtask-tree helpers ------------------------------------

function mapNode(
  nodes: BlueprintNode[],
  key: string,
  fn: (n: BlueprintNode) => BlueprintNode,
): BlueprintNode[] {
  return nodes.map((n) =>
    n.key === key
      ? fn(n)
      : { ...n, children: mapNode(n.children, key, fn) },
  )
}

function removeNode(nodes: BlueprintNode[], key: string): BlueprintNode[] {
  return nodes
    .filter((n) => n.key !== key)
    .map((n) => ({ ...n, children: removeNode(n.children, key) }))
}

function addChild(
  nodes: BlueprintNode[],
  parentKey: string,
  child: BlueprintNode,
): BlueprintNode[] {
  return nodes.map((n) =>
    n.key === parentKey
      ? { ...n, children: [...n.children, child] }
      : { ...n, children: addChild(n.children, parentKey, child) },
  )
}

// ---- Panel --------------------------------------------------------------

// Settings panel for Task Blueprints: a list of blueprints plus an inline
// editor (name, target list, start date, recurrence, dated title + tokens,
// and a nested subtask tree). Persists to localStorage via the blueprints
// service; the spawn engine runs elsewhere (App on launch / tasks mount).
export function BlueprintsSettings() {
  const [list, setList] = useState<Blueprint[]>(readBlueprints)
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [draft, setDraft] = useState<Blueprint | null>(null)

  useEffect(() => {
    const refresh = () => setList(readBlueprints())
    window.addEventListener(BLUEPRINTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(BLUEPRINTS_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    let alive = true
    listCollections()
      .then((c) => {
        if (alive) setCollections(c)
      })
      .catch(() => {
        // Offline / not signed in — the picker just shows the stored uid.
      })
    return () => {
      alive = false
    }
  }, [])

  const listName = (uid: string) =>
    collections.find((c) => c.uid === uid)?.name ?? '(select a list)'

  const startAdd = () => {
    const firstList = collections[0]?.uid ?? ''
    setDraft(newBlueprint(firstList))
  }

  const startEdit = (bp: Blueprint) => {
    setDraft(structuredClone(bp))
  }

  const toggleEnabled = (bp: Blueprint) => {
    saveBlueprint({ ...bp, enabled: !bp.enabled })
  }

  const handleDelete = (bp: Blueprint) => {
    if (draft?.id === bp.id) setDraft(null)
    deleteBlueprint(bp.id)
  }

  const handleSave = () => {
    if (!draft) return
    saveBlueprint(draft)
    setDraft(null)
    // Materialise today's instance immediately if it's already due, so a
    // freshly-made daily blueprint doesn't wait until the next app open.
    void runBlueprintSpawn()
  }

  return (
    <SettingsSection id="tasks.blueprints" label="Task Blueprints" forceOpen>
      <div className="space-y-3 px-3 py-2">
        <p className="text-[11px] text-text-faint">
          Blueprints create a fresh, day-specific task (with subtasks) into a
          list on the days you choose — only for the current day, and only on
          days you open the app. Missed days are skipped, never back-filled.
        </p>

        {list.length === 0 && !draft && (
          <p className="text-xs text-text-muted">No blueprints yet.</p>
        )}

        <ul className="space-y-1.5">
          {list.map((bp) => (
            <li
              key={bp.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => toggleEnabled(bp)}
                role="switch"
                aria-checked={bp.enabled}
                aria-label={`${bp.name} enabled`}
                className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
                  bp.enabled
                    ? 'border-accent/50 bg-accent-soft'
                    : 'border-border bg-surface'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
                    bp.enabled ? 'left-3 bg-accent' : 'left-0.5 bg-text-faint'
                  }`}
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{bp.name}</p>
                <p className="truncate text-[11px] text-text-faint">
                  {listName(bp.targetListUid)} ·{' '}
                  {bp.rrule ? humanizeRrule(bp.rrule) : `Once on ${bp.startDate}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(bp)}
                className="rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(bp)}
                aria-label={`Delete ${bp.name}`}
                className="rounded-md px-2 py-1 text-xs text-text-faint transition-colors hover:bg-danger-soft hover:text-danger"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        {!draft && (
          <button
            type="button"
            onClick={startAdd}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            + New blueprint
          </button>
        )}

        {draft && (
          <BlueprintEditor
            draft={draft}
            collections={collections}
            onChange={setDraft}
            onSave={handleSave}
            onCancel={() => setDraft(null)}
          />
        )}
      </div>
    </SettingsSection>
  )
}

// ---- Editor -------------------------------------------------------------

function BlueprintEditor({
  draft,
  collections,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Blueprint
  collections: CollectionInfo[]
  onChange: (bp: Blueprint) => void
  onSave: () => void
  onCancel: () => void
}) {
  // A fixed "preview" day so the token preview doesn't re-evaluate new Date()
  // on every render (and to keep render pure).
  const [previewDate] = useState(() => new Date())

  const patch = (p: Partial<Blueprint>) => onChange({ ...draft, ...p })

  const titlePreview = applyTokens(draft.title, previewDate) || draft.name

  return (
    <div className="space-y-3 rounded-lg border border-border-strong bg-surface p-3">
      <div>
        <label className={labelClass}>Name</label>
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className={fieldClass}
          spellCheck
          placeholder="Daily standup"
        />
      </div>

      <div>
        <label className={labelClass}>Task list</label>
        <select
          value={draft.targetListUid}
          onChange={(e) => patch({ targetListUid: e.target.value })}
          className={fieldClass}
        >
          {collections.length === 0 && (
            <option value={draft.targetListUid}>
              {draft.targetListUid || '(no lists available)'}
            </option>
          )}
          {!collections.some((c) => c.uid === draft.targetListUid) &&
            draft.targetListUid && (
              <option value={draft.targetListUid}>(unknown list)</option>
            )}
          {!draft.targetListUid && <option value="">Choose a list…</option>}
          {collections.map((c) => (
            <option key={c.uid} value={c.uid}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>Start date</label>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Priority</label>
          <select
            value={draft.priority ?? 0}
            onChange={(e) =>
              patch({ priority: Number(e.target.value) as Priority })
            }
            className={fieldClass}
          >
            <option value={0}>None</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <RecurrenceEditor
        value={draft.rrule}
        hasAnchor
        onChange={(rrule) => patch({ rrule })}
      />

      <div>
        <label className={labelClass}>Title (dated)</label>
        <input
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          className={fieldClass}
          placeholder="{weekday} ({iso})"
        />
        <p className="mt-1 text-[11px] text-text-faint">
          Preview: <span className="text-text-muted">{titlePreview}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {TITLE_TOKENS.map((t) => (
            <button
              key={t.token}
              type="button"
              onClick={() => patch({ title: draft.title + t.token })}
              title={t.label}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {t.token}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Description (optional)</label>
        <textarea
          value={draft.description ?? ''}
          onChange={(e) =>
            patch({ description: e.target.value || undefined })
          }
          spellCheck
          rows={2}
          className={`${fieldClass} resize-y`}
          placeholder="Supports the same {tokens}"
        />
      </div>

      <div>
        <label className={labelClass}>Subtasks</label>
        <div className="mt-1 space-y-1.5">
          {draft.subtasks.map((node) => (
            <NodeEditor
              key={node.key}
              node={node}
              depth={0}
              onChange={(fn) => patch({ subtasks: mapNode(draft.subtasks, node.key, fn) })}
              onRemove={(key) => patch({ subtasks: removeNode(draft.subtasks, key) })}
              onAddChild={(parentKey) =>
                patch({
                  subtasks: addChild(
                    draft.subtasks,
                    parentKey,
                    newBlueprintNode(),
                  ),
                })
              }
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            patch({ subtasks: [...draft.subtasks, newBlueprintNode()] })
          }
          className="mt-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          + Add subtask
        </button>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.targetListUid || !draft.name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  )
}

// One row in the nested subtask tree. Editing a node re-maps it in place;
// each node can spawn its own children (unlimited depth) and be removed.
function NodeEditor({
  node,
  depth,
  onChange,
  onRemove,
  onAddChild,
}: {
  node: BlueprintNode
  depth: number
  onChange: (fn: (n: BlueprintNode) => BlueprintNode) => void
  onRemove: (key: string) => void
  onAddChild: (parentKey: string) => void
}) {
  return (
    <div
      className="rounded-md border border-border bg-surface-2 p-1.5"
      style={{ marginLeft: depth > 0 ? 12 : 0 }}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={node.title}
          onChange={(e) =>
            onChange((n) => ({ ...n, title: e.target.value }))
          }
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
          placeholder="Subtask title (supports {tokens})"
        />
        <select
          value={node.priority ?? 0}
          onChange={(e) =>
            onChange((n) => ({
              ...n,
              priority: (Number(e.target.value) || undefined) as
                | Priority
                | undefined,
            }))
          }
          aria-label="Subtask priority"
          className="rounded border border-border bg-bg px-1 py-1 text-xs text-text-muted outline-none focus:border-border-strong"
        >
          <option value={0}>–</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onAddChild(node.key)}
          title="Add nested subtask"
          className="rounded px-1.5 py-1 text-xs text-text-faint transition-colors hover:bg-surface hover:text-text"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onRemove(node.key)}
          title="Remove subtask"
          className="rounded px-1.5 py-1 text-xs text-text-faint transition-colors hover:bg-danger-soft hover:text-danger"
        >
          ✕
        </button>
      </div>
      {node.children.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {node.children.map((child) => (
            <NodeEditor
              key={child.key}
              node={child}
              depth={depth + 1}
              onChange={(fn) =>
                onChange((n) => ({
                  ...n,
                  children: mapNode(n.children, child.key, fn),
                }))
              }
              onRemove={(key) =>
                onChange((n) => ({
                  ...n,
                  children: removeNode(n.children, key),
                }))
              }
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}
