export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type TaskStatus =
  | 'NEEDS-ACTION'
  | 'COMPLETED'
  | 'IN-PROCESS'
  | 'CANCELLED'

export type Classification = 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL'

// A RELATED-TO link that is *not* the parent link (parent drives the tree
// and lives in `parentUid`). reltype is upper-cased; common values are
// CHILD, SIBLING, and the RFC 9253 dependency types (DEPENDS-ON, …).
export interface RelatedLink {
  uid: string
  reltype: string
}

export interface VTodo {
  uid: string
  summary: string
  description?: string
  status: TaskStatus
  priority: Priority
  // Raw VTODO date/date-time strings, e.g. "20260520" or "20260520T140000Z".
  due?: string
  dtStart?: string
  created?: string
  lastModified?: string
  parentUid?: string
  categories: string[]
  // 0–100. Independent of STATUS, though COMPLETED implies 100.
  percentComplete?: number
  url?: string
  location?: string
  geo?: { lat: number; lon: number }
  classification?: Classification
  comment?: string
  resources?: string[]
  relatedTo?: RelatedLink[]
  raw: string
}

export interface TaskItem {
  itemUid: string
  todo: VTodo
}

export interface TaskNode extends TaskItem {
  children: TaskNode[]
  depth: number
}

export interface CollectionInfo {
  uid: string
  name: string
  description?: string
  color?: string
  // True if this collection is a server-side tombstone (deleted in some
  // other client but not yet hard-purged). Only set when the caller
  // explicitly asked for deleted collections.
  isDeleted?: boolean
}

export type TaskSort = 'priority' | 'due' | 'created' | 'summary'

export interface TaskSortSpec {
  sort: TaskSort
  reverse: boolean
}

export const DEFAULT_TASK_SORT: TaskSortSpec = {
  sort: 'created',
  reverse: false,
}
