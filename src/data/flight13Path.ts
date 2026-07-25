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

/** Orbital Launch Pad 2 from Flight Club / Launch Library */
export const LAUNCH_PAD: LatLon = {
  lat: track.points[0]?.lat ?? 25.99667,
  lon: track.points[0]?.lon ?? -97.15729,
  label: 'Starbase Pad 2',
}

export const FLIGHT_PATH_SOURCE = {
  name: track.source,
  url: track.url,
  simulationId: track.simulationId,
  description: track.description,
}

/** First public SpaceX splashdown fix after Flight 13 landing (frozen for drift). */
export const LANDING_FIX: LatLon = {
  lat: track.landingFix?.lat ?? track.splashdown.lat,
  lon: track.landingFix?.lon ?? track.splashdown.lon,
  label: track.landingFix?.label ?? 'Splashdown',
}

const coastEnd = track.segments.coast_end_index
const landingStart = track.segments.landing_start_index

export function getFlightTrack(): TrackPoint[] {
  return track.points as TrackPoint[]
}

export function getBoosterTrack(): Array<[number, number]> {
  return ((track.boosterPoints ?? []) as TrackPoint[]).map(
    (p) => [p.lat, p.lon] as [number, number],
  )
}

/**
 * Display path segments:
 * - coast: Flight Club stage-2 simulation into the Indian Ocean
 * - landing: FAA Stage 2 reentry corridor approach to splashdown
 */
export function buildFlightPath(liveSplashdown?: LatLon): {
  coast: Array<[number, number]>
  landing: Array<[number, number]>
  full: Array<[number, number]>
} {
  const points = getFlightTrack()
  const coast = points
    .slice(0, coastEnd + 1)
    .map((p) => [p.lat, p.lon] as [number, number])

  let landing = points
    .slice(landingStart)
    .map((p) => [p.lat, p.lon] as [number, number])

  if (coast.length && landing.length) {
    landing = [coast[coast.length - 1], ...landing]
  }

  // Keep the frozen landing fix as the path end; live marker may drift away.
  void liveSplashdown

  return { coast, landing, full: [...coast, ...landing.slice(1)] }
}

export function getIndianOceanHazard(): Array<[number, number]> {
  const zone = track.hazardZones?.find((z) =>
    (z.kind === 'indian_ocean_splashdown') ||
    z.vertices.some(([lat, lon]) => lat < -10 && lon > 70),
  )
  return (zone?.vertices ?? []) as Array<[number, number]>
}

export function getFaaReentryCorridor(): Array<[number, number]> {
  return (track.faaReentryCorridor ?? []) as Array<[number, number]>
}

export function getAscentHazard(): Array<[number, number]> {
  const zone = track.hazardZones?.find((z) => z.kind === 'ascent_caribbean')
  return (zone?.vertices ?? []) as Array<[number, number]>
}
