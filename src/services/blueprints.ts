import ICAL from 'ical.js'
import type { Blueprint, BlueprintNode, Priority, TaskItem } from '../types'
import type { NewVTodoArgs } from './vtodo'
import { createTasksBatch, listTaskItems } from './etebase'

// Task Blueprints (storage model "B": per-device localStorage).
//
// A blueprint materialises a fresh parent task + nested subtask tree into a
// chosen list on the days its RRULE schedule is active. Two hard rules:
//   1. Only ever spawns for *today* — never back-fills days the app was
//      closed. A missed day is simply skipped.
//   2. Spawns a given (blueprint, day) exactly once, and does NOT resurrect
//      it if the user later deletes/completes today's instance.
// A synced (multi-device) storage model "A" is a future follow-up (TODO).

const STORAGE_KEY = 'ete-sthetic.blueprints'

// Fired after any read/write mutation so open editors re-read.
export const BLUEPRINTS_CHANGED_EVENT = 'ete-sthetic:blueprints-changed'
// Fired after a spawn run that created instances, so an open tasks view can
// refresh the affected lists. detail: { listUids: string[] }.
export const BLUEPRINTS_SPAWNED_EVENT = 'ete-sthetic:blueprints-spawned'

// ---- Storage ------------------------------------------------------------

function isPriority(n: unknown): n is Priority {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9
}

function coerceNode(raw: unknown): BlueprintNode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const key = typeof r.key === 'string' && r.key ? r.key : null
  if (!key) return null
  const children = Array.isArray(r.children)
    ? r.children.map(coerceNode).filter((n): n is BlueprintNode => n !== null)
    : []
  return {
    key,
    title: typeof r.title === 'string' ? r.title : '',
    priority: isPriority(r.priority) ? r.priority : undefined,
    children,
  }
}

function coerceBlueprint(raw: unknown): Blueprint | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : 'Blueprint',
    enabled: r.enabled !== false,
    targetListUid: typeof r.targetListUid === 'string' ? r.targetListUid : '',
    startDate: typeof r.startDate === 'string' ? r.startDate : '',
    rrule: typeof r.rrule === 'string' ? r.rrule : '',
    title: typeof r.title === 'string' ? r.title : '',
    description:
      typeof r.description === 'string' && r.description
        ? r.description
        : undefined,
    priority: isPriority(r.priority) ? r.priority : undefined,
    categories: Array.isArray(r.categories)
      ? r.categories.filter((c): c is string => typeof c === 'string')
      : undefined,
    subtasks: Array.isArray(r.subtasks)
      ? r.subtasks.map(coerceNode).filter((n): n is BlueprintNode => n !== null)
      : [],
    lastSpawnedKey:
      typeof r.lastSpawnedKey === 'string' ? r.lastSpawnedKey : undefined,
  }
}

export function readBlueprints(): Blueprint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(coerceBlueprint)
      .filter((b): b is Blueprint => b !== null)
  } catch {
    return []
  }
}

export function writeBlueprints(list: Blueprint[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent(BLUEPRINTS_CHANGED_EVENT))
  } catch {
    // Quota / disabled storage — the change just won't persist this session.
  }
}

// Upsert a single blueprint by id.
export function saveBlueprint(bp: Blueprint): void {
  const list = readBlueprints()
  const i = list.findIndex((b) => b.id === bp.id)
  if (i >= 0) list[i] = bp
  else list.push(bp)
  writeBlueprints(list)
}

export function deleteBlueprint(id: string): void {
  writeBlueprints(readBlueprints().filter((b) => b.id !== id))
}

// ---- Factories (call from event handlers, not render — uses randomUUID) --

export function newBlueprintNode(): BlueprintNode {
  return { key: crypto.randomUUID(), title: '', children: [] }
}

export function newBlueprint(targetListUid = ''): Blueprint {
  const today = new Date()
  const startDate = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(
    today.getDate(),
  )}`
  return {
    id: crypto.randomUUID(),
    name: 'New blueprint',
    enabled: true,
    targetListUid,
    startDate,
    rrule: 'FREQ=DAILY',
    title: '{weekday} ({iso})',
    subtasks: [],
  }
}

// ---- Date tokens --------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Tokens usable in blueprint titles / description, with a short label for
// the editor's help text. `{iso}` → 2026-07-06, `{weekday}` → Monday, etc.
export const TITLE_TOKENS: readonly { token: string; label: string }[] = [
  { token: '{weekday}', label: 'Monday' },
  { token: '{weekday-short}', label: 'Mon' },
  { token: '{iso}', label: '2026-07-06' },
  { token: '{date}', label: 'locale date' },
  { token: '{day}', label: '06' },
  { token: '{month}', label: 'July' },
  { token: '{month-short}', label: 'Jul' },
  { token: '{month-num}', label: '07' },
  { token: '{year}', label: '2026' },
]

export function applyTokens(template: string, date: Date): string {
  const iso = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`
  const repl: Record<string, string> = {
    weekday: date.toLocaleDateString(undefined, { weekday: 'long' }),
    'weekday-short': date.toLocaleDateString(undefined, { weekday: 'short' }),
    iso,
    date: date.toLocaleDateString(),
    day: pad2(date.getDate()),
    month: date.toLocaleDateString(undefined, { month: 'long' }),
    'month-short': date.toLocaleDateString(undefined, { month: 'short' }),
    'month-num': pad2(date.getMonth() + 1),
    year: String(date.getFullYear()),
  }
  return template.replace(/\{([a-z-]+)\}/gi, (m, k: string) => {
    const key = k.toLowerCase()
    return key in repl ? repl[key] : m
  })
}

