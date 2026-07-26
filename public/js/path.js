import { haversineKm } from './utils.js'

const MAX_DRIFT_GAP_KM = 1

let track = null
let meta = null

export async function loadTrack() {
  if (track) return meta
  const res = await fetch('/data/flight13-ship-track.json')
  if (!res.ok) throw new Error('Failed to load flight path')
  track = await res.json()
  meta = {
    launchPad: {
      lat: track.points[0]?.lat ?? 25.99684,
      lon: track.points[0]?.lon ?? -97.15804,
      label: 'Starbase Pad 2',
    },
    landingFix: {
      lat: track.landingFix.lat,
      lon: track.landingFix.lon,
      label: track.landingFix.label,
    },
    splashdownMissionTime:
      typeof track.landingFix.mission_time === 'number'
        ? track.landingFix.mission_time
        : 3990.1,
    splashdownGpsTime:
      typeof track.landingFix.gps_time === 'number'
        ? track.landingFix.gps_time
        : 0,
    archiveEndGpsTime:
      track.archivedThrough?.gps_time ??
      (typeof track.landingFix.gps_time === 'number'
        ? track.landingFix.gps_time
        : 0),
    bakedLatestId:
      track.spaceNotices?.latestId ??
      track.archivedThrough?.space_notices_id ??
      0,
    entryIndex: track.segments.entry_index,
    splashIndex: track.segments.splashdown_index,
  }
  return meta
}

export function getMeta() {
  if (!meta) throw new Error('Track not loaded')
  return meta
}

export function getFlightTrack() {
  return track.points
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
  const { entryIndex, splashIndex } = getMeta()
  const toLatLon = (p) => [p.lat, p.lon]
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
