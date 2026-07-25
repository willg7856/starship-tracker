/**
 * Flight 13 Ship 40 ground-track waypoints.
 *
 * SpaceX's public tracker JSON only keeps a short forward prediction after
 * splashdown — it does not archive the ascent trail. These waypoints follow
 * the published southeast corridor (Starbase → Gulf → between Cuba/Yucatán →
 * Atlantic → Indian Ocean) from the Flight 13 mission briefing / FAA AHA
 * charts, ending at the live SpaceX splashdown fix.
 */

export type LatLon = {
  lat: number
  lon: number
  label?: string
}

/** Orbital Launch Pad 2, Starbase — Launch Library / SpaceX pad coords */
export const LAUNCH_PAD: LatLon = {
  lat: 25.99677,
  lon: -97.15799,
  label: 'Starbase Pad 2',
}

/**
 * Nominal corridor checkpoints for Ship 40 on Flight 13.
 * Splashdown is appended dynamically from the live SpaceX tracker fix.
 */
export const FLIGHT13_CORRIDOR: LatLon[] = [
  LAUNCH_PAD,
  { lat: 25.2, lon: -94.8, label: 'Gulf ascent' },
  { lat: 23.8, lon: -91.2 },
  { lat: 22.4, lon: -87.6, label: 'Yucatán Channel' },
  { lat: 20.6, lon: -83.5 },
  { lat: 19.0, lon: -78.8, label: 'South of Cuba' },
  { lat: 17.6, lon: -73.5 },
  { lat: 16.2, lon: -66.5 },
  { lat: 14.8, lon: -58.0 },
  { lat: 13.2, lon: -48.0, label: 'Mid-Atlantic' },
  { lat: 11.0, lon: -36.0 },
  { lat: 8.5, lon: -22.0 },
  { lat: 5.8, lon: -8.0 },
  { lat: 3.0, lon: 8.0, label: 'West Africa coast' },
  { lat: 0.5, lon: 24.0 },
  { lat: -2.5, lon: 40.0 },
  { lat: -6.0, lon: 56.0 },
  { lat: -10.0, lon: 72.0 },
  { lat: -13.5, lon: 88.0 },
  { lat: -16.0, lon: 98.5, label: 'Indian Ocean approach' },
]

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Spherical interpolation between two lat/lon points. */
function slerp(
  a: LatLon,
  b: LatLon,
  segments: number,
): Array<[number, number]> {
  const lat1 = toRad(a.lat)
  const lon1 = toRad(a.lon)
  const lat2 = toRad(b.lat)
  const lon2 = toRad(b.lon)

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    )

  if (!Number.isFinite(d) || d < 1e-9) {
    return [[a.lat, a.lon]]
  }

  const out: Array<[number, number]> = []
  for (let i = 0; i <= segments; i++) {
    const f = i / segments
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x =
      A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y =
      A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    out.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))])
  }
  return out
}

/** Build a dense ground track ending at the live splashdown fix. */
export function buildFlightPath(
  splashdown: LatLon,
  segmentsPerLeg = 8,
): Array<[number, number]> {
  const nodes = [...FLIGHT13_CORRIDOR, { ...splashdown, label: 'Splashdown' }]
  const path: Array<[number, number]> = []

  for (let i = 0; i < nodes.length - 1; i++) {
    const leg = slerp(nodes[i], nodes[i + 1], segmentsPerLeg)
    // drop first point of subsequent legs to avoid duplicates
    path.push(...(i === 0 ? leg : leg.slice(1)))
  }

  return path
}
