import { haversineKm } from './utils.js'

const MAX_DRIFT_GAP_KM = 1

let track = null
let meta = null

export async function loadTrack() {
  if (track) return meta
  const res = await fetch('/data/flight14-ship-track.json')
  if (!res.ok) throw new Error('Failed to load flight path')
  track = await res.json()
  const first = track.points?.[0]
  meta = {
    vehicle: track.vehicle || 'Ship 41',
    flight: track.flight || 14,
    phase: track.phase || 'prelaunch',
    plannedLiftoffMs: (() => {
      if (typeof track.plannedLiftoff === 'string') {
        const ms = Date.parse(track.plannedLiftoff)
        return Number.isFinite(ms) ? ms : null
      }
      return null
    })(),
    launchPad: {
      lat: first?.lat ?? 25.99684,
      lon: first?.lon ?? -97.15804,
      label: 'Starbase Pad 2',
    },
    landingFix: track.landingFix
      ? {
          lat: track.landingFix.lat,
          lon: track.landingFix.lon,
          label: track.landingFix.label || 'Planned splashdown',
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
