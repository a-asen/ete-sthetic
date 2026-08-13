import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// Daily-forecast overlay for the calendar grid. Backend: Open-Meteo's
// free forecast API (no key, no rate-limit headers in practice). One
// request returns ~7 days of daily max / min / weather-code which is
// what the month/week views need; v1 doesn't surface the hourly strip
// (that's its own per-view rendering pass).
//
// Storage: location + units in localStorage (per-machine pref), with
// the latest fetched forecast cached alongside for a short TTL so
// view switches don't re-hit the network.

const LOCATION_KEY = 'ete-sthetic.cal.weather.location'
const UNITS_KEY = 'ete-sthetic.cal.weather.units'
const REFRESH_KEY = 'ete-sthetic.cal.weather.refreshMin'
const PAST_DAYS_KEY = 'ete-sthetic.cal.weather.pastDays'
const CACHE_KEY = 'ete-sthetic.cal.weather.cache'

// Cache TTL when refreshMin <= 0 (manual). Otherwise the periodic
// refresh in CalendarView handles the cadence.
const DEFAULT_REFRESH_MIN = 60
// How many days of *observed past* weather to fetch alongside the
// forecast. Open-Meteo's forecast endpoint accepts past_days 0..92 in
// the same single request, so scrolling back a couple of weeks still
// shows actual weather rather than blank cells.
const DEFAULT_PAST_DAYS = 14
const FORECAST_DAYS = 7

export type WeatherUnits = 'metric' | 'imperial'

export interface WeatherLocation {
  // -90..90 / -180..180. Empty / out-of-range = "no location set" — no
  // requests fire until the user enters something valid.
  latitude: number
  longitude: number
  // User-friendly label (e.g. "Tromsø") — display-only.
  label: string
}

export interface DailyForecast {
  // ISO YYYY-MM-DD; matches `dayKey()`'s format so the grid can look
  // up by day directly.
  dayKey: string
  tempMin: number
  tempMax: number
  // Open-Meteo WMO weather code (0..99). Mapped to an emoji + label
  // by `weatherIcon()` / `weatherLabel()`.
  code: number
}

export interface HourlyForecast {
  // `YYYY-MM-DD@HH` — same dayKey() prefix as DailyForecast, with the
  // hour-of-day appended so the time-grid can look up per-hour
  // directly. Hour is local (Open-Meteo's `timezone=auto` aligns the
  // hourly entries with the user's locale).
  key: string
  // Convenience copies of the components so callers don't have to
  // re-parse the key on every render.
  dayKey: string
  hour: number
  temp: number
  // Open-Meteo WMO weather code (0..99). Same mapping as DailyForecast.
  code: number
}

export interface WeatherCache {
  fetchedAt: number
  location: WeatherLocation
  units: WeatherUnits
  // The history horizon (past_days) the cache was fetched with. Used
  // by the staleness check so changing the pref forces a refetch
  // with the new horizon. Older caches without this field decode as
  // undefined and are treated as stale.
  pastDays?: number
  daily: DailyForecast[]
  // Hourly forecast for the same window. Optional for back-compat —
  // older caches missing this field decode as an empty array, and the
  // next refresh repopulates.
  hourly?: HourlyForecast[]
}

// ---- location / units / refresh prefs ----

export function readWeatherLocation(): WeatherLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WeatherLocation>
    const lat = Number(parsed.latitude)
    const lon = Number(parsed.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
    return {
      latitude: lat,
      longitude: lon,
      label: typeof parsed.label === 'string' ? parsed.label : '',
    }
  } catch {
    return null
  }
}

export function writeWeatherLocation(loc: WeatherLocation | null): void {
  try {
    if (loc === null) localStorage.removeItem(LOCATION_KEY)
    else localStorage.setItem(LOCATION_KEY, JSON.stringify(loc))
  } catch {
    // Not fatal — the in-session state still works.
  }
}

export function readWeatherUnits(): WeatherUnits {
  try {
    return localStorage.getItem(UNITS_KEY) === 'imperial'
      ? 'imperial'
      : 'metric'
  } catch {
    return 'metric'
  }
}

export function writeWeatherUnits(units: WeatherUnits): void {
  try {
    localStorage.setItem(UNITS_KEY, units)
  } catch {
    // Non-fatal.
  }
}

