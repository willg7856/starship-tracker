/**
 * Estimated ship position from a published orbit, for flights where SpaceX's
 * live vehicle tracker is off. /api/orbit supplies the best orbit it can find
 * (the ship's own catalogue entry, or SpaceX's orbit for the Starlink batch
 * the ship deployed); without one, a planned orbit is modelled from the launch
 * site, SpaceX's T-0 and its flight timeline. SGP4 turns either into a fix
 * shaped like SpaceX's tracker data, so the map and readouts work
 * unchanged.
 *
 * Phases (mission time from SpaceX's flight timeline):
 *  - orbit:   engine cutoff to entry interface, from the orbit above
 *  - reentry: entry to the catch, along the planned re-entry path into
 *             Starbase (great circle from the far end of the official
 *             re-entry hazard area to the pad)
 *  - landed:  after the planned catch time, at the pad
 */
import * as sat from './vendor/satellite.es.js'
import { flight } from './flight.js'
import { getMeta, getNoticePolygons } from './path.js'
import { GPS_TO_UNIX_OFFSET } from './utils.js'

const EARTH_MU = 398600.4418 // km^3/s^2
const EARTH_R = 6378.137 // km
// Flight 14 / 15 orbits: ~270 km at 30.5 degrees (Celestrak STARSHIP-14).
const MODEL_ALT_KM = 270
const MODEL_INC_DEG = 30.5
const TRAIL_STEP_S = 30
// The whole flight (up to the 36 h a flight stays current).
const TRAIL_MAX_S = 36 * 3600

let orbit = null // { source, label, satrec }
// The Starlink batch the ship deployed, tracked on its own for comparison.
let payload = null // { name, satrec, epoch }
const EARTH_SPIN = 7.2921159e-5 // rad/s

/**
 * Speed relative to the ground below (m/s), the way SpaceX's tracker and
 * webcast report it: inertial velocity minus the Earth's rotation.
 */
function groundRelativeSpeed(pv, gmst) {
  const c = Math.cos(gmst)
  const s = Math.sin(gmst)
  const r = pv.position
  const v = pv.velocity
  const rx = c * r.x + s * r.y
  const ry = -s * r.x + c * r.y
  const vx = c * v.x + s * v.y + EARTH_SPIN * ry
  const vy = -s * v.x + c * v.y - EARTH_SPIN * rx
  return Math.hypot(vx, vy, v.z) * 1000
}

function timelineSeconds(pattern, fallback) {
  const e = (flight.timeline || []).find((x) => pattern.test(x.label))
  return Number.isFinite(e?.t) ? e.t : fallback
}

/**
 * Mission-time milestones: engine cutoff (on orbit from here), deorbit burn,
 * entry interface (orbit estimate ends), and landing.
 */
export function orbitWindow() {
  const landing = Number.isFinite(flight.landingMissionTime) ? flight.landingMissionTime : 22 * 3600
  const deorbit = timelineSeconds(/deorbit burn start/i, landing - 3600)
  const entry = timelineSeconds(/starship entry|entry interface/i, landing - 1300)
  return {
    from: timelineSeconds(/starship engine cutoff|\bSECO\b/i, 9 * 60),
    deorbit,
    to: Math.max(deorbit, entry),
    landing,
  }
}

const ENTRY_ALT_M = 120_000

function toVec(lat, lon) {
  const φ = (lat * Math.PI) / 180
  const λ = (lon * Math.PI) / 180
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)]
}

function fromVec([x, y, z]) {
  return [(Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI]
}

/** Point a fraction f along the great circle a -> b (both [lat, lon]). */
function slerp(a, b, f) {
  const va = toVec(a[0], a[1])
  const vb = toVec(b[0], b[1])
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))
  const ω = Math.acos(dot)
  if (ω < 1e-9) return a
  const ka = Math.sin((1 - f) * ω) / Math.sin(ω)
  const kb = Math.sin(f * ω) / Math.sin(ω)
  return fromVec([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]])
}

function greatCircleKm(a, b) {
  const va = toVec(a[0], a[1])
  const vb = toVec(b[0], b[1])
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))
  return Math.acos(dot) * EARTH_R
}

