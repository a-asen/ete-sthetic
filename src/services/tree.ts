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
  // Lowercased trimmed search query; matches against summary or description.
  search?: string
  // When set and non-empty, a node passes only if it has at least one
  // category in this set (case-insensitive compare upstream).
  tags?: ReadonlySet<string>
  // Uids to force-keep regardless of other filters (used for the
  // recently-completed grace period).
  keep?: ReadonlySet<string>
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
): boolean {
  if (filter.hideCompleted && todo.status === 'COMPLETED' && !isKept) {
    return false
  }
  if (filter.search) {
    const q = filter.search
    const haystack =
      (todo.summary ?? '').toLowerCase() +
      ' ' +
      (todo.description ?? '').toLowerCase()
    if (!haystack.includes(q)) return false
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
  const walk = (node: TaskNode): TaskNode | null => {
    const filteredChildren = node.children
      .map(walk)
      .filter((c): c is TaskNode => c !== null)
    const isKept = filter.keep?.has(node.todo.uid) ?? false
    const selfPasses = nodeSelfPasses(node.todo, filter, isKept)
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
