/** Shared geo + formatting helpers. */

export const GPS_TO_UNIX_OFFSET = 315964800
export const SPACEX_VEHICLE_TRACKER = 'https://www.spacex.com/vehicle-tracker'

export function gpsTimeToDate(gpsTime) {
  return new Date((gpsTime + GPS_TO_UNIX_OFFSET) * 1000)
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088
  const toRad = (d) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180) / Math.PI
}

export function formatBearingCardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

export function formatMissionClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'T+ 0:00:00'
  return formatSignedMissionClock(seconds, 'T+')
}

/** Format a T- / T+ clock. `secondsFromLiftoff` is negative before liftoff. */
export function formatSignedMissionClock(secondsFromLiftoff, forceSign) {
  if (!Number.isFinite(secondsFromLiftoff)) return 'T- —'
  const sign =
    forceSign || (secondsFromLiftoff < 0 ? 'T-' : 'T+')
  const total = Math.floor(Math.abs(secondsFromLiftoff))
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return days > 0 ? `${sign} ${days}D ${clock}` : `${sign} ${clock}`
}

/** Metres per second between two fixes. Prefers ECEF when both points have it. */
export function speedBetweenFixes(prev, next) {
  if (!prev || !next) return null
  const dt = next.gps_time - prev.gps_time
  if (!(dt >= 1) || dt > 180) return null
  const a = prev.r_ecef
  const b = next.r_ecef
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length >= 3 &&
    b.length >= 3 &&
    [a[0], a[1], a[2], b[0], b[1], b[2]].every(Number.isFinite)
  ) {
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt
  }
  if (
    ![prev.latitude, prev.longitude, next.latitude, next.longitude].every(
      Number.isFinite,
    )
  ) {
    return null
  }
  const groundM =
    haversineKm(prev.latitude, prev.longitude, next.latitude, next.longitude) *
    1000
  const dAlt =
    Number.isFinite(next.altitude) && Number.isFinite(prev.altitude)
      ? next.altitude - prev.altitude
      : 0
  return Math.hypot(groundM, dAlt) / dt
}

export function formatSpeedKmh(speedMs) {
  if (!Number.isFinite(speedMs)) return '—'
  if (speedMs < 0) return '0'
  const kmh = Math.round(speedMs * 3.6)
  if (kmh < 0 || kmh > 45000) return '—'
  return kmh.toLocaleString('en-US')
}

export function formatAltitudeKm(altitudeM) {
  if (!Number.isFinite(altitudeM)) return '—'
  const km = Math.round(altitudeM / 1000)
  if (km < 0 || km > 2000) {
    if (altitudeM > -500 && altitudeM < 500) return '0'
    return '—'
  }
  return String(km)
}

/** Signed vertical speed in metres per second. Climb is positive. */
export function verticalRateMs(prev, next) {
  if (!prev || !next) return null
  const dt = next.gps_time - prev.gps_time
  if (!(dt >= 1) || dt > 180) return null
  if (!Number.isFinite(prev.altitude) || !Number.isFinite(next.altitude)) return null
  return (next.altitude - prev.altitude) / dt
}

export function formatVerticalRate(ms) {
  if (!Number.isFinite(ms)) return '—'
  const rounded = Math.round(ms)
  if (Math.abs(rounded) > 4000) return '—'
  return rounded.toLocaleString('en-US')
}

const MU_EARTH = 3.986004418e14
const EARTH_ROTATION = 7.292115e-5
const WGS84_A = 6378137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)
const WGS84_B = WGS84_A * (1 - WGS84_F)

function vecMag(v) {
  return Math.hypot(v[0], v[1], v[2])
}

function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function geodeticAltitude(x, y, z) {
  const ep2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B)
  const p = Math.hypot(x, y)
  const th = Math.atan2(WGS84_A * z, WGS84_B * p)
  const lat = Math.atan2(
    z + ep2 * WGS84_B * Math.sin(th) ** 3,
    p - WGS84_E2 * WGS84_A * Math.cos(th) ** 3,
  )
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
  return p / Math.cos(lat) - n
}

function positionEcef(point) {
  const raw = point?.r_ecef
  if (
    Array.isArray(raw) &&
    raw.length >= 3 &&
    [raw[0], raw[1], raw[2]].every(Number.isFinite)
  ) {
    return [raw[0], raw[1], raw[2]]
  }
  if (![point?.latitude, point?.longitude, point?.altitude].every(Number.isFinite)) {
    return null
  }
  const lat = (point.latitude * Math.PI) / 180
  const lon = (point.longitude * Math.PI) / 180
  const s = Math.sin(lat)
  const c = Math.cos(lat)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s)
  const alt = point.altitude
  return [
    (n + alt) * c * Math.cos(lon),
    (n + alt) * c * Math.sin(lon),
    (n * (1 - WGS84_E2) + alt) * s,
  ]
}

/**
 * Apogee and perigee altitudes for the orbit implied by two fixes.
 * Altitudes are metres above the ellipsoid. Apogee is Infinity on an escape path.
 */