/**
 * The planned re-entry into the launch site for a tower catch: from the
 * point of the official re-entry hazard area farthest from the pad, along a
 * great circle to the pad. Null without hazard data or for a splashdown.
 */
export function plannedReentry() {
  if (flight.landingKind !== 'catch') return null
  let pad
  try {
    pad = getMeta().launchPad
  } catch {
    return null
  }
  const group = (getNoticePolygons() || []).find((n) => n.id === 'hazard-reentry')
  if (!group) return null
  const padLL = [pad.lat, pad.lon]
  let start = null
  let best = 0
  for (const ring of group.polygons || []) {
    for (const p of ring) {
      const lon = ((((p[1] + 180) % 360) + 360) % 360) - 180
      const d = greatCircleKm([p[0], lon], padLL)
      if (d > best && d < 6000) {
        best = d
        start = [p[0], lon]
      }
    }
  }
  if (!start || best < 300) return null
  return { start, end: padLL, km: best }
}

/** Points along the planned re-entry path, for drawing it. */
export function plannedReentryPath(samples = 64) {
  const path = plannedReentry()
  if (!path) return null
  const out = []
  for (let i = 0; i <= samples; i++) out.push(slerp(path.start, path.end, i / samples))
  return out
}

/**
 * Entry to catch: most ground is covered early at near-orbital speed, then
 * the ship slows and drops to the tower. s(τ) = 1 - (1 - τ)^K.
 */
const REENTRY_K = 2.3
function reentryFixAt(ms, met, w) {
  const path = plannedReentry()
  if (!path) return null
  const span = w.landing - w.to
  if (!(span > 0)) return null
  const τ = Math.min(1, Math.max(0, (met - w.to) / span))
  const along = 1 - (1 - τ) ** REENTRY_K
  const [lat, lon] = slerp(path.start, path.end, along)
  const speed = (REENTRY_K * (1 - τ) ** (REENTRY_K - 1) * path.km * 1000) / span
  return {
    gps_time: ms / 1000 - GPS_TO_UNIX_OFFSET,
    mission_time: met,
    latitude: lat,
    longitude: lon,
    altitude: ENTRY_ALT_M * (1 - τ) ** 1.6,
    speed,
    estimated: 'reentry',
  }
}

function liftoffMs() {
  try {
    const m = getMeta()
    return m.actualLiftoffMs ?? m.plannedLiftoffMs
  } catch {
    return null
  }
}

function isoNoZ(ms) {
  return new Date(ms).toISOString().replace('Z', '')
}

/**
 * Planned orbit with no published elements: circular, MODEL_ALT_KM high at
 * MODEL_INC_DEG, in the plane through the launch site on its southbound
 * (east-south-east) pass at liftoff, with the ship ~18 degrees downrange at
 * engine cutoff.
 */
function modelOmm(t0Ms) {
  const pad = getMeta().launchPad
  const inc = (MODEL_INC_DEG * Math.PI) / 180
  const lat = (pad.lat * Math.PI) / 180
  const ratio = Math.min(1, Math.sin(lat) / Math.sin(inc))
  const uLaunch = Math.PI - Math.asin(ratio) // southbound pass
  const lonInertial = (pad.lon * Math.PI) / 180 + sat.gstime(new Date(t0Ms))
  const raan = lonInertial - Math.atan2(Math.cos(inc) * Math.sin(uLaunch), Math.cos(uLaunch))
  const { from } = orbitWindow()
  const epochMs = t0Ms + from * 1000
  const u0 = uLaunch + (18 * Math.PI) / 180
  const a = EARTH_R + MODEL_ALT_KM
  const revPerDay = (Math.sqrt(EARTH_MU / a ** 3) * 86400) / (2 * Math.PI)
  const deg = (r) => ((((r * 180) / Math.PI) % 360) + 360) % 360
  return {
    OBJECT_NAME: 'MODELLED ORBIT',
    OBJECT_ID: 'MODEL',
    EPOCH: isoNoZ(epochMs),
    MEAN_MOTION: revPerDay,
    ECCENTRICITY: 0.0001,
    INCLINATION: MODEL_INC_DEG,
    RA_OF_ASC_NODE: deg(raan),
    ARG_OF_PERICENTER: 0,
    MEAN_ANOMALY: deg(u0),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: 99999,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 0,
    BSTAR: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  }
}

