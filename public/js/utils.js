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
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return days > 0 ? `T+ ${days}D ${clock}` : `T+ ${clock}`
}

export function formatSpeedKmh(speedMs) {
  if (!Number.isFinite(speedMs) || speedMs < 0) return '0'
  const kmh = Math.round(speedMs * 3.6)
  if (kmh < 0 || kmh > 40000) return '0'
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

export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`
}

export function describeLocation(lat, lon, altitudeM) {
  const nearSurface = altitudeM > -500 && altitudeM < 2000
  if (lat < 0 && lon > 90 && lon < 130 && nearSurface) {
    return 'Indian Ocean splashdown zone'
  }
  if (Math.abs(lat - 25.997) < 0.5 && Math.abs(lon + 97.158) < 0.5) {
    return 'Starbase, Texas'
  }
  if (altitudeM > 80000) return 'In flight / exoatmospheric'
  return 'En route'
}

export function formatDriftDistance(km) {
  if (!Number.isFinite(km)) return '—'
  if (km < 0.05) return '0 m'
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(2)} km`
  return `${km.toFixed(1)} km`
}

/** Elapsed ocean-drift duration since splashdown, in hours. */
export function formatDriftDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  return `${(seconds / 3600).toFixed(1)}H`
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
