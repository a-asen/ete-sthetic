import { listCollections, listTaskItems } from './etebase'
import { parseICalDate } from './caldate'
import type { TaskItem } from '../types'

// A task surfaced on the calendar: a VTODO that has a DUE date.
export interface CalTask {
  itemUid: string
  colUid: string
  todoUid: string
  summary: string
  status: TaskItem['todo']['status']
  due: Date
}

// Load every task collection's items and keep the ones with a due date.
// Reuses the task data layer wholesale (the "one window" payoff).
export async function loadCalTasks(
  signal?: AbortSignal,
): Promise<CalTask[]> {
  const cols = await listCollections() // defaults to the task type
  const out: CalTask[] = []
  for (const c of cols) {
    if (signal?.aborted) return out
    const res = await listTaskItems(c.uid, { signal })
    for (const it of res.items) {
      if (!it.todo.due) continue
      const due = parseICalDate(it.todo.due)
      if (!due) continue
      out.push({
        itemUid: it.itemUid,
        colUid: c.uid,
        todoUid: it.todo.uid,
        summary: it.todo.summary,
        status: it.todo.status,
        due,
      })
    }
  }
  return out
}