/** Fetch the best published orbit; fall back to the modelled one. Returns true if the source changed. */
export async function refreshOrbit() {
  const before = orbit?.source + orbit?.epoch
  // The published-orbit lookup can take several seconds on a cold server;
  // show the modelled estimate meanwhile so the page is never blank.
  if (!orbit) {
    const model = modelOrbit()
    if (model) orbit = model
  }
  let next = null
  try {
    const res = await fetch('/api/orbit', { cache: 'no-cache' })
    if (res.ok) {
      const body = await res.json()
      if (body?.payload?.omm && body.flight === flight.flight) {
        try {
          payload = {
            name: body.payload.name || 'Starlink satellites',
            epoch: String(body.payload.omm.EPOCH),
            satrec: sat.json2satrec(body.payload.omm),
          }
        } catch {
          /* keep the previous one */
        }
      }
      if (body?.orbit?.omm && body.flight === flight.flight) {
        next = {
          source: body.orbit.source,
          label: body.orbit.label,
          epoch: String(body.orbit.omm.EPOCH),
          satrec: sat.json2satrec(body.orbit.omm),
        }
      }
    }
  } catch {
    next = null
  }
  // Keep real orbit data through a failed refresh rather than downgrade.
  if (!next && orbit && orbit.source !== 'model') return false
  if (!next) next = modelOrbit()
  if (next) orbit = next
  return (orbit?.source + orbit?.epoch) !== before
}

function modelOrbit() {
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return null
  try {
    return {
      source: 'model',
      label: 'using a model of the planned orbit from the launch time, until a published orbit is available',
      epoch: String(t0),
      satrec: sat.json2satrec(modelOmm(t0)),
    }
  } catch {
    return null
  }
}

/** The estimate's current phase. */
export function estimatePhase(ms = Date.now()) {
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return null
  const met = (ms - t0) / 1000
  const w = orbitWindow()
  if (met < w.from) return null
  if (met <= w.to) return 'orbit'
  if (met < w.landing) return plannedReentry() ? 'reentry' : null
  return flight.landingKind === 'catch' ? 'landed' : null
}

/** Where the current estimate comes from, for the page to say plainly. */
export function orbitSource(ms = Date.now()) {
  const phase = estimatePhase(ms)
  if (phase === 'reentry') {
    return {
      source: 'reentry',
      phase,
      label:
        "along the planned re-entry path into Starbase, from SpaceX's timeline and the official re-entry hazard area",
    }
  }
  if (phase === 'landed') {
    const w = orbitWindow()
    const h = Math.floor(w.landing / 3600)
    const m = String(Math.floor((w.landing % 3600) / 60)).padStart(2, '0')
    const sec = String(Math.floor(w.landing % 60)).padStart(2, '0')
    return {
      source: 'plan',
      phase,
      label: `at Starbase, caught at SpaceX's planned catch time (T+${h}:${m}:${sec}); not confirmed by live data`,
    }
  }
  return orbit ? { source: orbit.source, phase: 'orbit', label: orbit.label } : null
}

/** A tracker-style fix at `ms`, or null outside the on-orbit window. */
export function orbitFixAt(ms) {
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return null
  const met = (ms - t0) / 1000
  const w = orbitWindow()
  if (met < w.from) return null
  if (met > w.to) {
    if (met < w.landing) return reentryFixAt(ms, met, w)
    if (flight.landingKind !== 'catch') return null
    let pad
    try {
      pad = getMeta().launchPad
    } catch {
      return null
    }
    return {
      gps_time: ms / 1000 - GPS_TO_UNIX_OFFSET,
      mission_time: w.landing,
      latitude: pad.lat,
      longitude: pad.lon,
      altitude: 0,
      speed: 0,
      estimated: 'plan',
    }
  }
  if (!orbit) return null
  const date = new Date(ms)
  const pv = sat.propagate(orbit.satrec, date)
  if (!pv?.position || !pv?.velocity || typeof pv.position === 'boolean') return null
  const gmst = sat.gstime(date)
  const gd = sat.eciToGeodetic(pv.position, gmst)
  const ecf = sat.eciToEcf(pv.position, gmst)
  const altitude = gd.height * 1000
  if (!(altitude > 80_000 && altitude < 2_000_000)) return null
  return {
    gps_time: ms / 1000 - GPS_TO_UNIX_OFFSET,
    mission_time: met,
    latitude: sat.degreesLat(gd.latitude),
    longitude: sat.degreesLong(gd.longitude),
    altitude,
    speed: groundRelativeSpeed(pv, gmst),
    r_ecef: [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000],
    estimated: orbit.source,
  }
}

