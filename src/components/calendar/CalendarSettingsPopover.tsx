import { useEffect, useRef, useState } from 'react'
import { ModuleToggles } from '../ModuleToggles'
import { NavRow, PaneHeader } from '../SettingsNav'
import { OpenInWindowRow } from '../OpenInWindowRow'
import { SettingsSection } from '../SettingsSection'
import { SettingsWindow } from '../SettingsWindow'
import { BDAY_UNCATEGORISED } from '../../services/birthdays'
import {
  WEATHER_PAST_DAYS_OPTIONS,
  WEATHER_REFRESH_OPTIONS,
  geocodeCity,
  type GeocodeResult,
  type WeatherLocation,
  type WeatherUnits,
} from '../../services/weather'

type CalSort = 'original' | 'name'

// Compact-popover drill-down panes.
type Pane =
  | 'root'
  | 'display'
  | 'weather'
  | 'zoom'
  | 'sort'
  | 'window'
  | 'advanced'
  | 'account'

interface DayWindow {
  startH: number
  endH: number
}
// 30 = 06:00 the next morning — matches CalendarView's MAX_END_H.
const MAX_END_H = 30

interface Props {
  showWeekNum: boolean
  onToggleWeekNum: () => void
  showTasks: boolean
  onToggleShowTasks: () => void
  // Contact birthdays overlay + per-category visibility. `bdayCategories`
  // is the list of distinct CATEGORIES values across loaded contacts,
  // optionally with the BDAY_UNCATEGORISED sentinel when any contact has
  // no categories at all.
  showBirthdays: boolean
  onToggleShowBirthdays: () => void
  bdayCategories: string[]
  hiddenBdayCategories: Set<string>
  onToggleBdayCategory: (cat: string) => void
  // Weather overlay (Open-Meteo). `location` null means the user has
  // not provided coordinates yet — the overlay stays off until set.
  weatherLocation: WeatherLocation | null
  onSetWeatherLocation: (loc: WeatherLocation | null) => void
  weatherUnits: WeatherUnits
  onSetWeatherUnits: (u: WeatherUnits) => void
  weatherRefreshMin: number
  onSetWeatherRefreshMin: (min: number) => void
  weatherPastDays: number
  onSetWeatherPastDays: (days: number) => void
  weatherSyncing: boolean
  weatherFetchedAt: number | null
  weatherError: string | null
  onRefreshWeather: () => void
  // Independent zooms — sidebar (mini-month + calendar list) vs main
  // pane (toolbar + month/week grid).
  mainZoomPct: number
  onMainZoom: (delta: number | 'reset') => void
  sidebarZoomPct: number
  onSidebarZoom: (delta: number | 'reset') => void
  hourPx: number
  onHourPx: (delta: number | 'reset') => void
  // Calendar sort order in the sidebar list.
  sortBy: CalSort
  onSortBy: (v: CalSort) => void
  sortReverse: boolean
  onToggleSortReverse: () => void
  // Adjustable visible-hours window. `endH` past 24 extends into the next
  // day. Weekends use their own window when `weekendWindowOn` is set.
  dayWindowOn: boolean
  onToggleDayWindow: () => void
  dayWindow: DayWindow
  onSetDayWindow: (v: DayWindow) => void
  weekendWindowOn: boolean
  onToggleWeekendWindow: () => void
  weekendWindow: DayWindow
  onSetWeekendWindow: (v: DayWindow) => void
  onLogout: () => void
  onClose: () => void
}

