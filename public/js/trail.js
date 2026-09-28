import { getFlightTrack, getMeta } from './path.js'
import { haversineKm } from './utils.js'

const STORAGE_KEY = 'bsz-ship41-live-trail-v1'
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

/** Path length through the recorded fixes, in kilometres. */
export function distanceAlongTrailKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let meters = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const next = points[i]
    const a = prev?.r_ecef
    const b = next?.r_ecef
    let segment = null
    if (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length >= 3 &&
      b.length >= 3 &&
      [a[0], a[1], a[2], b[0], b[1], b[2]].every(Number.isFinite)
    ) {
      segment = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    } else if (
      [prev?.latitude, prev?.longitude, next?.latitude, next?.longitude].every(
        Number.isFinite,
      )
    ) {
      const ground =
        haversineKm(prev.latitude, prev.longitude, next.latitude, next.longitude) *
        1000
      const dAlt =
        Number.isFinite(next.altitude) && Number.isFinite(prev.altitude)
          ? next.altitude - prev.altitude
          : 0
      segment = Math.hypot(ground, dAlt)
    }
    if (!Number.isFinite(segment) || segment < 0 || segment > 3_000_000) continue
    meters += segment
  }
  return meters / 1000
}

const WGS84_A = 6378137
const WGS84_E2 = 6.69437999014e-3

function ecefMeters(lat, lon, alt) {
  const φ = (lat * Math.PI) / 180
  const λ = (lon * Math.PI) / 180
  const s = Math.sin(φ)
  const c = Math.cos(φ)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s)
  return [
    (n + alt) * c * Math.cos(λ),
    (n + alt) * c * Math.sin(λ),
    (n * (1 - WGS84_E2) + alt) * s,
  ]
}

function ecefDistanceMeters(a, b) {
  const [ax, ay, az] = ecefMeters(a.lat, a.lon, a.alt)
  const [bx, by, bz] = ecefMeters(b.lat, b.lon, b.alt)
  return Math.hypot(bx - ax, by - ay, bz - az)
}

/** Cruise samples are one SpaceX fix per 30s. Speed is that spacing. */
function orbitalSpeedMs(flight) {
  const dists = []
  for (let i = 1; i < flight.length; i++) {
    if (flight[i - 1].alt > 200_000 && flight[i].alt > 200_000) {
      dists.push(ecefDistanceMeters(flight[i - 1], flight[i]))
    }
  }
  if (dists.length < 4) return 7330
  dists.sort((a, b) => a - b)
  return dists[Math.floor(dists.length / 2)] / 30
}

/**
 * Tracker fixes arrive about every 30s. An isolated step much longer than both
 * neighbors is a late fix, not a burst of speed, so that gap gets more time.
 */
function segmentDurations(flight) {
  const dists = []
  for (let i = 1; i < flight.length; i++) {
    dists.push(ecefDistanceMeters(flight[i - 1], flight[i]))
  }
  const nominal = 30
  return dists.map((d, i) => {
    const prev = dists[i - 1]
    const next = dists[i + 1]
    if (prev > 0 && next > 0) {
      const neighbor = (prev + next) / 2
      const stable = Math.abs(prev - next) / neighbor < 0.25
      if (stable && d > neighbor * 1.2) {
        return Math.min(120, nominal * (d / neighbor))
      }
    }
    return nominal
  })
}

/**
 * Space Notices keeps the flown Ship 41 track (lon, lat, alt), without times.
 * Pin the ends to liftoff and the live SpaceX fix, and space the samples the
 * way they were recorded. Drop anything past the current position.
 */
