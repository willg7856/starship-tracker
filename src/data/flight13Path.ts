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

/** Flight Club stage-2 ground track for Flight 13 (Ship). */
export function getFlightClubTrack(): TrackPoint[] {
  return track.points as TrackPoint[]
}

/**
 * Full display path: Flight Club simulated Ship track, then a final leg to the
 * live SpaceX splashdown fix (sim ends before touchdown).
 */
export function buildFlightPath(splashdown: LatLon): {
  simulated: Array<[number, number]>
  toSplashdown: Array<[number, number]>
} {
  const simulated = getFlightClubTrack().map(
    (p) => [p.lat, p.lon] as [number, number],
  )
  const last = simulated[simulated.length - 1]
  const toSplashdown: Array<[number, number]> = last
    ? [last, [splashdown.lat, splashdown.lon]]
    : [[splashdown.lat, splashdown.lon]]
  return { simulated, toSplashdown }
}
