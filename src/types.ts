export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type TaskStatus =
  | 'NEEDS-ACTION'
  | 'COMPLETED'
  | 'IN-PROCESS'
  | 'CANCELLED'

export interface VTodo {
  uid: string
  summary: string
  description?: string
  status: TaskStatus
  priority: Priority
  due?: string
  created?: string
  lastModified?: string
  parentUid?: string
  categories: string[]
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
}
