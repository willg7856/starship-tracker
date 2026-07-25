import { ARCHIVE_END_GPS_TIME } from '../data/flight13Path'
import { isNearSurface } from './spacex'

export type LiveTrailPoint = {
  gps_time: number
  latitude: number
  longitude: number
}

const STORAGE_KEY = 'bsz-ship40-live-trail-v1'
const MAX_POINTS = 20_000

function isValidFix(point: LiveTrailPoint): boolean {
  return (
    Number.isFinite(point.gps_time) &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  )
}

/** Keep only fixes newer than the Space Notices archive end. */
export function pruneToLiveWindow(points: LiveTrailPoint[]): LiveTrailPoint[] {
  return points.filter((p) => p.gps_time > ARCHIVE_END_GPS_TIME + 0.5)
}

export function loadLiveTrail(): LiveTrailPoint[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const points = parsed
      .filter(
        (p): p is LiveTrailPoint =>
          !!p &&
          typeof p === 'object' &&
          typeof (p as LiveTrailPoint).gps_time === 'number' &&
          typeof (p as LiveTrailPoint).latitude === 'number' &&
          typeof (p as LiveTrailPoint).longitude === 'number' &&
          isValidFix(p as LiveTrailPoint),
      )
      .sort((a, b) => a.gps_time - b.gps_time)
    return pruneToLiveWindow(points).slice(-MAX_POINTS)
  } catch {
    return []
  }
}

export function saveLiveTrail(points: LiveTrailPoint[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(pruneToLiveWindow(points).slice(-MAX_POINTS)),
    )
  } catch {
    // Quota / private mode — trail still works in-memory for the session.
  }
}

/**
 * Append a SpaceX current fix when the ship is near the surface.
 * Only records samples after the Space Notices archive ends.
 * Dedupes by gps_time so repeated polls of the same sample are ignored.
 */
export function appendLiveFix(
  trail: LiveTrailPoint[],
  fix: {
    gps_time: number
    latitude: number
    longitude: number
    altitude: number
  },
): LiveTrailPoint[] {
  if (!isNearSurface(fix.altitude)) return trail
  if (!(fix.gps_time > ARCHIVE_END_GPS_TIME + 0.5)) return trail

  const point: LiveTrailPoint = {
    gps_time: fix.gps_time,
    latitude: fix.latitude,
    longitude: fix.longitude,
  }
  if (!isValidFix(point)) return trail

  const base = pruneToLiveWindow(trail)
  if (base.some((p) => Math.abs(p.gps_time - point.gps_time) < 0.5)) {
    return trail.length === base.length ? trail : base
  }

  const next = [...base, point].sort((a, b) => a.gps_time - b.gps_time)
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}