export function readWeatherRefresh(): number {
  try {
    const raw = localStorage.getItem(REFRESH_KEY)
    if (raw == null) return DEFAULT_REFRESH_MIN
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return DEFAULT_REFRESH_MIN
    return n
  } catch {
    return DEFAULT_REFRESH_MIN
  }
}

export function writeWeatherRefresh(min: number): void {
  try {
    localStorage.setItem(REFRESH_KEY, String(min))
  } catch {
    // Non-fatal.
  }
}

export const WEATHER_REFRESH_OPTIONS = [0, 30, 60, 240, 720] as const

export function readWeatherPastDays(): number {
  try {
    const raw = localStorage.getItem(PAST_DAYS_KEY)
    if (raw == null) return DEFAULT_PAST_DAYS
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return DEFAULT_PAST_DAYS
    // Open-Meteo caps past_days at 92 on the forecast endpoint.
    return Math.min(92, Math.floor(n))
  } catch {
    return DEFAULT_PAST_DAYS
  }
}

export function writeWeatherPastDays(days: number): void {
  try {
    localStorage.setItem(PAST_DAYS_KEY, String(Math.max(0, Math.min(92, days))))
  } catch {
    // Non-fatal.
  }
}

// History horizons offered in the settings popover. 0 = forecast only;
// the rest are common "look back" windows. 92 is the API's hard cap on
// the forecast endpoint — anything older needs the archive endpoint
// which is a separate fetch path we haven't wired yet.
export const WEATHER_PAST_DAYS_OPTIONS = [0, 7, 14, 30, 60, 92] as const

// ---- cache ----

export function readWeatherCache(): WeatherCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WeatherCache>
    if (
      typeof parsed.fetchedAt !== 'number' ||
      !parsed.location ||
      !Array.isArray(parsed.daily)
    ) {
      return null
    }
    return parsed as WeatherCache
  } catch {
    return null
  }
}

export function writeWeatherCache(cache: WeatherCache | null): void {
  try {
    if (cache === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Non-fatal.
  }
}

// ---- fetch ----

interface OpenMeteoResponse {
  daily?: {
    time?: string[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    weather_code?: number[]
  }
  hourly?: {
    time?: string[]
    temperature_2m?: number[]
    weather_code?: number[]
  }
}

export interface WeatherFetchResult {
  daily: DailyForecast[]
  hourly: HourlyForecast[]
}

// Pull the next 7 days plus the configured past horizon. Open-Meteo's
// forecast endpoint returns dates already in the local timezone (we
// pass `timezone=auto`) so each entry's `time[i]` is a `YYYY-MM-DD`
// matching dayKey(). When `pastDays > 0`, history rows come back in
// the same array — the grid keys them by date and renders them the
// same way it renders forecast rows.
export async function fetchWeather(
  location: WeatherLocation,
  units: WeatherUnits,
  signal?: AbortSignal,
  pastDays: number = readWeatherPastDays(),
): Promise<WeatherFetchResult> {
  const clampedPast = Math.max(0, Math.min(92, Math.floor(pastDays)))
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    hourly: 'temperature_2m,weather_code',
    timezone: 'auto',
    temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
    forecast_days: String(FORECAST_DAYS),
    past_days: String(clampedPast),
  })
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
  const res = await tauriFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
  }
  const body = (await res.json()) as OpenMeteoResponse
  const d = body.daily
  if (
    !d ||
    !Array.isArray(d.time) ||
    !Array.isArray(d.temperature_2m_max) ||
    !Array.isArray(d.temperature_2m_min) ||
    !Array.isArray(d.weather_code)
  ) {
    throw new Error('Unexpected Open-Meteo response shape.')
  }
  const daily: DailyForecast[] = []
  const n = Math.min(
    d.time.length,
    d.temperature_2m_max.length,
    d.temperature_2m_min.length,
    d.weather_code.length,
  )
  for (let i = 0; i < n; i++) {
    daily.push({
      dayKey: d.time[i],
      tempMax: d.temperature_2m_max[i],
      tempMin: d.temperature_2m_min[i],
      code: d.weather_code[i],
    })
  }
  // Hourly is optional in the response shape (we ask for it, but
  // robust to a backend hiccup or older snapshot): just skip when
  // missing.
  const hourly: HourlyForecast[] = []
  const h = body.hourly
  if (
    h &&
    Array.isArray(h.time) &&
    Array.isArray(h.temperature_2m) &&
    Array.isArray(h.weather_code)
  ) {
    const m = Math.min(
      h.time.length,
      h.temperature_2m.length,
      h.weather_code.length,
    )
    for (let i = 0; i < m; i++) {
      // Open-Meteo returns hourly entries as `YYYY-MM-DDTHH:MM`. Split
      // into a separate dayKey + hour for cheap lookup.
      const ts = h.time[i]
      const tMatch = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/)
      if (!tMatch) continue
      const dayKey = tMatch[1]
      const hour = Number(tMatch[2])
      hourly.push({
        key: `${dayKey}@${tMatch[2]}`,
        dayKey,
        hour,
        temp: h.temperature_2m[i],
        code: h.weather_code[i],
      })
    }
  }
  return { daily, hourly }
}

