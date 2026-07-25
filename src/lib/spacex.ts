/**
 * Browser calls same-origin API routes that proxy SpaceX's public feeds.
 * Direct browser calls to Azure CDN fail CORS from custom domains.
 */

export const STARSHIP_TRACKER_URL = '/api/tracker'
export const MISSION_URL = '/api/mission'

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
    const res = await fetch(MISSION_URL, { signal })
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

/** Great-circle distance in kilometers. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371.0088
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Initial bearing from point 1 → 2, degrees clockwise from north. */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180) / Math.PI
}

export function formatBearingCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return dirs[i]
}

export function formatDriftDistance(km: number): string {
  if (!Number.isFinite(km)) return '—'
  if (km < 0.05) return '0 m'
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(2)} km`
  return `${km.toFixed(1)} km`
}

/** Elapsed ocean-drift duration since splashdown. */
export function formatDriftDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days}D ${h}H`
  if (h > 0) return `${h}H ${String(m).padStart(2, '0')}M`
  if (m > 0) return `${m}M`
  return `${total}S`
}

export function isNearSurface(altitudeM: number): boolean {
  return Number.isFinite(altitudeM) && altitudeM > -500 && altitudeM < 2000
}
