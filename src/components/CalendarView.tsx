import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EventConflictError,
  createEvent,
  deleteEvent,
  forceUpdateEvent,
  listCalendars,
  listEventItems,
  updateEvent,
} from '../services/etebase'
import type { CollectionInfo, EventItem } from '../types'
import {
  parseVEvent,
  type NewVEventArgs,
  type VEventPatch,
} from '../services/vevent'
import {
  type CalView,
  addDays,
  bucketByDay,
  monthGridDays,
  rangeTitle,
  startOfDay,
  stepAnchor,
  viewDayRange,
} from '../services/caldate'
import { loadCalSnapshot, saveCalSnapshot } from '../services/calsnapshot'
import { getCalMemory, patchCalMemory } from '../services/calstore'
import { MonthGrid } from './calendar/MonthGrid'
import { TimeGrid } from './calendar/TimeGrid'
import { YearGrid } from './calendar/YearGrid'
import { CalendarSidebar } from './calendar/CalendarSidebar'
import { EventComposer } from './calendar/EventComposer'
import { ConflictModal } from './calendar/ConflictModal'
import { EventPopover } from './calendar/EventPopover'

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: '3day', label: '3 days' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

const ACCENT = 'var(--color-accent)'

export function CalendarView() {
  // Seed all state from the process-lifetime memory cache, so switching
  // back into the calendar is instant (no spinner, no refetch).
  const m0 = getCalMemory()
  const [calendars, setCalendars] = useState<CollectionInfo[] | null>(
    () => m0.calendars,
  )
  const [error, setError] = useState<string | null>(null)
  const [eventsByCal, setEventsByCal] = useState<Map<string, EventItem[]>>(
    () => new Map(m0.eventsByCal),
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(m0.hidden))
  const [loadingCount, setLoadingCount] = useState(0)
  const [view, setView] = useState<CalView>(() => m0.view)
  const [anchor, setAnchor] = useState<Date>(() => new Date(m0.anchorMs))
  // Keyboard-focused day (arrow keys move it; the view pages to follow).
  const [selected, setSelected] = useState<Date>(() =>
    startOfDay(new Date(m0.anchorMs)),
  )
  // Composer is either creating (date/hour prefill) or editing an event.
  const [composer, setComposer] = useState<
    | { mode: 'new'; date: Date; hour?: number }
    | { mode: 'edit'; item: EventItem; calUid: string }
    | null
  >(null)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    calUid: string
    itemUid: string
    localRaw: string
    serverRaw: string
  } | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  const [popover, setPopover] = useState<{
    item: EventItem
    calUid: string
    x: number
    y: number
  } | null>(null)
  // stoken per calendar — a ref (not render state); seeded from memory.
  const stokenRef = useRef<Map<string, string>>(new Map(m0.stokenByCal))
  const loadAbort = useRef<AbortController | null>(null)

  // Sync one calendar: start from whatever we already have for it
  // (memory/snapshot), then apply a stoken delta from the server.
  const syncCalendar = useCallback(
    async (uid: string, signal: AbortSignal, seed: EventItem[]) => {
      const acc = new Map(seed.map((e) => [e.itemUid, e]))
      let fromStoken = stokenRef.current.get(uid)
      // Cold (no memory seed): try the disk snapshot for an instant paint
      // and a stoken to delta-sync from.
      if (acc.size === 0 && !fromStoken) {
        const snap = await loadCalSnapshot(uid)
        if (snap && !signal.aborted) {
          for (const e of snap.events) acc.set(e.itemUid, e)
          fromStoken = snap.stoken
          const seeded = [...acc.values()]
          setEventsByCal((prev) => new Map(prev).set(uid, seeded))
        }
      }
      const res = await listEventItems(uid, {
        signal,
        fromStoken,
        onBatch: (batch) => {
          if (signal.aborted) return
          for (const e of batch) acc.set(e.itemUid, e)
          setEventsByCal((prev) =>
            new Map(prev).set(uid, [...acc.values()]),
          )
        },
      })
      if (signal.aborted) return
      for (const removed of res.removed) acc.delete(removed)
      const finalList = [...acc.values()]
      setEventsByCal((prev) => new Map(prev).set(uid, finalList))
      stokenRef.current.set(uid, res.stoken)
      await saveCalSnapshot({
        version: 1,
        uid,
        events: finalList,
        stoken: res.stoken,
        lastSyncedAt: Date.now(),
      })
    },
    [],
  )

  const loadAll = useCallback(async () => {
    loadAbort.current?.abort()
    const ac = new AbortController()
    loadAbort.current = ac
    try {
      const mem = getCalMemory()
      let cals = mem.calendars
      if (!cals) {
        cals = await listCalendars()
        if (ac.signal.aborted) return
        setCalendars(() => cals)
      }
      setLoadingCount(() => cals.length)
      await Promise.all(
        cals.map((c) =>
          syncCalendar(
            c.uid,
            ac.signal,
            mem.eventsByCal.get(c.uid) ?? [],
          )
            .catch((e) => {
              if (
                ac.signal.aborted ||
                (e as { name?: string })?.name === 'AbortError'
              )
                return
              setError(() => (e instanceof Error ? e.message : String(e)))
            })
            .finally(() => {
              if (!ac.signal.aborted)
                setLoadingCount((n) => Math.max(0, n - 1))
            }),
        ),
      )
      patchCalMemory({ warmed: true })
    } catch (e) {
      if (ac.signal.aborted) return
      setError(() => (e instanceof Error ? e.message : String(e)))
    }
  }, [syncCalendar])

  useEffect(() => {
    void loadAll()
    return () => loadAbort.current?.abort()
  }, [loadAll])

  // Mirror render state into the process-lifetime cache so an unmount
  // (module switch) doesn't lose it. Not a setState — safe in an effect.
  useEffect(() => {
    patchCalMemory({
      calendars,
      eventsByCal,
      stokenByCal: stokenRef.current,
      hidden,
      view,
      anchorMs: anchor.getTime(),
    })
  }, [calendars, eventsByCal, hidden, view, anchor])

  const colorByCal = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of calendars ?? []) map.set(c.uid, c.color ?? ACCENT)
    return map
  }, [calendars])

  const { visibleEvents, colorByItem, calByItem } = useMemo(() => {
    const evs: EventItem[] = []
    const colors = new Map<string, string>()
    const cals = new Map<string, string>()
    for (const [uid, list] of eventsByCal) {
      if (hidden.has(uid)) continue
      const col = colorByCal.get(uid) ?? ACCENT
      for (const it of list) {
        evs.push(it)
        colors.set(it.itemUid, col)
        cals.set(it.itemUid, uid)
      }
    }
    return { visibleEvents: evs, colorByItem: colors, calByItem: cals }
  }, [eventsByCal, hidden, colorByCal])

  const colorFor = useCallback(
    (item: EventItem) => colorByItem.get(item.itemUid) ?? ACCENT,
    [colorByItem],
  )

  const today = startOfDay(new Date())

  const { rangeStart, rangeEnd, dayRange, monthDays } = useMemo(() => {
    if (view === 'year') {
      const y = anchor.getFullYear()
      return {
        rangeStart: new Date(y, 0, 1),
        rangeEnd: new Date(y + 1, 0, 1),
        dayRange: [] as Date[],
        monthDays: [] as Date[],
      }
    }
    if (view === 'month') {
      const md = monthGridDays(anchor)
      return {
        rangeStart: md[0],
        rangeEnd: addDays(md[md.length - 1], 1),
        dayRange: [] as Date[],
        monthDays: md,
      }
    }
    const r = viewDayRange(view, anchor)
    return {
      rangeStart: r.start,
      rangeEnd: r.end,
      dayRange: r.days,
      monthDays: [] as Date[],
    }
  }, [view, anchor])

  const byDay = useMemo(
    () => bucketByDay(visibleEvents, rangeStart, rangeEnd),
    [visibleEvents, rangeStart, rangeEnd],
  )

  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), [])
  const step = useCallback(
    (dir: 1 | -1) => setAnchor((a) => stepAnchor(view, a, dir)),
    [view],
  )
  const pickDay = useCallback((d: Date) => {
    setAnchor(startOfDay(d))
    setView('day')
  }, [])
  const pickMonth = useCallback(
    (mo: number) => {
      setAnchor(new Date(anchor.getFullYear(), mo, 1))
      setView('month')
    },
    [anchor],
  )
  const toggleCal = useCallback((uid: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  // Keyboard shortcuts. Disabled while a modal owns the keyboard or focus
  // is in a form field. Arrow keys move the selected day and the view
  // pages to keep it visible; Shift+arrow pages by the view's unit.
  useEffect(() => {
    if (composer || conflict) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const viewByKey: Record<string, CalView> = {
        '1': 'day',
        '2': '3day',
        '3': 'week',
        '4': 'month',
        '5': 'year',
      }
      if (viewByKey[e.key]) {
        setView(viewByKey[e.key])
        return
      }
      if (e.key === 't' || e.key === 'T') {
        const td = startOfDay(new Date())
        setSelected(td)
        setAnchor(td)
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        setComposer({ mode: 'new', date: selected })
        return
      }

      const arrows: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      }
      const delta = arrows[e.key]
      if (delta === undefined) return
      e.preventDefault()

      if (e.shiftKey) {
        setAnchor((a) => stepAnchor(view, a, delta < 0 ? -1 : 1))
        return
      }

      const next = addDays(selected, delta)
      setSelected(next)
      // Page so `next` stays visible.
      if (view === 'year') {
        if (next.getFullYear() !== anchor.getFullYear())
          setAnchor(new Date(next.getFullYear(), 0, 1))
      } else if (view === 'month') {
        if (
          next.getMonth() !== anchor.getMonth() ||
          next.getFullYear() !== anchor.getFullYear()
        )
          setAnchor(new Date(next.getFullYear(), next.getMonth(), 1))
      } else {
        const r = viewDayRange(view, anchor)
        if (next < r.start || next >= r.end) setAnchor(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, anchor, selected, composer, conflict])

  // First visible calendar is the default target for new events.
  const defaultCalUid =
    calendars?.find((c) => !hidden.has(c.uid))?.uid ??
    calendars?.[0]?.uid ??
    ''

  const handleCreate = useCallback(
    async (calUid: string, args: NewVEventArgs) => {
      setCreating(true)
      setCreateErr(null)
      try {
        const created = await createEvent(calUid, args)
        // Optimistic insert. The disk snapshot picks this up on the next
        // background delta sync (the item comes back under its stoken);
        // the in-memory cache retains it immediately via the mirror effect.
        setEventsByCal((prev) => {
          const next = new Map(prev)
          next.set(calUid, [...(next.get(calUid) ?? []), created])
          return next
        })
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [],
  )

  // Replace (or, with null, remove) an event in a calendar's list.
  const spliceEvent = useCallback(
    (calUid: string, itemUid: string, next: EventItem | null) => {
      setEventsByCal((prev) => {
        const list = prev.get(calUid) ?? []
        const updated = next
          ? list.map((e) => (e.itemUid === itemUid ? next : e))
          : list.filter((e) => e.itemUid !== itemUid)
        return new Map(prev).set(calUid, updated)
      })
    },
    [],
  )

  // Click an event → quick popover at the click point.
  const openEvent = useCallback(
    (item: EventItem, coords: { x: number; y: number }) => {
      const calUid = calByItem.get(item.itemUid)
      if (!calUid) return
      setPopover({ item, calUid, x: coords.x, y: coords.y })
    },
    [calByItem],
  )

  const editFromPopover = useCallback(() => {
    setPopover((p) => {
      if (p) {
        setCreateErr(null)
        setComposer({ mode: 'edit', item: p.item, calUid: p.calUid })
      }
      return null
    })
  }, [])

  const handleUpdate = useCallback(
    async (calUid: string, itemUid: string, patch: VEventPatch) => {
      setCreating(true)
      setCreateErr(null)
      try {
        const updated = await updateEvent(calUid, itemUid, patch)
        spliceEvent(calUid, itemUid, updated)
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        if (e instanceof EventConflictError) {
          setComposer(null)
          setConflict({
            calUid,
            itemUid,
            localRaw: e.localRaw,
            serverRaw: e.serverRaw,
          })
          return
        }
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [spliceEvent],
  )

  const handleDelete = useCallback(
    async (calUid: string, itemUid: string) => {
      setCreating(true)
      setCreateErr(null)
      try {
        await deleteEvent(calUid, itemUid)
        spliceEvent(calUid, itemUid, null)
        setCreating(false)
        setComposer(null)
      } catch (e) {
        setCreating(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
      }
    },
    [spliceEvent],
  )

  const resolveConflict = useCallback(
    async (keep: 'local' | 'cloud') => {
      if (!conflict) return
      const { calUid, itemUid, localRaw, serverRaw } = conflict
      setConflictBusy(true)
      try {
        if (keep === 'local') {
          const forced = await forceUpdateEvent(calUid, itemUid, localRaw)
          spliceEvent(calUid, itemUid, forced)
        } else {
          const event = parseVEvent(serverRaw)
          if (event) spliceEvent(calUid, itemUid, { itemUid, event })
        }
        setConflictBusy(false)
        setConflict(null)
      } catch (e) {
        setConflictBusy(false)
        setCreateErr(e instanceof Error ? e.message : String(e))
        setConflict(null)
      }
    },
    [conflict, spliceEvent],
  )

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="max-w-md text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (calendars && calendars.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="text-sm text-text-faint">
          No calendars found in this account.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-bg text-text">
      <CalendarSidebar
        key={`${anchor.getFullYear()}-${anchor.getMonth()}`}
        anchor={anchor}
        today={today}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        calendars={calendars}
        hidden={hidden}
        onToggle={toggleCal}
        onPickDay={(d) => setAnchor(startOfDay(d))}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => step(-1)}
              className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              onClick={() => step(1)}
              className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2"
              aria-label="Next"
            >
              ›
            </button>
            <button
              onClick={goToday}
              className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2"
            >
              Today
            </button>
            <button
              onClick={() => setComposer({ mode: 'new', date: anchor })}
              className="ml-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg hover:opacity-90"
            >
              + New
            </button>
          </div>
          <h1 className="truncate text-sm font-semibold">
            {rangeTitle(view, anchor)}
          </h1>

          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`rounded px-2 py-1 ${
                  view === v.id
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {loadingCount > 0 && (
            <span className="text-xs text-text-faint">syncing…</span>
          )}
        </div>

        {/* Active view */}
        {view === 'year' ? (
          <YearGrid
            year={anchor.getFullYear()}
            byDay={byDay}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onPickMonth={pickMonth}
          />
        ) : view === 'month' ? (
          <MonthGrid
            days={monthDays}
            monthOf={anchor.getMonth()}
            byDay={byDay}
            colorFor={colorFor}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onNewEvent={(d) => setComposer({ mode: 'new', date: d })}
            onOpenEvent={openEvent}
          />
        ) : (
          <TimeGrid
            days={dayRange}
            byDay={byDay}
            colorFor={colorFor}
            today={today}
            selected={selected}
            onPickDay={pickDay}
            onNewEvent={(d, hour) =>
              setComposer({ mode: 'new', date: d, hour })
            }
            onOpenEvent={openEvent}
          />
        )}
      </div>

      {composer && calendars && calendars.length > 0 && (
        <EventComposer
          date={
            composer.mode === 'new'
              ? composer.date
              : (composer.item.event.start ?? new Date())
          }
          defaultHour={composer.mode === 'new' ? composer.hour : undefined}
          editing={composer.mode === 'edit' ? composer.item : undefined}
          calendars={calendars}
          defaultCalUid={
            composer.mode === 'edit' ? composer.calUid : defaultCalUid
          }
          saving={creating}
          error={createErr}
          onCreate={handleCreate}
          onUpdate={
            composer.mode === 'edit'
              ? (patch) =>
                  handleUpdate(
                    composer.calUid,
                    composer.item.itemUid,
                    patch,
                  )
              : undefined
          }
          onDelete={
            composer.mode === 'edit'
              ? () =>
                  handleDelete(composer.calUid, composer.item.itemUid)
              : undefined
          }
          onClose={() => {
            setComposer(null)
            setCreateErr(null)
          }}
        />
      )}

      {conflict && (
        <ConflictModal
          localRaw={conflict.localRaw}
          serverRaw={conflict.serverRaw}
          busy={conflictBusy}
          onKeepLocal={() => resolveConflict('local')}
          onKeepCloud={() => resolveConflict('cloud')}
          onClose={() => setConflict(null)}
        />
      )}

      {popover && (
        <EventPopover
          item={popover.item}
          calName={
            calendars?.find((c) => c.uid === popover.calUid)?.name
          }
          x={popover.x}
          y={popover.y}
          busy={creating}
          onEdit={editFromPopover}
          onDelete={() => {
            handleDelete(popover.calUid, popover.item.itemUid)
            setPopover(null)
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
