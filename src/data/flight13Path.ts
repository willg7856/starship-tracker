import track from './flight13-ship-track.json'

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

/**
 * Path segments from the Space Notices archive (same series as their
 * yellow Trajectory layer — every archived tracker sample).
 */
export function buildFlightPath(): {
  ascent: Array<[number, number]>
  reentry: Array<[number, number]>
  oceanDrift: Array<[number, number]>
  full: Array<[number, number]>
} {
  const points = getFlightTrack()
  const toLatLon = (p: TrackPoint) => [p.lat, p.lon] as [number, number]

  const ascent = points.slice(0, entryIndex + 1).map(toLatLon)
  const reentry = points.slice(entryIndex, splashIndex + 1).map(toLatLon)
  const oceanDrift = points.slice(splashIndex).map(toLatLon)
  const full = points.map(toLatLon)

  return { ascent, reentry, oceanDrift, full }
}

export function getNoticePolygons(): NoticePolygonGroup[] {
  return (track.noticePolygons ?? []) as NoticePolygonGroup[]
}
