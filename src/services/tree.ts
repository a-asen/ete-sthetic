import type { TaskItem, TaskNode, TaskSortSpec, VTodo } from '../types'
import { comparatorFor } from './sort'

interface MutableNode extends TaskNode {
  children: MutableNode[]
}

function sortRecursive(
  node: MutableNode,
  cmp: (a: MutableNode, b: MutableNode) => number,
  seen: Set<MutableNode> = new Set(),
) {
  if (seen.has(node)) return // cycle guard — never recurse into a loop
  seen.add(node)
  node.children.sort(cmp)
  for (const child of node.children) sortRecursive(child, cmp, seen)
}

function assignDepth(
  node: MutableNode,
  depth: number,
  seen: Set<MutableNode> = new Set(),
) {
  if (seen.has(node)) return
  seen.add(node)
  node.depth = depth
  for (const child of node.children) assignDepth(child, depth + 1, seen)
}

export function buildTree(
  items: TaskItem[],
  sortSpec?: TaskSortSpec,
): TaskNode[] {
  const cmp = comparatorFor(sortSpec) as (
    a: MutableNode,
    b: MutableNode,
  ) => number

  const byUid = new Map<string, MutableNode>()
  for (const item of items) {
    byUid.set(item.todo.uid, {
      ...item,
      children: [],
      depth: 0,
    })
  }

  // Some clients express the hierarchy the other way round:
  // RELATED-TO;RELTYPE=CHILD on the *parent* listing its children,
  // instead of RELTYPE=PARENT on the child. Derive a child→parent map
  // from those so subtrees still nest (so moving a parent takes its
  // children, and priority sort stays hierarchical).
  const derivedParent = new Map<string, string>()
  for (const node of byUid.values()) {
    for (const link of node.todo.relatedTo ?? []) {
      if (
        link.reltype === 'CHILD' &&
        byUid.has(link.uid) &&
        link.uid !== node.todo.uid &&
        !derivedParent.has(link.uid)
      ) {
        derivedParent.set(link.uid, node.todo.uid)
      }
    }
  }

  // Effective parent: an explicit, resolvable PARENT link wins; else a
  // CHILD-derived one.
  const effectiveParent = (n: MutableNode): string | undefined => {
    const p = n.todo.parentUid
    if (p && byUid.has(p) && p !== n.todo.uid) return p
    const d = derivedParent.get(n.todo.uid)
    if (d && byUid.has(d) && d !== n.todo.uid) return d
    return undefined
  }

  // Break cycles (A→B→A, or PARENT/CHILD disagreeing): a node whose
  // ancestor chain loops back to itself is treated as a root instead.
  const parentOf = new Map<string, string | undefined>()
  for (const node of byUid.values()) {
    parentOf.set(node.todo.uid, effectiveParent(node))
  }
  const safeParent = (uid: string): string | undefined => {
    let cur = parentOf.get(uid)
    const seen = new Set<string>([uid])
    while (cur) {
      if (seen.has(cur)) return undefined // cycle → detach to root
      seen.add(cur)
      cur = parentOf.get(cur)
    }
    return parentOf.get(uid)
  }

  const roots: MutableNode[] = []
  for (const node of byUid.values()) {
    const parentUid = safeParent(node.todo.uid)
    if (parentUid && byUid.has(parentUid)) {
      byUid.get(parentUid)!.children.push(node)
    } else {
      // Parent unknown / self-referential / cyclic → bubble to root.
      roots.push(node)
    }
  }

  roots.sort(cmp)
  for (const root of roots) {
    sortRecursive(root, cmp)
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
  // Parent uids whose subtree has its completed tasks revealed inline
  // despite hideCompleted — the per-branch "show completed" peek. Any
  // node under one of these is kept even when completed.
  revealedBranches?: ReadonlySet<string>
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
// matching tasks so the hierarchy stays navigable. `underRevealed` carries
// down whether an ancestor is a revealed branch — if so, the node is kept
// even when completed (the per-branch "show completed" peek).
export function applyFilter(
  roots: TaskNode[],
  filter: TreeFilter,
): TaskNode[] {
  const terms = filter.search ? parseSearchQuery(filter.search) : []
  const revealed = filter.revealedBranches
  const walk = (node: TaskNode, underRevealed: boolean): TaskNode | null => {
    const revealsChildren =
      underRevealed || (revealed?.has(node.todo.uid) ?? false)
    const filteredChildren = node.children
      .map((c) => walk(c, revealsChildren))
      .filter((c): c is TaskNode => c !== null)
    const isKept =
      underRevealed || (filter.keep?.has(node.todo.uid) ?? false)
    const selfPasses = nodeSelfPasses(node.todo, filter, isKept, terms)
    if (!selfPasses && filteredChildren.length === 0 && !isKept) return null
    return { ...node, children: filteredChildren }
  }
  return roots
    .map((r) => walk(r, false))
    .filter((c): c is TaskNode => c !== null)
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

// Walk parentUid up through the flat items list to produce a breadcrumb
// chain ordered root → … → immediate parent (excluding the task itself).
// Returns [] for a top-level task or an unknown uid. Cycles are tolerated.
export function getAncestorChain(
  items: readonly TaskItem[],
  uid: string,
): VTodo[] {
  const byUid = new Map<string, VTodo>()
  for (const it of items) byUid.set(it.todo.uid, it.todo)
  const chain: VTodo[] = []
  const seen = new Set<string>([uid])
  let parentUid = byUid.get(uid)?.parentUid
  while (parentUid && !seen.has(parentUid)) {
    seen.add(parentUid)
    const parent = byUid.get(parentUid)
    if (!parent) break
    chain.unshift(parent)
    parentUid = parent.parentUid
  }
  return chain
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