// ---- Schedule matching --------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseYmd(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function icalDate(d: Date): ICAL.Time {
  return ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    isDate: true,
  })
}

// Local YYYY-MM-DD key for a date (the "spawned today" idempotency key).
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// True when `date`'s local day is an occurrence of `rrule` anchored at
// `startDate`. An empty rrule is a one-shot: it matches only startDate.
export function isOccurrenceOn(
  rrule: string,
  startDate: string,
  date: Date,
): boolean {
  const start = parseYmd(startDate)
  if (!start) return false
  const target = startOfDay(date).getTime()
  if (target < start.getTime()) return false
  if (!rrule.trim()) return target === start.getTime()

  let recur: ICAL.Recur
  try {
    recur = ICAL.Recur.fromString(rrule)
  } catch {
    return false
  }
  let iter: ICAL.RecurIterator
  try {
    iter = recur.iterator(icalDate(start))
  } catch {
    return false
  }
  let next: ICAL.Time | null
  let steps = 0
  while ((next = iter.next()) && steps++ < 4000) {
    const t = startOfDay(next.toJSDate()).getTime()
    if (t === target) return true
    if (t > target) return false
  }
  return false
}

// ---- Instance building --------------------------------------------------

// Build the VTODO specs (parent first, then subtasks depth-first) for a
// blueprint on a given day. Deterministic per-day uids let a spawn be
// detected/deduped. Every item carries the blueprint markers.
export function buildSpecs(
  bp: Blueprint,
  date: Date,
): { parentUid: string; specs: NewVTodoArgs[] } {
  const dateKey = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(
    date.getDate(),
  )}`
  const parentUid = `bp_${bp.id}_${dateKey}`
  const markers: Record<string, string> = {
    'X-ETE-BLUEPRINT': bp.id,
    'X-ETE-BLUEPRINT-DATE': dateKey,
  }
  const specs: NewVTodoArgs[] = [
    {
      uid: parentUid,
      summary: applyTokens(bp.title, date) || bp.name,
      description: bp.description
        ? applyTokens(bp.description, date)
        : undefined,
      priority: bp.priority,
      categories:
        bp.categories && bp.categories.length > 0 ? bp.categories : undefined,
      extraProps: markers,
    },
  ]
  const walk = (nodes: BlueprintNode[], parent: string, prefix: string) => {
    nodes.forEach((node, i) => {
      const uid = `${parentUid}_${prefix}${i}`
      specs.push({
        uid,
        summary: applyTokens(node.title, date),
        parentUid: parent,
        priority: node.priority,
        extraProps: markers,
      })
      if (node.children.length > 0) walk(node.children, uid, `${prefix}${i}-`)
    })
  }
  walk(bp.subtasks, parentUid, '')
  return { parentUid, specs }
}

// ---- Spawn orchestration ------------------------------------------------

export interface SpawnResult {
  blueprintId: string
  listUid: string
  created: TaskItem[]
}

let inFlight: Promise<SpawnResult[]> | null = null

// Spawn all due blueprints for `now`. Dedupes concurrent calls (launch +
// tasks-module mount can both fire). Idempotent: skips a blueprint already
// spawned today (localStorage key) or already present in the synced list.
export function runBlueprintSpawn(now: Date = new Date()): Promise<SpawnResult[]> {
  if (inFlight) return inFlight
  inFlight = doSpawn(now).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doSpawn(now: Date): Promise<SpawnResult[]> {
  const key = dayKey(now)
  const blueprints = readBlueprints()
  const results: SpawnResult[] = []
  const spawnedLists = new Set<string>()
  const newKeyById = new Map<string, string>()

  for (const bp of blueprints) {
    if (!bp.enabled || !bp.targetListUid) continue
    if (bp.lastSpawnedKey === key) continue
    if (!isOccurrenceOn(bp.rrule, bp.startDate, now)) continue
    try {
      const { parentUid, specs } = buildSpecs(bp, now)
      // Secondary guard: a full sync of the target list catches the case
      // where the localStorage key was cleared but today's instance exists.
      const existing = await listTaskItems(bp.targetListUid)
      const already = existing.items.some((it) => it.todo.uid === parentUid)
      let created: TaskItem[] = []
      if (!already) {
        created = await createTasksBatch(bp.targetListUid, specs)
        spawnedLists.add(bp.targetListUid)
      }
      newKeyById.set(bp.id, key)
      results.push({ blueprintId: bp.id, listUid: bp.targetListUid, created })
    } catch (err) {
      // Leave lastSpawnedKey unset so the next app-open retries.
      console.error('[blueprints] spawn failed for', bp.name, err)
    }
  }

  // Persist the new lastSpawnedKeys, merging onto the freshest stored copy
  // so a concurrent edit to other fields isn't clobbered.
  if (newKeyById.size > 0) {
    const current = readBlueprints()
    for (const b of current) {
      const k = newKeyById.get(b.id)
      if (k) b.lastSpawnedKey = k
    }
    writeBlueprints(current)
  }

  if (spawnedLists.size > 0) {
    window.dispatchEvent(
      new CustomEvent(BLUEPRINTS_SPAWNED_EVENT, {
        detail: { listUids: [...spawnedLists] },
      }),
    )
  }
  return results
}
