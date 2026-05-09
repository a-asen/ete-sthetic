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

// Drop completed nodes whose descendants are also all completed. A completed
// node with at least one open descendant is kept so the descendant remains
// reachable in the tree.
export function filterCompleted(roots: TaskNode[]): TaskNode[] {
  const filterNode = (node: TaskNode): TaskNode | null => {
    const filteredChildren = node.children
      .map(filterNode)
      .filter((c): c is TaskNode => c !== null)
    const isCompleted = node.todo.status === 'COMPLETED'
    if (isCompleted && filteredChildren.length === 0) return null
    return { ...node, children: filteredChildren }
  }
  return roots
    .map(filterNode)
    .filter((c): c is TaskNode => c !== null)
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
