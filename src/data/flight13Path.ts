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

export const SPLASHDOWN_FIX: LatLon = {
  lat: track.splashdown.lat,
  lon: track.splashdown.lon,
  label: 'Ship 40 splashdown',
}

const coastEnd = track.segments.coast_end_index
const landingStart = track.segments.landing_start_index

/** Full Ship ground-track points (coast + landing corridor). */
export function getFlightTrack(): TrackPoint[] {
  return track.points as TrackPoint[]
}

/**
 * Display path segments:
 * - coast: Flight Club stage-2 simulation through IO landing-corridor entry
 * - landing: published landing-corridor approach to the SpaceX splashdown fix
 *
 * If a live splashdown fix differs from the bundled one, the landing segment is
 * gently retargeted so the path still ends on the live marker.
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

  // Keep continuity at the splice.
  if (coast.length && landing.length) {
    landing = [coast[coast.length - 1], ...landing]
  }

  if (liveSplashdown && landing.length) {
    const bundled = points[points.length - 1]
    const dLat = liveSplashdown.lat - bundled.lat
    const dLon = liveSplashdown.lon - bundled.lon
    if (Math.abs(dLat) > 1e-5 || Math.abs(dLon) > 1e-5) {
      const n = landing.length
      landing = landing.map(([lat, lon], i) => {
        const w = n <= 1 ? 1 : i / (n - 1)
        return [lat + dLat * w, lon + dLon * w] as [number, number]
      })
    }
  }

  return { coast, landing, full: [...coast, ...landing.slice(1)] }
}

/** Indian Ocean splashdown hazard polygon (Flight Club mission data). */
export function getIndianOceanHazard(): Array<[number, number]> {
  const zone = track.hazardZones?.find((z) =>
    z.vertices.some(([lat, lon]) => lat < -10 && lon > 70),
  )
  return (zone?.vertices ?? []) as Array<[number, number]>
}