export function pointsFromNoticesCoordinates(coordinates, anchor, pad) {
  if (!Array.isArray(coordinates) || !anchor || !Number.isFinite(anchor.gps_time)) {
    return []
  }
  const raw = []
  for (const c of coordinates) {
    let lon
    let lat
    let alt
    if (Array.isArray(c)) {
      ;[lon, lat, alt] = c
    } else if (c) {
      lon = c.longitude ?? c.lon
      lat = c.latitude ?? c.lat
      alt = c.altitude ?? c.alt
    }
    if (![lon, lat, alt].every(Number.isFinite)) continue
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    if (alt < -500 || alt > 600_000) continue
    raw.push({ lon, lat, alt })
  }
  const start = raw.findIndex((p) => p.alt >= 200)
  if (start < 0) return []
  let flight = raw.slice(start)
  if (
    Number.isFinite(anchor.latitude) &&
    Number.isFinite(anchor.longitude)
  ) {
    let tip = flight.length - 1
    for (let i = flight.length - 1; i >= 0; i--) {
      const d = haversineKm(flight[i].lat, flight[i].lon, anchor.latitude, anchor.longitude)
      if (d < 40) {
        tip = i
        break
      }
    }
    flight = flight.slice(0, tip + 1)
  }
  if (flight.length < 2) return []

  const speedMs = orbitalSpeedMs(flight)
  const segs = segmentDurations(flight)
  let span = segs.reduce((sum, dt) => sum + dt, 0)
  const tipGapKm = haversineKm(
    flight[flight.length - 1].lat,
    flight[flight.length - 1].lon,
    anchor.latitude,
    anchor.longitude,
  )
  const tipLag =
    Number.isFinite(tipGapKm) && tipGapKm < 2000 ? tipGapKm / (speedMs / 1000) : 0
  const tipGps = anchor.gps_time - tipLag
  const mission = anchor.mission_time
  const liftoffGps =
    Number.isFinite(mission) && mission > 1 && mission < 20 * 3600
      ? anchor.gps_time - mission
      : null
  if (liftoffGps != null && tipGps - liftoffGps > 30 && span > 0) {
    const scale = (tipGps - liftoffGps) / span
    if (scale > 0.5 && scale < 1.5) {
      for (let i = 0; i < segs.length; i++) segs[i] *= scale
      span = tipGps - liftoffGps
    }
  }

  let t = tipGps - span
  const points = []
  if (
    pad &&
    Number.isFinite(pad.lat) &&
    Number.isFinite(pad.lon) &&
    liftoffGps != null &&
    t >= liftoffGps - 1
  ) {
    points.push({
      gps_time: Math.min(liftoffGps, t) - 0.01,
      latitude: pad.lat,
      longitude: pad.lon,
      altitude: 0,
      r_ecef: ecefMeters(pad.lat, pad.lon, 0),
    })
  }
  points.push({
    gps_time: t,
    latitude: flight[0].lat,
    longitude: flight[0].lon,
    altitude: flight[0].alt,
    r_ecef: ecefMeters(flight[0].lat, flight[0].lon, flight[0].alt),
  })
  for (let i = 1; i < flight.length; i++) {
    t += segs[i - 1]
    points.push({
      gps_time: t,
      latitude: flight[i].lat,
      longitude: flight[i].lon,
      altitude: flight[i].alt,
      r_ecef: ecefMeters(flight[i].lat, flight[i].lon, flight[i].alt),
    })
  }
  return points
}

/** Keep the shared track, and add live fixes that are newer than its tip. */
export function mergeTrailAhead(history, local) {
  if (!Array.isArray(history) || history.length === 0) return Array.isArray(local) ? local : []
  const tip = history[history.length - 1].gps_time
  let trail = history
  const newer = (Array.isArray(local) ? local : [])
    .filter((p) => Number.isFinite(p?.gps_time) && p.gps_time > tip + 1)
    .sort((a, b) => a.gps_time - b.gps_time)
  for (const point of newer) trail = appendLiveFix(trail, point)
  return trail
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
  // Keep a trail of live SpaceX fixes in flight and on the surface.
  // Skip obviously invalid / placeholder altitudes from predicted trajectories.
  if (!Number.isFinite(fix.altitude) || fix.altitude < -500 || fix.altitude > 600_000) {
    return trail
  }
  if (!(fix.gps_time > getMeta().archiveEndGpsTime + 0.5)) return trail

  const point = {
    gps_time: fix.gps_time,
    latitude: fix.latitude,
    longitude: fix.longitude,
    altitude: fix.altitude,
    r_ecef: Array.isArray(fix.r_ecef) ? fix.r_ecef.slice(0, 3) : undefined,
  }
  if (!isValidFix(point)) return trail

  const base = thinTrail(pruneToLiveWindow(trail))
  if (base.some((p) => Math.abs(p.gps_time - point.gps_time) < 0.5)) {
    return trail.length === base.length ? trail : base
  }

  const last = base[base.length - 1]
  if (last && distanceMeters(last, point) < MIN_MOVE_M) {
    // Still refresh the tip so the marker trail stays current while hovering.
    if (last.gps_time < point.gps_time) {
      const next = [...base.slice(0, -1), point]
      return next
    }
    return trail.length === base.length ? trail : base
  }

  const next = [...base, point]
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}

/** Estimate when Ship 41 last moved, from shared track (not localStorage). */
export function estimateLastMoveGpsTime(current, snExtension = []) {
  const { splashdownGpsTime, splashdownMissionTime } = getMeta()
  if (
    typeof splashdownGpsTime !== 'number' ||
    typeof splashdownMissionTime !== 'number'
  ) {
    return current.gps_time
  }

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
