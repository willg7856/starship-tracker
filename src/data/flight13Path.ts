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

const entryIndex = track.segments.entry_index ?? track.segments.coast_end_index

export function getFlightTrack(): TrackPoint[] {
  return track.points as TrackPoint[]
}

/**
 * Display path:
 * - coast: exoatmospheric / high-altitude track
 * - landing: from ~entry interface down to splashdown
 * Both come from the same archived SpaceX tracker series.
 */
export function buildFlightPath(): {
  coast: Array<[number, number]>
  landing: Array<[number, number]>
  full: Array<[number, number]>
} {
  const points = getFlightTrack()
  const coast = points
    .slice(0, entryIndex + 1)
    .map((p) => [p.lat, p.lon] as [number, number])
  let landing = points
    .slice(entryIndex)
    .map((p) => [p.lat, p.lon] as [number, number])
  if (coast.length && landing.length) {
    landing = [coast[coast.length - 1], ...landing.slice(1)]
  }
  return { coast, landing, full: [...coast, ...landing.slice(1)] }
}

export function getNoticePolygons(): NoticePolygonGroup[] {
  return (track.noticePolygons ?? []) as NoticePolygonGroup[]
}