// Display / sizing settings for the calendar — consolidates the toggles
// (week numbers, tasks overlay) and the two independent zooms (overall
// CSS zoom + time-grid elongation) in one popover. Mirrors the tasks
// SettingsPopover's structure and click-away / Esc behaviour.
export function CalendarSettingsPopover({
  showWeekNum,
  onToggleWeekNum,
  showTasks,
  onToggleShowTasks,
  showBirthdays,
  onToggleShowBirthdays,
  bdayCategories,
  hiddenBdayCategories,
  onToggleBdayCategory,
  weatherLocation,
  onSetWeatherLocation,
  weatherUnits,
  onSetWeatherUnits,
  weatherRefreshMin,
  onSetWeatherRefreshMin,
  weatherPastDays,
  onSetWeatherPastDays,
  weatherSyncing,
  weatherFetchedAt,
  weatherError,
  onRefreshWeather,
  mainZoomPct,
  onMainZoom,
  sidebarZoomPct,
  onSidebarZoom,
  hourPx,
  onHourPx,
  sortBy,
  onSortBy,
  sortReverse,
  onToggleSortReverse,
  dayWindowOn,
  onToggleDayWindow,
  dayWindow,
  onSetDayWindow,
  weekendWindowOn,
  onToggleWeekendWindow,
  weekendWindow,
  onSetWeekendWindow,
  onLogout,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')

  useEffect(() => {
    if (windowOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[aria-label="Calendar settings"]')) return
      if (!ref.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (pane !== 'root') setPane('root')
        else onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, windowOpen, pane])

  const SECTIONS = [
    { id: 'calendar.display', label: 'Display' },
    { id: 'calendar.weather', label: 'Weather' },
    ...(showBirthdays && bdayCategories.length > 0
      ? [{ id: 'calendar.bdayCategories', label: 'Birthday categories' }]
      : []),
    { id: 'calendar.zoom', label: 'Zoom' },
    { id: 'calendar.sort', label: 'Sort calendars' },
    { id: 'calendar.window', label: 'Visible hours' },
    { id: 'shared.modules', label: 'Modules' },
    { id: 'shared.account', label: 'Account' },
  ] as const

  const displayRows = (
    <>
      <Row label="Week numbers">
        <Toggle
          on={showWeekNum}
          onClick={onToggleWeekNum}
          label="Week numbers"
        />
      </Row>
      <Row label="Tasks with due dates">
        <Toggle
          on={showTasks}
          onClick={onToggleShowTasks}
          label="Tasks with due dates"
        />
      </Row>
      <Row label="Contact birthdays">
        <Toggle
          on={showBirthdays}
          onClick={onToggleShowBirthdays}
          label="Contact birthdays"
        />
      </Row>
    </>
  )

  const bdayCategoriesRows =
    showBirthdays && bdayCategories.length > 0 ? (
      <>
        <p className="px-3 pb-1 pt-0.5 text-[11px] text-text-faint">
          Uncheck a category to hide those birthdays. Multi-tag
          contacts show as long as at least one tag is on.
        </p>
        {bdayCategories.map((cat) => {
          const isSentinel = cat === BDAY_UNCATEGORISED
          const label = isSentinel ? '(no category)' : cat
          const checked = !hiddenBdayCategories.has(cat)
          return (
            <label
              key={cat}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleBdayCategory(cat)}
                className="h-3.5 w-3.5 cursor-pointer accent-current"
              />
              <span
                className={`min-w-0 flex-1 truncate ${
                  isSentinel ? 'italic text-text-faint' : ''
                }`}
              >
                {label}
              </span>
            </label>
          )
        })}
      </>
    ) : null

  const weatherRows = (
    <WeatherSection
      location={weatherLocation}
      onSetLocation={onSetWeatherLocation}
      units={weatherUnits}
      onSetUnits={onSetWeatherUnits}
      refreshMin={weatherRefreshMin}
      onSetRefreshMin={onSetWeatherRefreshMin}
      pastDays={weatherPastDays}
      onSetPastDays={onSetWeatherPastDays}
      syncing={weatherSyncing}
      fetchedAt={weatherFetchedAt}
      error={weatherError}
      onRefresh={onRefreshWeather}
    />
  )

  const zoomRows = (
    <>
      <Row label="Sidebar zoom">
        <Stepper
          label="Sidebar zoom"
          value={`${sidebarZoomPct}%`}
          onDec={() => onSidebarZoom(-0.1)}
          onReset={() => onSidebarZoom('reset')}
          onInc={() => onSidebarZoom(0.1)}
        />
      </Row>
      <Row label="Calendar zoom">
        <Stepper
          label="Calendar zoom"
          value={`${mainZoomPct}%`}
          onDec={() => onMainZoom(-0.1)}
          onReset={() => onMainZoom('reset')}
          onInc={() => onMainZoom(0.1)}
        />
      </Row>
      <Row label="Day / week height">
        <Stepper
          label="Day / week height"
          value={`${hourPx}px`}
          onDec={() => onHourPx(-6)}
          onReset={() => onHourPx('reset')}
          onInc={() => onHourPx(6)}
        />
      </Row>
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Day/week height elongates the time grid only. Sidebar and
        calendar zooms scale the rest independently.
      </p>
    </>
  )

  const sortRows = (
    <>
      <Row label="Order">
        <select
          value={sortBy}
          onChange={(e) => onSortBy(e.target.value as CalSort)}
          aria-label="Sort calendars"
          className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          <option value="original">As listed</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </Row>
      <Row label="Reverse">
        <Toggle
          on={sortReverse}
          onClick={onToggleSortReverse}
          label="Reverse calendar sort"
        />
      </Row>
    </>
  )

  const windowRows = (
    <>
      <Row label="Limit visible hours">
        <Toggle
          on={dayWindowOn}
          onClick={onToggleDayWindow}
          label="Limit visible hours"
        />
      </Row>
      <WindowRow
        label="Day window"
        value={dayWindow}
        onChange={onSetDayWindow}
      />
      <Row label="Different window on weekends">
        <Toggle
          on={weekendWindowOn}
          onClick={onToggleWeekendWindow}
          label="Different window on weekends"
        />
      </Row>
      {weekendWindowOn && (
        <WindowRow
          label="Weekend (Sat–Sun)"
          value={weekendWindow}
          onChange={onSetWeekendWindow}
        />
      )}
      <p className="px-3 pb-2 pt-0.5 text-[11px] text-text-faint">
        Set an end past 24:00 (shown “+1d”) to extend the grid into the next
        day. The morning before the start hour is hidden.
      </p>
    </>
  )

  const accountRows = (
    <button
      type="button"
      onClick={onLogout}
      className="block w-full px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      Sign out
    </button>
  )

  const body = (
    <>
      <SettingsSection
        id="calendar.display"
        label="Display"
        forceOpen={windowOpen}
      >
        {displayRows}
      </SettingsSection>
      <SettingsSection
        id="calendar.weather"
        label="Weather"
        forceOpen={windowOpen}
      >
        {weatherRows}
      </SettingsSection>
      {bdayCategoriesRows && (
        <SettingsSection
          id="calendar.bdayCategories"
          label="Birthday categories"
          forceOpen={windowOpen}
        >
          {bdayCategoriesRows}
        </SettingsSection>
      )}
      <SettingsSection id="calendar.zoom" label="Zoom" forceOpen={windowOpen}>
        {zoomRows}
      </SettingsSection>
      <SettingsSection
        id="calendar.sort"
        label="Sort calendars"
        forceOpen={windowOpen}
      >
        {sortRows}
      </SettingsSection>
      <SettingsSection
        id="calendar.window"
        label="Visible hours"
        forceOpen={windowOpen}
      >
        {windowRows}
      </SettingsSection>
      <ModuleToggles forceOpen={windowOpen} />
      <div className="mt-1 border-t border-border">
        <SettingsSection
          id="shared.account"
          label="Account"
          forceOpen={windowOpen}
        >
          {accountRows}
        </SettingsSection>
      </div>
    </>
  )

  if (windowOpen) {
    return (
      <SettingsWindow
        title="Calendar settings"
        sections={SECTIONS}
        onClose={() => {
          setWindowOpen(false)
          onClose()
        }}
      >
        {body}
      </SettingsWindow>
    )
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Calendar settings popover"
      className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      {pane === 'root' ? (
        <>
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              Settings
            </p>
            <button
              type="button"
              onClick={() => setWindowOpen(true)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              More settings…
            </button>
          </div>
          <NavRow label="Display" onClick={() => setPane('display')} />
          <NavRow label="Weather" onClick={() => setPane('weather')} />
          <NavRow label="Zoom" onClick={() => setPane('zoom')} />
          <NavRow label="Sort calendars" onClick={() => setPane('sort')} />
          <NavRow label="Visible hours" onClick={() => setPane('window')} />
          <NavRow label="Advanced" onClick={() => setPane('advanced')} />
          <div className="mt-1 border-t border-border">
            <NavRow label="Account" onClick={() => setPane('account')} />
          </div>
        </>
      ) : pane === 'display' ? (
        <div className="max-h-[70vh] overflow-y-auto">
          <PaneHeader title="Display" onBack={() => setPane('root')} />
          {displayRows}
          {bdayCategoriesRows && (
            <SettingsSection
              id="calendar.bdayCategories"
              label="Birthday categories"
            >
              {bdayCategoriesRows}
            </SettingsSection>
          )}
        </div>
      ) : pane === 'weather' ? (
        <div className="max-h-[70vh] overflow-y-auto">
          <PaneHeader title="Weather" onBack={() => setPane('root')} />
          {weatherRows}
        </div>
      ) : pane === 'zoom' ? (
        <>
          <PaneHeader title="Zoom" onBack={() => setPane('root')} />
          {zoomRows}
        </>
      ) : pane === 'sort' ? (
        <>
          <PaneHeader title="Sort calendars" onBack={() => setPane('root')} />
          {sortRows}
        </>
      ) : pane === 'window' ? (
        <>
          <PaneHeader title="Visible hours" onBack={() => setPane('root')} />
          {windowRows}
        </>
      ) : pane === 'account' ? (
        <>
          <PaneHeader title="Account" onBack={() => setPane('root')} />
          {accountRows}
        </>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          <PaneHeader title="Advanced" onBack={() => setPane('root')} />
          <ModuleToggles />
          <SettingsSection id="calendar.window" label="Window">
            <OpenInWindowRow
              module="calendar"
              label="Open Calendar in new window"
            />
          </SettingsSection>
        </div>
      )}
    </div>
  )
}

// Weather settings block — embedded inside the "Weather" SettingsSection.
// Pulled out as its own component so the popover stays readable; owns
// the editing-state of the lat/lng/label inputs (live values are passed
// in as props but the inputs hold their own draft until commit).
function WeatherSection({
  location,
  onSetLocation,
  units,
  onSetUnits,
  refreshMin,
  onSetRefreshMin,
  pastDays,
  onSetPastDays,
  syncing,
  fetchedAt,
  error,
  onRefresh,
}: {
  location: WeatherLocation | null
  onSetLocation: (loc: WeatherLocation | null) => void
  units: WeatherUnits
  onSetUnits: (u: WeatherUnits) => void
  refreshMin: number
  onSetRefreshMin: (m: number) => void
  pastDays: number
  onSetPastDays: (n: number) => void
  syncing: boolean
  fetchedAt: number | null
  error: string | null
  onRefresh: () => void
}) {
  const [lat, setLat] = useState(
    location ? String(location.latitude) : '',
  )
  const [lon, setLon] = useState(
    location ? String(location.longitude) : '',
  )
  const [label, setLabel] = useState(location?.label ?? '')
  // Re-sync the inputs when the live location changes from outside
  // (e.g. cleared via the "Off" button). The lint rule is suppressed
  // because mirroring a prop change into local input drafts IS the
  // intended pattern — there's no external system to subscribe to;
  // the prop *is* the source.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLat(location ? String(location.latitude) : '')
    setLon(location ? String(location.longitude) : '')
    setLabel(location?.label ?? '')
  }, [location])

  const latN = Number(lat)
  const lonN = Number(lon)
  const latValid =
    lat.trim() !== '' &&
    Number.isFinite(latN) &&
    latN >= -90 &&
    latN <= 90
  const lonValid =
    lon.trim() !== '' &&
    Number.isFinite(lonN) &&
    lonN >= -180 &&
    lonN <= 180
  const canApply = latValid && lonValid

  return (
    <div className="space-y-2 px-3 py-2">
      <p className="text-[11px] text-text-faint">
        Open-Meteo (free, no key). Search for a city or enter
        coordinates manually.
      </p>
      <CitySearch
        onPick={(r) => {
          onSetLocation({
            latitude: r.latitude,
            longitude: r.longitude,
            label: r.label,
          })
        }}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          step="0.0001"
          value={lat}
          placeholder="Latitude"
          aria-label="Latitude"
          onChange={(e) => setLat(e.target.value)}
          className={`rounded-md border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong ${
            lat && !latValid ? 'border-danger/60' : 'border-border'
          }`}
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.0001"
          value={lon}
          placeholder="Longitude"
          aria-label="Longitude"
          onChange={(e) => setLon(e.target.value)}
          className={`rounded-md border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong ${
            lon && !lonValid ? 'border-danger/60' : 'border-border'
          }`}
        />
      </div>
      <input
        type="text"
        value={label}
        placeholder="Label (optional, e.g. Oslo)"
        aria-label="Location label"
        onChange={(e) => setLabel(e.target.value)}
        className="w-full rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
      />
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          disabled={!canApply}
          onClick={() =>
            onSetLocation({
              latitude: latN,
              longitude: lonN,
              label: label.trim(),
            })
          }
          className="h-7 rounded-md bg-accent px-2.5 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {location ? 'Apply' : 'Enable'}
        </button>
        {location && (
          <button
            type="button"
            onClick={() => onSetLocation(null)}
            className="h-7 rounded-md border border-border px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Off
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={!location || syncing}
          className="ml-auto h-7 rounded-md border border-border px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {syncing ? 'Fetching…' : 'Refresh'}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-text-muted">Units</span>
        <select
          value={units}
          onChange={(e) => onSetUnits(e.target.value as WeatherUnits)}
          aria-label="Temperature units"
          className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          <option value="metric">Celsius (°C)</option>
          <option value="imperial">Fahrenheit (°F)</option>
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">Refresh every</span>
        <select
          value={refreshMin}
          onChange={(e) => onSetRefreshMin(Number(e.target.value))}
          aria-label="Weather refresh interval"
          className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          {WEATHER_REFRESH_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 0
                ? 'Manual only'
                : m < 60
                  ? `${m} min`
                  : `${m / 60} h`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs text-text-muted"
          title="Show observed weather for past days alongside the forecast."
        >
          History
        </span>
        <select
          value={pastDays}
          onChange={(e) => onSetPastDays(Number(e.target.value))}
          aria-label="Weather history window"
          className="rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        >
          {WEATHER_PAST_DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? 'Forecast only' : `Last ${d} days`}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
      {fetchedAt && !error && (
        <p className="text-[11px] text-text-faint">
          Last fetched{' '}
          {new Date(fetchedAt).toLocaleString([], {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          })}
        </p>
      )}
    </div>
  )
}

// Format an hour value as "HH:00", tagging hours past 24 as next-day.
function hourLabel(h: number): string {
  if (h >= 24) return `${String(h - 24).padStart(2, '0')}:00 +1d`
  return `${String(h).padStart(2, '0')}:00`
}

function WindowRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: DayWindow
  onChange: (v: DayWindow) => void
}) {
  // Start: 00–23. End: 01–MAX_END_H (past 24 = next morning).
  const startOpts = Array.from({ length: 24 }, (_, i) => i)
  const endOpts = Array.from({ length: MAX_END_H }, (_, i) => i + 1)
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
        {label}
      </span>
      <select
        value={value.startH}
        onChange={(e) => {
          const startH = Number(e.target.value)
          // Keep end strictly after start.
          onChange({ startH, endH: Math.max(value.endH, startH + 1) })
        }}
        aria-label={`${label} start`}
        className="rounded-md border border-border bg-surface-2 px-1 py-0.5 text-xs text-text outline-none focus:border-border-strong"
      >
        {startOpts.map((h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
      <span className="text-text-faint">→</span>
      <select
        value={value.endH}
        onChange={(e) => onChange({ ...value, endH: Number(e.target.value) })}
        aria-label={`${label} end`}
        className="rounded-md border border-border bg-surface-2 px-1 py-0.5 text-xs text-text outline-none focus:border-border-strong"
      >
        {endOpts
          .filter((h) => h > value.startH)
          .map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
      </select>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on
          ? 'border-accent/50 bg-accent-soft'
          : 'border-border bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-4 bg-accent' : 'left-0.5 bg-text-faint'
        }`}
      />
    </button>
  )
}

function Stepper({
  label,
  value,
  onDec,
  onReset,
  onInc,
}: {
  label: string
  value: string
  onDec: () => void
  onReset: () => void
  onInc: () => void
}) {
  return (
    <span className="flex items-center rounded-md border border-border text-text-muted">
      <button
        type="button"
        onClick={onDec}
        aria-label={`Smaller ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-l-md text-xs transition-colors hover:bg-surface-2 hover:text-text"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={`Reset ${label}`}
        title="Reset"
        className="h-6 min-w-[3rem] border-x border-border px-1 text-[11px] tabular-nums transition-colors hover:bg-surface-2 hover:text-text"
      >
        {value}
      </button>
      <button
        type="button"
        onClick={onInc}
        aria-label={`Larger ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-r-md text-sm transition-colors hover:bg-surface-2 hover:text-text"
      >
        +
      </button>
    </span>
  )
}

// City search box for the Weather settings block. Submits to
// `geocodeCity` on Enter (or the Search button); shows up to 10
// matches; clicking one fills the parent's location via `onPick`.
// Errors and "no matches" render inline so the user doesn't lose
// the search query on a typo.
function CitySearch({ onPick }: { onPick: (r: GeocodeResult) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Track whether the user has actually run a search yet — distinguishes
  // "nothing typed" from "we ran a query and got zero hits."
  const [didSearch, setDidSearch] = useState(false)

  const run = async () => {
    const query = q.trim()
    if (!query) return
    setSearching(true)
    setErr(null)
    setDidSearch(true)
    try {
      const rows = await geocodeCity(query)
      setResults(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
          placeholder="Search city (e.g. Tromsø)"
          aria-label="Search city"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-text outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={searching || !q.trim()}
          className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>
      {err && (
        <p className="text-[11px] text-danger" role="alert">
          {err}
        </p>
      )}
      {results.length > 0 && (
        <ul
          aria-label="City search results"
          className="max-h-44 overflow-y-auto rounded-md border border-border bg-surface-2"
        >
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(r)
                  // Clear the dropdown but keep the query string so the
                  // user can refine if the first pick was wrong.
                  setResults([])
                  setDidSearch(false)
                }}
                className="block w-full px-2 py-1 text-left text-xs text-text hover:bg-surface"
              >
                <span className="font-medium">{r.name}</span>
                {(r.admin1 || r.country) && (
                  <span className="text-text-faint">
                    {' '}
                    — {[r.admin1, r.country].filter(Boolean).join(', ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {didSearch && !searching && results.length === 0 && !err && (
        <p className="text-[11px] text-text-faint">No matches.</p>
      )}
    </div>
  )
}
