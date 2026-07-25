import track from './flight13-ship-track.json'
import { haversineKm } from '../lib/spacex'

export type LatLon = {
  lat: number
  lon: number
  label?: string
}

export type TrackPoint = {
  t: number
  lat: number
  lon: number
  alt_m: number
}

export type NoticePolygonGroup = {
  id: string
  name: string
  type: string
  polygons: Array<Array<[number, number]>>
}

/**
 * Break ocean-drift polylines when consecutive samples jump farther than this.
 * Keeps real dense Space Notices drift, drops long straight gap connectors.
 */
const MAX_DRIFT_GAP_KM = 1

/** Orbital Launch Pad 2 */
export const LAUNCH_PAD: LatLon = {
  lat: track.points[0]?.lat ?? 25.99684,
  lon: track.points[0]?.lon ?? -97.15804,
  label: 'Starbase Pad 2',
}

export const FLIGHT_PATH_SOURCE = {
  name: track.source,
  url: track.url,
  description: track.description,
}

/** Latest Space Notices trajectory id baked into the static path. */
export const SPACE_NOTICES_BAKED_LATEST_ID: number =
  (track as { spaceNotices?: { latestId?: number } }).spaceNotices
    ?.latestId ??
  (track as { archivedThrough?: { space_notices_id?: number } })
    .archivedThrough?.space_notices_id ??
  0

/**
 * First near-surface SpaceX tracker fix after Flight 13 reentry
 * (from Space Notices archive). Baseline for ocean-drift distance.
 */
export const LANDING_FIX: LatLon = {
  lat: track.landingFix.lat,
  lon: track.landingFix.lon,
  label: track.landingFix.label,
}

/** Last GPS time included in the Space Notices archive — live trail starts after this. */
export const ARCHIVE_END_GPS_TIME: number =
  (track as { archivedThrough?: { gps_time?: number } }).archivedThrough
    ?.gps_time ??
  (typeof track.landingFix.gps_time === 'number'
    ? track.landingFix.gps_time
    : 0)

const entryIndex = track.segments.entry_index
const splashIndex = track.segments.splashdown_index

export function getFlightTrack(): TrackPoint[] {
  return track.points as TrackPoint[]
}

function toLatLon(p: TrackPoint): [number, number] {
  return [p.lat, p.lon]
}

/** Split a path when consecutive points jump farther than maxGapKm. */
export function splitPathByDistanceGap(
  points: Array<[number, number]>,
  maxGapKm = MAX_DRIFT_GAP_KM,
): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []

  for (const point of points) {
    const prev = current[current.length - 1]
    if (
      prev &&
      haversineKm(prev[0], prev[1], point[0], point[1]) > maxGapKm
    ) {
      if (current.length >= 2) segments.push(current)
      current = []
    }
    current.push(point)
  }

  if (current.length >= 2) segments.push(current)
  return segments
}

/**
 * Path segments from the Space Notices Trajectory layer.
 * Ocean drift is split so long straight telemetry gaps are not drawn.
 */
export function buildFlightPath(): {
  ascent: Array<[number, number]>
  reentry: Array<[number, number]>
  oceanDrift: Array<[number, number]>
  oceanDriftSegments: Array<Array<[number, number]>>
  full: Array<[number, number]>
} {
  const points = getFlightTrack()

  const ascent = points.slice(0, entryIndex + 1).map(toLatLon)
  const reentry = points.slice(entryIndex, splashIndex + 1).map(toLatLon)
  const oceanDrift = points.slice(splashIndex).map(toLatLon)
  const oceanDriftSegments = splitPathByDistanceGap(oceanDrift)
  const full = points.map(toLatLon)

  return { ascent, reentry, oceanDrift, oceanDriftSegments, full }
}

export function getNoticePolygons(): NoticePolygonGroup[] {
  return (track.noticePolygons ?? []) as NoticePolygonGroup[]
}
