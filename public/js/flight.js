/**
 * The flight being tracked, discovered server-side from SpaceX's website
 * (/api/flight). Loaded once before the rest of the app so labels, the ship
 * to follow and storage keys all match the current flight.
 *
 * Falls back to the last flight this browser saw, so a slow or failed lookup
 * never blanks the page.
 */

const CACHE_KEY = 'bsz-flight-info-v1'

function readCached() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return saved && Number.isFinite(saved.flight) ? saved : null
  } catch {
    return null
  }
}

export async function fetchFlightInfo(timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/api/flight', { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return null
    const info = await res.json()
    if (!Number.isFinite(info?.flight)) return null
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(info))
    } catch {
      /* ignore */
    }
    return info
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const flight = (await fetchFlightInfo()) ??
  readCached() ?? {
    flight: null,
    slug: null,
    title: 'Starship',
    ship: null,
    plannedLiftoff: null,
    paused: false,
    landingMissionTime: null,
    landingKind: null,
    pad: null,
  }

/** "Flight 15", or "" when unknown. */
export const flightLabel = Number.isFinite(flight.flight) ? `Flight ${flight.flight}` : ''

/** "Ship 42", or "Starship" when the ship is not known yet. */
export const shipLabel = Number.isFinite(flight.ship) ? `Ship ${flight.ship}` : 'Starship'

/** Key in SpaceX's tracker JSON, e.g. "ship42". */
export const shipKey = Number.isFinite(flight.ship) ? `ship${flight.ship}` : null

export const missionPageUrl = flight.slug
  ? `https://www.spacex.com/launches/${flight.slug}`
  : 'https://www.spacex.com/launches/'

/** Per-flight localStorage key, so one flight's history never leaks into the next. */
export function flightStorageKey(name) {
  return `bsz-flight${flight.flight ?? 'x'}-${name}`
}