// ---- geocoding (city search) ----

export interface GeocodeResult {
  // Display values straight from Open-Meteo's geocoding response. `label`
  // is the user-friendly composite we build for the location row.
  name: string
  country: string | null
  admin1: string | null
  latitude: number
  longitude: number
  label: string
}

interface OpenMeteoGeocodeResponse {
  results?: {
    name?: string
    country?: string
    admin1?: string
    latitude?: number
    longitude?: number
  }[]
}

// Search Open-Meteo's free geocoding endpoint for a city / place name.
// Returns up to ~10 matches; the user picks one and we store its
// lat/lng + a "Name, Region, Country" label as the location.
export async function geocodeCity(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({
    name: q,
    count: '10',
    language: 'en',
    format: 'json',
  })
  const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
  const res = await tauriFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
  }
  const body = (await res.json()) as OpenMeteoGeocodeResponse
  const rows = body.results ?? []
  const out: GeocodeResult[] = []
  for (const r of rows) {
    if (
      typeof r.name !== 'string' ||
      typeof r.latitude !== 'number' ||
      typeof r.longitude !== 'number'
    ) {
      continue
    }
    const parts = [r.name, r.admin1, r.country].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    out.push({
      name: r.name,
      country: r.country ?? null,
      admin1: r.admin1 ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      label: parts.join(', '),
    })
  }
  return out
}

// ---- WMO weather-code mapping ----
// Source: https://open-meteo.com/en/docs (WMO Weather interpretation
// codes). Grouped into the visual buckets that matter for a one-glance
// calendar overlay; the label is for the tooltip.

export function weatherIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code === 1 || code === 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code >= 85 && code <= 86) return '🌨️'
  if (code >= 95 && code <= 99) return '⛈️'
  return '·'
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code === 1) return 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code === 51) return 'Light drizzle'
  if (code === 53) return 'Drizzle'
  if (code === 55) return 'Heavy drizzle'
  if (code === 56 || code === 57) return 'Freezing drizzle'
  if (code === 61) return 'Light rain'
  if (code === 63) return 'Rain'
  if (code === 65) return 'Heavy rain'
  if (code === 66 || code === 67) return 'Freezing rain'
  if (code === 71) return 'Light snow'
  if (code === 73) return 'Snow'
  if (code === 75) return 'Heavy snow'
  if (code === 77) return 'Snow grains'
  if (code === 80) return 'Light showers'
  if (code === 81) return 'Showers'
  if (code === 82) return 'Heavy showers'
  if (code === 85) return 'Light snow showers'
  if (code === 86) return 'Heavy snow showers'
  if (code === 95) return 'Thunderstorm'
  if (code === 96 || code === 99) return 'Thunderstorm with hail'
  return 'Unknown'
}

export function unitSuffix(units: WeatherUnits): string {
  return units === 'imperial' ? '°F' : '°C'
}

// Compact "5° / 12°" pair for the day cell, omitting the unit on the
// low side so the line fits. The tooltip carries the full label.
export function formatRange(min: number, max: number): string {
  return `${Math.round(min)}° / ${Math.round(max)}°`
}
