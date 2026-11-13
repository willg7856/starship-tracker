import { flight, shipLabel } from './flight.js'
import { haversineKm } from './utils.js'

const MAX_DRIFT_GAP_KM = 1

let track = null
let meta = null

/** Starbase orbital launch pad, used until the ship's pad position is known. */
const DEFAULT_PAD = { lat: 25.996886, lon: -97.157915 }

/**
 * Pre-flight setup for the discovered flight: the pad the ship is standing
 * on, the planned T-0, and (for a tower catch) the planned landing back at
 * the pad. Everything comes from /api/flight; nothing is baked per flight.
 */
function seedFromFlight() {
  const pad = flight.pad && Number.isFinite(flight.pad.lat) ? flight.pad : DEFAULT_PAD
  const catchAtPad = flight.landingKind === 'catch'
  return {
    vehicle: shipLabel,
    flight: flight.flight,
    phase: 'prelaunch',
    plannedLiftoff: flight.plannedLiftoff,
    points: [{ t: 0, lat: pad.lat, lon: pad.lon }],
    landingFix: catchAtPad
      ? {
          lat: pad.lat,
          lon: pad.lon,
          label: 'Planned tower catch at the launch site',
          kind: 'catch',
          mission_time: Number.isFinite(flight.landingMissionTime)
            ? flight.landingMissionTime
            : undefined,
        }
      : null,
    noticePolygons: [],
  }
}

/** Hazard zones for this flight, if a file was published for it. */
async function loadHazards() {
  if (!Number.isFinite(flight.flight)) return []
  try {
    const res = await fetch(`/data/flight${flight.flight}-hazards.json`, { cache: 'no-cache' })
    if (!res.ok) return []
    const data = await res.json()
    if (data?.flight !== flight.flight || !Array.isArray(data.noticePolygons)) return []
    return data.noticePolygons
  } catch {
    return []
  }
}

export async function loadTrack() {
  if (track) return meta
  track = seedFromFlight()
  track.noticePolygons = await loadHazards()
  const first = track.points?.[0]
  meta = {
    vehicle: track.vehicle || 'Starship',
    flight: track.flight,
    phase: track.phase || 'prelaunch',
    plannedLiftoffMs: (() => {
      if (typeof track.plannedLiftoff === 'string') {
        const ms = Date.parse(track.plannedLiftoff)
        return Number.isFinite(ms) ? ms : null
      }
      return null
    })(),
    launchPad: {
      lat: first?.lat ?? DEFAULT_PAD.lat,
      lon: first?.lon ?? DEFAULT_PAD.lon,
      label: 'Starbase',
    },
    landingFix: track.landingFix
      ? {
          lat: track.landingFix.lat,
          lon: track.landingFix.lon,
          label: track.landingFix.label || 'Planned splashdown',
          kind: track.landingFix.kind === 'catch' ? 'catch' : 'splashdown',
        }
      : null,
    splashdownMissionTime:
      typeof track.landingFix?.mission_time === 'number'
        ? track.landingFix.mission_time
        : null,
    splashdownGpsTime:
      typeof track.landingFix?.gps_time === 'number'
        ? track.landingFix.gps_time
        : null,
    archiveEndGpsTime:
      track.archivedThrough?.gps_time ??
      (typeof track.landingFix?.gps_time === 'number'
        ? track.landingFix.gps_time
        : 0),
    bakedLatestId:
      track.spaceNotices?.latestId ??
      track.archivedThrough?.space_notices_id ??
      0,
    entryIndex: track.segments?.entry_index ?? 0,
    splashIndex: track.segments?.splashdown_index ?? 0,
    hasFlightPath: (track.points?.length ?? 0) >= 2,
    noticePolygons: Array.isArray(track.noticePolygons)
      ? track.noticePolygons
      : [],
  }
  return meta
}

export function getMeta() {
  if (!meta) throw new Error('Track not loaded')
  return meta
}

/** Replace the baked T-0 when SpaceX publishes a new target. */
export function setPlannedLiftoffMs(ms) {
  if (!meta || !Number.isFinite(ms)) return false
  if (meta.plannedLiftoffMs === ms) return false
  meta.plannedLiftoffMs = ms
  return true
}

/** Landing T+ seconds from SpaceX's published flight timeline. */
export function setLandingMissionTime(seconds) {
  if (!meta || !Number.isFinite(seconds) || seconds <= 0) return false
  if (meta.splashdownMissionTime === seconds) return false
  meta.splashdownMissionTime = seconds
  if (meta.landingFix) meta.landingFix.mission_time = seconds
  return true
}

/** Official liftoff from SpaceX mission elapsed time, once the ship is in flight. */
export function setActualLiftoffMs(ms) {
  if (!meta || !Number.isFinite(ms)) return false
  if (
    typeof meta.actualLiftoffMs === 'number' &&
    Math.abs(meta.actualLiftoffMs - ms) < 5000
  ) {
    return false
  }
  meta.actualLiftoffMs = ms
  return true
}

export function getFlightTrack() {
  return track.points || []
}

export function getNoticePolygons() {
  return getMeta().noticePolygons || []
}

export function splitPathByDistanceGap(points, maxGapKm = MAX_DRIFT_GAP_KM) {
  const segments = []
  let current = []
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

export function buildFlightPath() {
  const points = getFlightTrack()
  const { entryIndex, splashIndex, hasFlightPath } = getMeta()
  const toLatLon = (p) => [p.lat, p.lon]
  if (!hasFlightPath) {
    return {
      ascent: [],
      reentry: [],
      oceanDriftSegments: [],
      full: points.map(toLatLon),
    }
  }
  const ascent = points.slice(0, entryIndex + 1).map(toLatLon)
  const reentry = points.slice(entryIndex, splashIndex + 1).map(toLatLon)
  const oceanDrift = points.slice(splashIndex).map(toLatLon)
  return {
    ascent,
    reentry,
    oceanDriftSegments: splitPathByDistanceGap(oceanDrift),
    full: points.map(toLatLon),
  }
}
