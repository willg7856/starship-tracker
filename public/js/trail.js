import { getFlightTrack, getMeta } from './path.js'
import { haversineKm, isNearSurface } from './utils.js'

const STORAGE_KEY = 'bsz-ship40-live-trail-v3'
const MAX_POINTS = 20_000
const MIN_MOVE_M = 40

function isValidFix(point) {
  return (
    Number.isFinite(point.gps_time) &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  )
}

function distanceMeters(a, b) {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000
}

function pruneToLiveWindow(points) {
  const end = getMeta().archiveEndGpsTime
  return points.filter((p) => p.gps_time > end + 0.5)
}

export function thinTrail(points, minMoveM = MIN_MOVE_M) {
  if (points.length <= 2) return points
  const sorted = [...points].sort((a, b) => a.gps_time - b.gps_time)
  const out = [sorted[0]]
  for (let i = 1; i < sorted.length - 1; i++) {
    if (distanceMeters(out[out.length - 1], sorted[i]) >= minMoveM) {
      out.push(sorted[i])
    }
  }
  const last = sorted[sorted.length - 1]
  const prev = out[out.length - 1]
  if (prev.gps_time !== last.gps_time) {
    if (distanceMeters(prev, last) < minMoveM && out.length > 1) {
      out[out.length - 1] = last
    } else {
      out.push(last)
    }
  }
  return out
}

export function thinLatLonPath(points, minMoveM = MIN_MOVE_M) {
  if (points.length <= 2) return points
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    const d = haversineKm(prev[0], prev[1], points[i][0], points[i][1]) * 1000
    if (d >= minMoveM) out.push(points[i])
  }
  const last = points[points.length - 1]
  const prev = out[out.length - 1]
  const dLast = haversineKm(prev[0], prev[1], last[0], last[1]) * 1000
  if (dLast < minMoveM && out.length > 1) out[out.length - 1] = last
  else if (dLast >= minMoveM || out.length === 1) out.push(last)
  return out
}

export function loadLiveTrail() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const points = parsed
      .filter(
        (p) =>
          p &&
          typeof p.gps_time === 'number' &&
          typeof p.latitude === 'number' &&
          typeof p.longitude === 'number' &&
          isValidFix(p),
      )
      .sort((a, b) => a.gps_time - b.gps_time)
    return thinTrail(pruneToLiveWindow(points)).slice(-MAX_POINTS)
  } catch {
    return []
  }
}

export function saveLiveTrail(points) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(thinTrail(pruneToLiveWindow(points)).slice(-MAX_POINTS)),
    )
  } catch {
    /* private mode / quota */
  }
}

export function appendLiveFix(trail, fix) {
  if (!isNearSurface(fix.altitude)) return trail
  if (!(fix.gps_time > getMeta().archiveEndGpsTime + 0.5)) return trail

  const point = {
    gps_time: fix.gps_time,
    latitude: fix.latitude,
    longitude: fix.longitude,
  }
  if (!isValidFix(point)) return trail

  const base = thinTrail(pruneToLiveWindow(trail))
  if (base.some((p) => Math.abs(p.gps_time - point.gps_time) < 0.5)) {
    return trail.length === base.length ? trail : base
  }

  const last = base[base.length - 1]
  if (last && distanceMeters(last, point) < MIN_MOVE_M) {
    return trail.length === base.length ? trail : base
  }

  const next = [...base, point]
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}

/** Estimate when Ship 40 last moved, from shared track (not localStorage). */
export function estimateLastMoveGpsTime(current, snExtension = []) {
  const { splashdownGpsTime, splashdownMissionTime } = getMeta()
  const trackPoints = getFlightTrack()
  const samples = trackPoints.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t }))
  let lastT = trackPoints.length ? trackPoints[trackPoints.length - 1].t : 0

  for (const p of snExtension) {
    const prev = samples[samples.length - 1]
    const moved =
      !prev ||
      haversineKm(prev.lat, prev.lon, p.latitude, p.longitude) * 1000 >= 15
    if (moved) lastT += 10
    samples.push({ lat: p.latitude, lon: p.longitude, t: lastT })
  }

  if (!samples.length) return current.gps_time

  let lastFarIdx = -1
  for (let i = 0; i < samples.length; i++) {
    const d =
      haversineKm(
        samples[i].lat,
        samples[i].lon,
        current.latitude,
        current.longitude,
      ) * 1000
    if (d >= 15) lastFarIdx = i
  }

  const missionToGps = (missionTime) =>
    splashdownGpsTime + (missionTime - splashdownMissionTime)

  if (lastFarIdx === samples.length - 1) return current.gps_time
  if (lastFarIdx < 0) {
    const first = samples[0]
    return first.t != null ? missionToGps(first.t) : current.gps_time
  }
  const arrived = samples[lastFarIdx + 1]
  if (arrived?.t != null) return missionToGps(arrived.t)
  return current.gps_time
}
