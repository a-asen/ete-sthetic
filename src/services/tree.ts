import type { TaskItem, TaskNode } from '../types'

interface MutableNode extends TaskNode {
  children: MutableNode[]
}

function compareSiblings(a: MutableNode, b: MutableNode): number {
  const aTime = a.todo.created ? Date.parse(a.todo.created) : NaN
  const bTime = b.todo.created ? Date.parse(b.todo.created) : NaN
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return aTime - bTime
  }
  return a.todo.summary.localeCompare(b.todo.summary)
}

function sortRecursive(node: MutableNode) {
  node.children.sort(compareSiblings)
  for (const child of node.children) sortRecursive(child)
}

function assignDepth(node: MutableNode, depth: number) {
  node.depth = depth
  for (const child of node.children) assignDepth(child, depth + 1)
}

export function buildTree(items: TaskItem[]): TaskNode[] {
  const byUid = new Map<string, MutableNode>()
  for (const item of items) {
    byUid.set(item.todo.uid, {
      ...item,
      children: [],
      depth: 0,
    })
  }

  const roots: MutableNode[] = []
  for (const node of byUid.values()) {
    const parentUid = node.todo.parentUid
    if (parentUid && byUid.has(parentUid) && parentUid !== node.todo.uid) {
      byUid.get(parentUid)!.children.push(node)
    } else {
      // Orphaned children (parent unknown or self-referential) bubble to root.
      roots.push(node)
    }
  }

  roots.sort(compareSiblings)
  for (const root of roots) {
    sortRecursive(root)
    assignDepth(root, 0)
  }

  return roots
}

export function flattenVisible(
  roots: TaskNode[],
  expanded: ReadonlySet<string>,
): TaskNode[] {
  const out: TaskNode[] = []
  const walk = (nodes: TaskNode[]) => {
    for (const node of nodes) {
      out.push(node)
      if (node.children.length > 0 && expanded.has(node.todo.uid)) {
        walk(node.children)
      }
    }
  }
  walk(roots)
  return out
}

export interface TreeFilter {
  hideCompleted?: boolean
  // Lowercased search query. Plain words match summary / description /
  // categories. Words of the form `<scope>::<value>` restrict to a field:
  //   title::foo   → summary only
  //   tag::foo (or tags::foo) → categories only
  //   notes::foo (or note::foo / description::foo) → description only
  search?: string
  // When set and non-empty, a node passes only if it has at least one
  // category in this set (case-insensitive compare upstream).
  tags?: ReadonlySet<string>
  // Uids to force-keep regardless of other filters (used for the
  // recently-completed grace period).
  keep?: ReadonlySet<string>
}

type SearchScope = 'title' | 'tag' | 'notes' | 'any'
interface SearchTerm {
  scope: SearchScope
  value: string
}

const SCOPE_MAP: Record<string, SearchScope> = {
  title: 'title',
  tag: 'tag',
  tags: 'tag',
  note: 'notes',
  notes: 'notes',
  description: 'notes',
}

function parseSearchQuery(query: string): SearchTerm[] {
  const out: SearchTerm[] = []
  const parts = query.toLowerCase().match(/\S+/g) ?? []
  for (const p of parts) {
    const m = /^([^:]+)::(.+)$/.exec(p)
    if (m) {
      const scope = SCOPE_MAP[m[1]]
      if (scope) {
        out.push({ scope, value: m[2] })
        continue
      }
    }
    out.push({ scope: 'any', value: p })
  }
  return out
}

function termMatches(
  term: SearchTerm,
  todo: {
    summary: string
    description?: string
    categories?: string[]
  },
): boolean {
  const v = term.value
  if (!v) return true
  const summary = (todo.summary ?? '').toLowerCase()
  const description = (todo.description ?? '').toLowerCase()
  const cats = (todo.categories ?? []).map((c) => c.toLowerCase())
  switch (term.scope) {
    case 'title':
      return summary.includes(v)
    case 'tag':
      return cats.some((c) => c.includes(v))
    case 'notes':
      return description.includes(v)
    case 'any':
      return (
        summary.includes(v) ||
        description.includes(v) ||
        cats.some((c) => c.includes(v))
      )
  }
}

function nodeSelfPasses(
  todo: {
    status: string
    summary: string
    description?: string
    categories?: string[]
  },
  filter: TreeFilter,
  isKept: boolean,
  terms: SearchTerm[],
): boolean {
  if (filter.hideCompleted && todo.status === 'COMPLETED' && !isKept) {
    return false
  }
  if (terms.length > 0) {
    if (!terms.every((t) => termMatches(t, todo))) return false
  }
  if (filter.tags && filter.tags.size > 0) {
    const cats = todo.categories ?? []
    const hit = cats.some((c) => filter.tags!.has(c.toLowerCase()))
    if (!hit) return false
  }
  return true
}

// Walk the tree applying the filter. A node is included when it self-passes,
// has a surviving descendant, or is in `keep`. This preserves ancestors of
// matching tasks so the hierarchy stays navigable.
export function applyFilter(
  roots: TaskNode[],
  filter: TreeFilter,
): TaskNode[] {
  const terms = filter.search ? parseSearchQuery(filter.search) : []
  const walk = (node: TaskNode): TaskNode | null => {
    const filteredChildren = node.children
      .map(walk)
      .filter((c): c is TaskNode => c !== null)
    const isKept = filter.keep?.has(node.todo.uid) ?? false
    const selfPasses = nodeSelfPasses(node.todo, filter, isKept, terms)
    if (!selfPasses && filteredChildren.length === 0 && !isKept) return null
    return { ...node, children: filteredChildren }
  }
  return roots.map(walk).filter((c): c is TaskNode => c !== null)
}

// Backwards-compat thin wrapper around applyFilter.
export function filterCompleted(
  roots: TaskNode[],
  keep?: ReadonlySet<string>,
): TaskNode[] {
  return applyFilter(roots, { hideCompleted: true, keep })
}

export function findNodeByUid(
  roots: TaskNode[],
  uid: string,
): TaskNode | null {
  for (const node of roots) {
    if (node.todo.uid === uid) return node
    const inChild = findNodeByUid(node.children, uid)
    if (inChild) return inChild
  }
  return null
}

export function collectDescendantItemUids(node: TaskNode): string[] {
  const out: string[] = []
  const walk = (n: TaskNode) => {
    out.push(n.itemUid)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

export function countTasks(items: { todo: { status: string } }[]): {
  open: number
  total: number
} {
  let open = 0
  for (const item of items) {
    if (item.todo.status !== 'COMPLETED' && item.todo.status !== 'CANCELLED') {
      open++
    }
  }
  return { open, total: items.length }
}
