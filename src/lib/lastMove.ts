import {
  SPLASHDOWN_GPS_TIME,
  SPLASHDOWN_MISSION_TIME,
  type TrackPoint,
} from '../data/flight13Path'
import type { SpaceNoticesPoint } from './spaceNotices'
import { haversineKm } from './spacex'

/** Ignore GPS noise — same threshold as live-trail thinning. */
const MIN_MOVE_M = 15

type PathSample = {
  lat: number
  lon: number
  /** Mission elapsed seconds when available. */
  t: number | null
}

function missionToGps(missionTime: number): number {
  return SPLASHDOWN_GPS_TIME + (missionTime - SPLASHDOWN_MISSION_TIME)
}

function distMeters(
  a: { lat: number; lon: number },
  lat: number,
  lon: number,
): number {
  return haversineKm(a.lat, a.lon, lat, lon) * 1000
}

/**
 * Estimate GPS time when Ship 40 last actually changed position.
 *
 * Uses the shared Space Notices / baked ground track so every device
 * gets the same answer — not browser localStorage.
 */
export function estimateLastMoveGpsTime(
  current: {
    latitude: number
    longitude: number
    gps_time: number
    mission_time: number
  },
  trackPoints: TrackPoint[],
  snExtension: SpaceNoticesPoint[] = [],
): number {
  const samples: PathSample[] = trackPoints.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    t: p.t,
  }))

  let lastT =
    trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].t : 0
  for (const p of snExtension) {
    const prev = samples[samples.length - 1]
    const moved =
      !prev ||
      distMeters(prev, p.latitude, p.longitude) >= MIN_MOVE_M
    if (moved) lastT += 10
    samples.push({
      lat: p.latitude,
      lon: p.longitude,
      t: lastT,
    })
  }

  if (samples.length === 0) return current.gps_time

  let lastFarIdx = -1
  for (let i = 0; i < samples.length; i++) {
    if (distMeters(samples[i], current.latitude, current.longitude) >= MIN_MOVE_M) {
      lastFarIdx = i
    }
  }

  // Current fix is past the end of known history → treat as a fresh move.
  if (lastFarIdx === samples.length - 1) {
    return current.gps_time
  }

  // Never left the current spot in our history — use earliest near sample.
  if (lastFarIdx < 0) {
    const first = samples[0]
    return first.t != null ? missionToGps(first.t) : current.gps_time
  }

  // Arrived at the current position on the sample after the last far point.
  const arrived = samples[lastFarIdx + 1]
  if (arrived?.t != null) return missionToGps(arrived.t)

  return current.gps_time
}