/**
 * The path flown before `untilMs`, rebuilt for the time before this browser
 * saw any live fix: the launch pad at liftoff, then the published orbit from
 * engine cutoff on (within ~30 km of SpaceX's live fixes on Flight 15).
 * gps_time uses true GPS time like SpaceX's tracker (18 s ahead of UTC).
 */
export function reconstructedPath(untilMs, stepS = TRAIL_STEP_S) {
  const t0 = liftoffMs()
  if (!orbit || !Number.isFinite(t0) || !Number.isFinite(untilMs)) return []
  let pad
  try {
    pad = getMeta().launchPad
  } catch {
    return []
  }
  const w = orbitWindow()
  const gps = (ms) => ms / 1000 - GPS_TO_UNIX_OFFSET + 18
  const out = [{ gps_time: gps(t0), latitude: pad.lat, longitude: pad.lon, altitude: 0 }]
  const end = Math.min(untilMs, t0 + w.to * 1000)
  for (let ms = t0 + w.from * 1000; ms <= end; ms += stepS * 1000) {
    const date = new Date(ms)
    const pv = sat.propagate(orbit.satrec, date)
    if (!pv?.position || typeof pv.position === 'boolean') continue
    const gd = sat.eciToGeodetic(pv.position, sat.gstime(date))
    out.push({
      gps_time: gps(ms),
      latitude: sat.degreesLat(gd.latitude),
      longitude: sat.degreesLong(gd.longitude),
      altitude: gd.height * 1000,
    })
  }
  return out
}

/** Ground track flown so far (whole flight, up to the catch), oldest first. */
export function orbitTrail(nowMs) {
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return []
  const { from, landing } = orbitWindow()
  const endMs = Math.min(nowMs, t0 + landing * 1000)
  const start = Math.max(t0 + from * 1000, endMs - TRAIL_MAX_S * 1000)
  const out = []
  // Begin at the pad when the whole flight is shown.
  if (start === t0 + from * 1000) {
    try {
      const pad = getMeta().launchPad
      out.push({
        gps_time: t0 / 1000 - GPS_TO_UNIX_OFFSET,
        mission_time: 0,
        latitude: pad.lat,
        longitude: pad.lon,
        altitude: 0,
      })
    } catch {
      /* no pad yet */
    }
  }
  for (let ms = start; ms <= endMs; ms += TRAIL_STEP_S * 1000) {
    const fix = orbitFixAt(ms)
    if (fix) out.push(fix)
  }
  return out
}

/** Name of the deployed Starlink batch, when its orbit is known. */
export function starlinkName() {
  return payload?.name ?? null
}

/** The Starlink batch's position at `ms` (after deployment), or null. */
export function starlinkFixAt(ms) {
  if (!payload) return null
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return null
  const deploy = timelineSeconds(/payload deploy start/i, 35 * 60)
  if ((ms - t0) / 1000 < deploy) return null
  const date = new Date(ms)
  const pv = sat.propagate(payload.satrec, date)
  if (!pv?.position || typeof pv.position === 'boolean') return null
  const gmst = sat.gstime(date)
  const gd = sat.eciToGeodetic(pv.position, gmst)
  const ecf = sat.eciToEcf(pv.position, gmst)
  if (!(gd.height > 80 && gd.height < 2000)) return null
  return {
    name: payload.name,
    latitude: sat.degreesLat(gd.latitude),
    longitude: sat.degreesLong(gd.longitude),
    altitude: gd.height * 1000,
    speed: groundRelativeSpeed(pv, gmst),
    r_ecef: [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000],
  }
}