export function orbitAltitudes(prev, next) {
  if (!prev || !next) return null
  const dt = next.gps_time - prev.gps_time
  if (!(dt >= 1) || dt > 180) return null
  const r1 = positionEcef(prev)
  const r2 = positionEcef(next)
  if (!r1 || !r2) return null
  const rMag1 = vecMag(r1)
  const rMag = vecMag(r2)
  if (!(rMag > 6.3e6 && rMag < 1e7) || !(rMag1 > 6.3e6)) return null
  // The chord between two fixes points slightly off the local horizontal.
  // Keep the tangential part, and take radial speed from the change in radius.
  const chord = [(r2[0] - r1[0]) / dt, (r2[1] - r1[1]) / dt, (r2[2] - r1[2]) / dt]
  const rHat = [r2[0] / rMag, r2[1] / rMag, r2[2] / rMag]
  const radialArtifact =
    chord[0] * rHat[0] + chord[1] * rHat[1] + chord[2] * rHat[2]
  const vEcef = [
    chord[0] - rHat[0] * radialArtifact + rHat[0] * ((rMag - rMag1) / dt),
    chord[1] - rHat[1] * radialArtifact + rHat[1] * ((rMag - rMag1) / dt),
    chord[2] - rHat[2] * radialArtifact + rHat[2] * ((rMag - rMag1) / dt),
  ]
  const v = [
    vEcef[0] - EARTH_ROTATION * r2[1],
    vEcef[1] + EARTH_ROTATION * r2[0],
    vEcef[2],
  ]
  const vMag = vecMag(v)
  if (!(vMag > 100 && vMag < 12000)) return null
  const h = vecCross(r2, v)
  const hMag = vecMag(h)
  if (!(hMag > 0)) return null
  const vxh = vecCross(v, h)
  const eVec = [
    vxh[0] / MU_EARTH - r2[0] / rMag,
    vxh[1] / MU_EARTH - r2[1] / rMag,
    vxh[2] / MU_EARTH - r2[2] / rMag,
  ]
  const e = vecMag(eVec)
  const energy = (vMag * vMag) / 2 - MU_EARTH / rMag
  if (e < 0.002 && Number.isFinite(next.altitude)) {
    return { perigeeM: next.altitude, apogeeM: next.altitude }
  }
  const p = (hMag * hMag) / MU_EARTH
  let rp
  let ra
  if (e < 1 && energy < 0) {
    const a = -MU_EARTH / (2 * energy)
    rp = a * (1 - e)
    ra = a * (1 + e)
  } else if (e >= 1) {
    rp = p / (1 + e)
    ra = Infinity
  } else {
    return null
  }
  if (!(rp > 0)) return null
  const peri = eVec.map((c) => (c / e) * rp)
  const apo = Number.isFinite(ra) ? eVec.map((c) => (-c / e) * ra) : null
  const perigeeM = geodeticAltitude(peri[0], peri[1], peri[2])
  const apogeeM = apo ? geodeticAltitude(apo[0], apo[1], apo[2]) : Infinity
  // Drag in the atmosphere, or one bad fix, makes the osculating perigee plunge
  // through the Earth. That number is not a useful readout.
  if (!Number.isFinite(perigeeM) || perigeeM < -80_000) return null
  if (apogeeM !== Infinity && (!Number.isFinite(apogeeM) || apogeeM < perigeeM || apogeeM > 2_000_000)) {
    return null
  }
  return { perigeeM, apogeeM }
}

export function formatOrbitAltitude(meters) {
  if (meters === Infinity) return 'escape'
  if (!Number.isFinite(meters)) return '—'
  const km = Math.round(meters / 1000)
  if (km > 2000 || km < -2000) return '—'
  return `${km.toLocaleString('en-US')} km`
}

/** Ground range from the launch pad, in kilometres. */
export function formatDownrange(km) {
  if (!Number.isFinite(km) || km < 0) return '—'
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 100) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString('en-US')} km`
}

export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`
}

export function describeLocation(lat, lon, altitudeM) {
  const nearSurface = altitudeM > -500 && altitudeM < 2000
  if (lat < -10 && lon < -80 && lon > -160 && nearSurface) {
    return 'Pacific Ocean splashdown zone'
  }
  if (lat < 0 && lon > 70 && lon < 130 && nearSurface) {
    return 'Indian Ocean contingency zone'
  }
  if (Math.abs(lat - 25.997) < 0.5 && Math.abs(lon + 97.158) < 0.5) {
    return 'Starbase, Texas'
  }
  if (altitudeM > 80000) return 'In flight / exoatmospheric'
  return 'En route'
}

export function formatUpdateAge(seconds) {
  if (seconds < 60) return `${seconds}s ago`
  const totalMins = Math.floor(seconds / 60)
  if (totalMins < 60) return `${totalMins}m ago`
  const hrs = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hrs < 48) {
    return mins === 0 ? `${hrs}h ago` : `${hrs}h ${mins}m ago`
  }
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  return remHrs === 0 ? `${days}d ago` : `${days}d ${remHrs}h ago`
}

export function isNearSurface(altitudeM) {
  return Number.isFinite(altitudeM) && altitudeM > -500 && altitudeM < 2000
}
