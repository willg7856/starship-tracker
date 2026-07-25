/** Direct SpaceX public data sources used by spacex.com's vehicle tracker. */

export const STARSHIP_TRACKER_URL =
  'https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json'

export const MISSION_URL =
  'https://content.spacex.com/api/spacex-website/missions/starship-flight-13'

export const SPACEX_MISSION_PAGE =
  'https://www.spacex.com/launches/starship-flight-13'

export const SPACEX_VEHICLE_TRACKER =
  'https://www.spacex.com/vehicle-tracker'

/** GPS epoch offset used by SpaceX tracker timestamps (approx. incl. leap seconds). */
const GPS_TO_UNIX_OFFSET = 315964800

export type TrackerPoint = {
  time: number
  latitude: number
  longitude: number
  altitude: number
  r_ecef?: [number, number, number]
}

export type ShipCurrent = {
  gps_time: number
  mission_time: number
  altitude: number
  speed: number
  latitude: number
  longitude: number
  r_ecef?: [number, number, number]
}

export type ShipTrack = {
  current: ShipCurrent
  trajectory: TrackerPoint[]
}

export type TrackerMetadata = {
  generation_time: number
  trajectory_version: number
  coordinate_frame: string
  sample_period: number
}

export type StarshipTrackerPayload = Record<
  string,
  ShipTrack | TrackerMetadata | undefined
> & {
  ship40?: ShipTrack
  metadata?: TrackerMetadata
}

export type MissionSummary = {
  title: string
  missionId: string
  paragraphs: { content: string }[]
  vehicleTrackerEnabled: boolean
}

export async function fetchShip40Tracker(
  signal?: AbortSignal,
): Promise<{ ship: ShipTrack; fetchedAt: Date; raw: StarshipTrackerPayload }> {
  const url = `${STARSHIP_TRACKER_URL}?t=${Date.now()}`
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`SpaceX tracker returned ${res.status}`)
  }
  const raw = (await res.json()) as StarshipTrackerPayload
  const ship = raw.ship40
  if (!ship?.current) {
    throw new Error('ship40 not present in SpaceX tracker feed')
  }
  return { ship, fetchedAt: new Date(), raw }
}

export async function fetchMissionSummary(
  signal?: AbortSignal,
): Promise<MissionSummary | null> {
  try {
    const res = await fetch(MISSION_URL, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return {
      title: data.title ?? "Starship's Thirteenth Flight Test",
      missionId: data.missionId ?? 'starship-flight-13',
      paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs : [],
      vehicleTrackerEnabled: Boolean(data.vehicleTrackerEnabled),
    }
  } catch {
    return null
  }
}

export function gpsTimeToDate(gpsTime: number): Date {
  return new Date((gpsTime + GPS_TO_UNIX_OFFSET) * 1000)
}

export function formatMissionClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'T+ 0:00:00'
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return days > 0 ? `T+ ${days}D ${clock}` : `T+ ${clock}`
}

/** SpaceX UI converts m/s → km/h with * 3.6 */
export function formatSpeedKmh(speedMs: number): string {
  if (!Number.isFinite(speedMs) || speedMs < 0) return '0'
  const kmh = Math.round(speedMs * 3.6)
  if (kmh < 0 || kmh > 40000) return '0'
  return kmh.toLocaleString('en-US')
}

/** SpaceX UI converts meters → km */
export function formatAltitudeKm(altitudeM: number): string {
  if (!Number.isFinite(altitudeM)) return '—'
  const km = Math.round(altitudeM / 1000)
  if (km < 0 || km > 2000) {
    // Post-splashdown altitudes can be slightly negative; surface.
    if (altitudeM > -500 && altitudeM < 500) return '0'
    return '—'
  }
  return String(km)
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`
}

export function describeLocation(lat: number, lon: number, altitudeM: number): string {
  const nearSurface = altitudeM > -500 && altitudeM < 2000
  // Indian Ocean splashdown zone for Flight 13
  if (lat < 0 && lon > 90 && lon < 130 && nearSurface) {
    return 'Indian Ocean splashdown zone'
  }
  if (Math.abs(lat - 25.997) < 0.5 && Math.abs(lon + 97.158) < 0.5) {
    return 'Starbase, Texas'
  }
  if (altitudeM > 80000) return 'In flight / exoatmospheric'
  return 'En route'
}
