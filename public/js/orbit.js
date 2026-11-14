/**
 * Estimated ship position from a published orbit, for flights where SpaceX's
 * live vehicle tracker is off. /api/orbit supplies the best orbit it can find
 * (the ship's own catalogue entry, or SpaceX's orbit for the Starlink batch
 * the ship deployed); without one, a planned orbit is modelled from the launch
 * site, SpaceX's T-0 and its flight timeline. SGP4 turns either into a fix
 * shaped like SpaceX's tracker data, so the map and readouts work
 * unchanged. Fixes are only produced between engine cutoff and the deorbit
 * burn, when the ship really is on that orbit.
 */
import * as sat from './vendor/satellite.es.js'
import { flight } from './flight.js'
import { getMeta } from './path.js'
import { GPS_TO_UNIX_OFFSET } from './utils.js'

const EARTH_MU = 398600.4418 // km^3/s^2
const EARTH_R = 6378.137 // km
// Flight 14 / 15 orbits: ~270 km at 30.5 degrees (Celestrak STARSHIP-14).
const MODEL_ALT_KM = 270
const MODEL_INC_DEG = 30.5
const TRAIL_STEP_S = 30
const TRAIL_MAX_S = 3 * 3600

let orbit = null // { source, label, satrec }

function timelineSeconds(pattern, fallback) {
  const e = (flight.timeline || []).find((x) => pattern.test(x.label))
  return Number.isFinite(e?.t) ? e.t : fallback
}

/** Mission-time window when the ship is on orbit: engine cutoff to deorbit. */
export function orbitWindow() {
  const landing = Number.isFinite(flight.landingMissionTime) ? flight.landingMissionTime : 22 * 3600
  return {
    from: timelineSeconds(/starship engine cutoff|\bSECO\b/i, 9 * 60),
    to: timelineSeconds(/deorbit burn start/i, landing - 3600),
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
  let next = null
  try {
    const res = await fetch('/api/orbit', { cache: 'no-cache' })
    if (res.ok) {
      const body = await res.json()
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
  if (!next) {
    const t0 = liftoffMs()
    if (Number.isFinite(t0)) {
      next = {
        source: 'model',
        label: 'modelled from the launch time and the planned orbit, until a published orbit is available',
        epoch: String(t0),
        satrec: sat.json2satrec(modelOmm(t0)),
      }
    }
  }
  if (next) orbit = next
  return (orbit?.source + orbit?.epoch) !== before
}

export function orbitSource() {
  return orbit ? { source: orbit.source, label: orbit.label } : null
}

/** A tracker-style fix at `ms`, or null outside the on-orbit window. */
export function orbitFixAt(ms) {
  if (!orbit) return null
  const t0 = liftoffMs()
  if (!Number.isFinite(t0)) return null
  const met = (ms - t0) / 1000
  const { from, to } = orbitWindow()
  if (met < from || met > to) return null
  const date = new Date(ms)
  const pv = sat.propagate(orbit.satrec, date)
  if (!pv?.position || !pv?.velocity || typeof pv.position === 'boolean') return null
  const gmst = sat.gstime(date)
  const gd = sat.eciToGeodetic(pv.position, gmst)
  const ecf = sat.eciToEcf(pv.position, gmst)
  const v = pv.velocity
  const altitude = gd.height * 1000
  if (!(altitude > 80_000 && altitude < 2_000_000)) return null
  return {
    gps_time: ms / 1000 - GPS_TO_UNIX_OFFSET,
    mission_time: met,
    latitude: sat.degreesLat(gd.latitude),
    longitude: sat.degreesLong(gd.longitude),
    altitude,
    speed: Math.hypot(v.x, v.y, v.z) * 1000,
    r_ecef: [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000],
    estimated: orbit.source,
  }
}

/** Ground track flown so far on orbit (last few hours), oldest first. */
export function orbitTrail(nowMs) {
  const t0 = liftoffMs()
  if (!orbit || !Number.isFinite(t0)) return []
  const { from } = orbitWindow()
  const start = Math.max(t0 + from * 1000, nowMs - TRAIL_MAX_S * 1000)
  const out = []
  for (let ms = start; ms <= nowMs; ms += TRAIL_STEP_S * 1000) {
    const fix = orbitFixAt(ms)
    if (fix) out.push(fix)
  }
  return out
}
