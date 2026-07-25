import { ARCHIVE_END_GPS_TIME } from '../data/flight13Path'
import { haversineKm, isNearSurface } from './spacex'

export type LiveTrailPoint = {
  gps_time: number
  latitude: number
  longitude: number
}

/** Bumped to drop old jittery trails saved in browsers. */
const STORAGE_KEY = 'bsz-ship40-live-trail-v2'
const MAX_POINTS = 20_000
/** Ignore GPS noise — only keep fixes that moved at least this far. */
const MIN_MOVE_M = 40

function isValidFix(point: LiveTrailPoint): boolean {
  return (
    Number.isFinite(point.gps_time) &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  )
}

function distanceMeters(a: LiveTrailPoint, b: LiveTrailPoint): number {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000
}

/** Keep only fixes newer than the Space Notices archive end. */
export function pruneToLiveWindow(points: LiveTrailPoint[]): LiveTrailPoint[] {
  return points.filter((p) => p.gps_time > ARCHIVE_END_GPS_TIME + 0.5)
}

/**
 * Drop GPS jitter by requiring a minimum move between kept samples.
 * Always preserves the first and last points.
 */
export function thinTrail(
  points: LiveTrailPoint[],
  minMoveM = MIN_MOVE_M,
): LiveTrailPoint[] {
  if (points.length <= 2) return points
  const sorted = [...points].sort((a, b) => a.gps_time - b.gps_time)
  const out: LiveTrailPoint[] = [sorted[0]]
  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = out[out.length - 1]
    if (distanceMeters(prev, sorted[i]) >= minMoveM) out.push(sorted[i])
  }
  const last = sorted[sorted.length - 1]
  const prev = out[out.length - 1]
  if (prev.gps_time !== last.gps_time) {
    if (distanceMeters(prev, last) < minMoveM && out.length > 1) {
      out[out.length - 1] = last
    } else {
      out.push(last)
    }
  }
  return out
}

/** Thin a lat/lon polyline the same way (for archived drift display). */
export function thinLatLonPath(
  points: Array<[number, number]>,
  minMoveM = MIN_MOVE_M,
): Array<[number, number]> {
  if (points.length <= 2) return points
  const out: Array<[number, number]> = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    const d =
      haversineKm(prev[0], prev[1], points[i][0], points[i][1]) * 1000
    if (d >= minMoveM) out.push(points[i])
  }
  const last = points[points.length - 1]
  const prev = out[out.length - 1]
  const dLast = haversineKm(prev[0], prev[1], last[0], last[1]) * 1000
  if (dLast < minMoveM && out.length > 1) out[out.length - 1] = last
  else if (dLast >= minMoveM || out.length === 1) out.push(last)
  return out
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
    return thinTrail(pruneToLiveWindow(points)).slice(-MAX_POINTS)
  } catch {
    return []
  }
}

export function saveLiveTrail(points: LiveTrailPoint[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(thinTrail(pruneToLiveWindow(points)).slice(-MAX_POINTS)),
    )
  } catch {
    // Quota / private mode — trail still works in-memory for the session.
  }
}

/**
 * Append a SpaceX current fix when the ship is near the surface.
 * Only records samples after the Space Notices archive ends, and only if
 * the ship moved enough to beat GPS noise.
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

  const base = thinTrail(pruneToLiveWindow(trail))
  if (base.some((p) => Math.abs(p.gps_time - point.gps_time) < 0.5)) {
    return trail.length === base.length ? trail : base
  }

  const last = base[base.length - 1]
  if (last && distanceMeters(last, point) < MIN_MOVE_M) {
    // Ignore GPS jitter — the live marker still uses the raw current fix.
    return trail.length === base.length ? trail : base
  }

  const next = [...base, point]
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}
