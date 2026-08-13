import { useState } from 'react'
import {
  type CustomRrule,
  type MonthlyWeekN,
  type RepeatPreset,
  type Weekday,
  MONTH_POSITIONS,
  WEEKDAYS,
  customSupportsRrule,
  detectPreset,
  emptyCustomRrule,
  ordinalLabel,
  parseRruleToCustom,
  serializeCustomRrule,
} from '../services/rrule'

const fieldClass =
  'mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong'
const labelClass =
  'block text-[11px] font-semibold uppercase tracking-wider text-text-faint'

const WEEKDAY_LABEL: Record<Weekday, string> = {
  MO: 'M',
  TU: 'T',
  WE: 'W',
  TH: 'T',
  FR: 'F',
  SA: 'S',
  SU: 'S',
}

// Compact RRULE editor for tasks. Controlled by a single rrule string
// (''='does not repeat'); emits the next rrule via onChange. The pure
// parse/serialize logic is shared with the calendar composer (rrule.ts).
export function RecurrenceEditor({
  value,
  hasAnchor,
  onChange,
}: {
  value: string
  // True when the task has a due/start date to anchor the recurrence.
  hasAnchor: boolean
  onChange: (rrule: string) => void
}) {
  const sourceHadCustomRrule = detectPreset(value || undefined) === 'custom'
  const sourceCustomEditable = !!(value && customSupportsRrule(value))

  const [preset, setPreset] = useState<RepeatPreset>(() =>
    detectPreset(value || undefined),
  )
  const [custom, setCustom] = useState<CustomRrule>(() =>
    sourceCustomEditable ? parseRruleToCustom(value) : emptyCustomRrule(),
  )
  // Has the user edited the custom controls since mount? Until then a
  // source rule our editor can't model is preserved verbatim.
  const [customTouched, setCustomTouched] = useState(false)

  const rruleFor = (p: RepeatPreset, c: CustomRrule, touched: boolean) => {
    switch (p) {
      case 'none':
        return ''
      case 'daily':
        return 'FREQ=DAILY'
      case 'weekly':
        return 'FREQ=WEEKLY'
      case 'monthly':
        return 'FREQ=MONTHLY'
      case 'yearly':
        return 'FREQ=YEARLY'
      case 'custom':
        if (sourceHadCustomRrule && !sourceCustomEditable && !touched) {
          return value // preserve a rule our surface can't represent
        }
        return serializeCustomRrule(c)
    }
  }

  const pickPreset = (next: RepeatPreset) => {
    setPreset(next)
    if (next !== 'custom') setCustomTouched(false)
    onChange(rruleFor(next, custom, customTouched))
  }

  const updateCustom = (patch: Partial<CustomRrule>) => {
    const next = { ...custom, ...patch }
    setCustom(next)
    setCustomTouched(true)
    onChange(rruleFor('custom', next, true))
  }

  const toggleWeekday = (w: Weekday) => {
    const byday = new Set(custom.byday)
    if (byday.has(w)) byday.delete(w)
    else byday.add(w)
    updateCustom({ byday })
  }

  const toggleMonthWeekday = (w: Weekday) => {
    const monthWeekdays = new Set(custom.monthWeekdays)
    if (monthWeekdays.has(w)) monthWeekdays.delete(w)
    else monthWeekdays.add(w)
    if (monthWeekdays.size === 0) return // keep at least one
    updateCustom({ monthlyMode: 'weekday', monthWeekdays })
  }

  const toggleMonthPosition = (p: MonthlyWeekN) => {
    const monthPositions = new Set(custom.monthPositions)
    if (monthPositions.has(p)) monthPositions.delete(p)
    else monthPositions.add(p)
    if (monthPositions.size === 0) return // keep at least one
    updateCustom({ monthlyMode: 'weekday', monthPositions })
  }

  // Custom controls are shown (and editable) when the user is in custom
  // mode and either picked it themselves or the source rule is modellable.
  const showEditableCustom =
    preset === 'custom' && (sourceCustomEditable || customTouched || !sourceHadCustomRrule)
  const showPreservedNote =
    preset === 'custom' && sourceHadCustomRrule && !sourceCustomEditable && !customTouched

  return (
    <div>
      <label className={labelClass}>Repeat</label>
      <select
        value={preset}
        onChange={(e) => pickPreset(e.target.value as RepeatPreset)}
        className={fieldClass}
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
        <option value="custom">
          {sourceHadCustomRrule && !sourceCustomEditable
            ? 'Custom (preserved)'
            : 'Custom…'}
        </option>
      </select>

      {preset !== 'none' && !hasAnchor && (
        <p className="mt-1 text-[11px] text-danger">
          Add a due or start date so the next occurrence has an anchor.
        </p>
      )}

      {showPreservedNote && (
        <p className="mt-1 text-[11px] text-text-faint">
          This rule uses options the editor can't show; it's kept as-is.
          Pick another option to replace it.
        </p>
      )}

      {showEditableCustom && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-2 p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Every</span>
            <input
              type="number"
              min={1}
              value={custom.interval}
              onChange={(e) =>
                updateCustom({
                  interval: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                })
              }
              className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
            />
            <select
              value={custom.freq}
              onChange={(e) =>
                updateCustom({ freq: e.target.value as CustomRrule['freq'] })
              }
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
            >
              <option value="DAILY">day(s)</option>
              <option value="WEEKLY">week(s)</option>
              <option value="MONTHLY">month(s)</option>
              <option value="YEARLY">year(s)</option>
            </select>
          </div>

          {custom.freq === 'WEEKLY' && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWeekday(w)}
                  className={`h-7 w-7 rounded-md border text-xs transition-colors ${
                    custom.byday.has(w)
                      ? 'border-accent/40 bg-accent-soft text-text'
                      : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                  }`}
                >
                  {WEEKDAY_LABEL[w]}
                </button>
              ))}
            </div>
          )}

          {custom.freq === 'MONTHLY' && (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="radio"
                  checked={custom.monthlyMode === 'day'}
                  onChange={() => updateCustom({ monthlyMode: 'day' })}
                  className="accent-accent"
                />
                On day
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={custom.monthDay}
                  disabled={custom.monthlyMode !== 'day'}
                  onChange={(e) =>
                    updateCustom({
                      monthDay: Math.max(
                        1,
                        Math.min(31, Math.floor(Number(e.target.value) || 1)),
                      ),
                    })
                  }
                  className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong disabled:opacity-40"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="radio"
                  checked={custom.monthlyMode === 'weekday'}
                  onChange={() => updateCustom({ monthlyMode: 'weekday' })}
                  className="accent-accent"
                />
                On the…
              </label>
              {custom.monthlyMode === 'weekday' && (
                <div className="space-y-1.5 pl-6">
                  <div className="flex flex-wrap gap-1">
                    {MONTH_POSITIONS.map((p) => {
                      const on = custom.monthPositions.has(p)
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => toggleMonthPosition(p)}
                          aria-pressed={on}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            on
                              ? 'border-accent/40 bg-accent-soft text-text'
                              : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                          }`}
                        >
                          {ordinalLabel(p)}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((w) => {
                      const on = custom.monthWeekdays.has(w)
                      return (
                        <button
                          key={w}
                          type="button"
                          onClick={() => toggleMonthWeekday(w)}
                          aria-pressed={on}
                          title={w}
                          className={`h-7 w-7 rounded-md border text-xs transition-colors ${
                            on
                              ? 'border-accent/40 bg-accent-soft text-text'
                              : 'border-border text-text-muted hover:border-border-strong hover:text-text'
                          }`}
                        >
                          {WEEKDAY_LABEL[w]}
                        </button>
                      )
                    })}
                  </div>
                  {(custom.monthPositions.size > 1 ||
                    custom.monthWeekdays.size > 1) && (
                    <p className="text-[10px] text-text-faint">
                      The chosen occurrence(s) across the selected weekdays
                      (e.g. all weekdays + “last” = the month's last weekday).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Ends</span>
            <select
              value={custom.term}
              onChange={(e) =>
                updateCustom({ term: e.target.value as CustomRrule['term'] })
              }
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
            >
              <option value="never">Never</option>
              <option value="count">After…</option>
              <option value="until">On date…</option>
            </select>
            {custom.term === 'count' && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={custom.count}
                  onChange={(e) =>
                    updateCustom({
                      count: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    })
                  }
                  className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
                />
                <span className="text-xs text-text-muted">times</span>
              </div>
            )}
            {custom.term === 'until' && (
              <input
                type="date"
                value={custom.until}
                onChange={(e) => updateCustom({ until: e.target.value })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-border-strong"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
