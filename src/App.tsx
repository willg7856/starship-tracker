import { useEffect, useMemo, useState } from 'react'
import { TrackMap } from './components/TrackMap'
import { useShip40 } from './hooks/useShip40'
import { LANDING_FIX, SPLASHDOWN_MISSION_TIME } from './data/flight13Path'
import {
  SPACEX_VEHICLE_TRACKER,
  bearingDegrees,
  describeLocation,
  formatAltitudeKm,
  formatBearingCardinal,
  formatDriftDistance,
  formatDriftDuration,
  formatLatLon,
  formatMissionClock,
  formatSpeedKmh,
  haversineKm,
  isNearSurface,
} from './lib/spacex'

function formatUpdateAge(seconds: number): string {
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

function App() {
  const {
    ship,
    fetchedAt,
    error,
    loading,
    liveTrail,
    spaceNoticesExtension,
    lastMovedAt,
  } = useShip40()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const current = ship?.current

  // Tick mission clock every second between SpaceX polls.
  const liveMissionTime = useMemo(() => {
    if (!current) return null
    if (!fetchedAt) return current.mission_time
    const elapsedS = Math.max(0, (nowMs - fetchedAt.getTime()) / 1000)
    return current.mission_time + elapsedS
  }, [current, fetchedAt, nowMs])

  const place = useMemo(() => {
    if (!current) return null
    return describeLocation(current.latitude, current.longitude, current.altitude)
  }, [current])

  const drift = useMemo(() => {
    if (!current || liveMissionTime == null || !isNearSurface(current.altitude)) {
      return null
    }
    const km = haversineKm(
      LANDING_FIX.lat,
      LANDING_FIX.lon,
      current.latitude,
      current.longitude,
    )
    const bearing = bearingDegrees(
      LANDING_FIX.lat,
      LANDING_FIX.lon,
      current.latitude,
      current.longitude,
    )
    const driftingSeconds = Math.max(
      0,
      liveMissionTime - SPLASHDOWN_MISSION_TIME,
    )
    return {
      label: formatDriftDistance(km),
      direction:
        km < 0.05
          ? 'at splashdown'
          : formatBearingCardinal(bearing),
      duration: formatDriftDuration(driftingSeconds),
    }
  }, [current, liveMissionTime])

  // Shared across devices: age since Ship 40 last changed position
  // (from Space Notices / baked path — not browser local state).
  const liveLabel = error
    ? 'Offline'
    : loading || !lastMovedAt
      ? 'Linking…'
      : `Updated ${formatUpdateAge(
          Math.max(0, Math.floor((nowMs - lastMovedAt.getTime()) / 1000)),
        )}`

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="masthead-brand-block">
            <a className="brand" href="https://www.beyondstagezero.com/">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-name">Beyond Stage Zero</span>
            </a>
            <h1 className="masthead-title">
              Ship 40
              <span className="masthead-title-meta">· Flight 13</span>
            </h1>
            <p className="masthead-sub">
              Live location from SpaceX&apos;s public vehicle tracker.
            </p>
          </div>

          <div className="masthead-meta">
            <p
              className="status-line"
              data-state={error ? 'error' : loading ? 'loading' : 'live'}
            >
              {liveLabel}
            </p>
            <a
              className="masthead-link"
              href={SPACEX_VEHICLE_TRACKER}
              target="_blank"
              rel="noreferrer"
            >
              SpaceX tracker
            </a>
          </div>
        </div>
      </header>

      <section className="map-section" aria-label="Ship 40 map">
        {current && ship ? (
          <TrackMap
            ship={ship}
            liveTrail={liveTrail}
            spaceNoticesExtension={spaceNoticesExtension}
          />
        ) : (
          <div className="map-skeleton">
            {error ? <p>{error}</p> : <p>Acquiring telemetry…</p>}
          </div>
        )}
      </section>

      {current && (
        <section className="section telemetry" aria-label="Ship 40 telemetry">
          <div className="section-inner">
            <div className="telemetry-head">
              <div>
                <h2>Last known fix</h2>
                {place && <p className="telemetry-place">{place}</p>}
              </div>
            </div>

            <dl className={`telemetry-grid${drift ? ' with-drift' : ''}`}>
              <div>
                <dt>Coordinates</dt>
                <dd>{formatLatLon(current.latitude, current.longitude)}</dd>
              </div>
              <div>
                <dt>Mission clock</dt>
                <dd>
                  {formatMissionClock(liveMissionTime ?? current.mission_time)}
                </dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>
                  {formatSpeedKmh(current.speed)} <span>km/h</span>
                </dd>
              </div>
              <div>
                <dt>Altitude</dt>
                <dd>
                  {formatAltitudeKm(current.altitude)} <span>km</span>
                </dd>
              </div>
              {drift && (
                <div>
                  <dt>Ocean drift</dt>
                  <dd>
                    {drift.label} <span>{drift.direction}</span>
                  </dd>
                </div>
              )}
              {drift && (
                <div>
                  <dt>Time drifting</dt>
                  <dd>
                    {drift.duration} <span>since splashdown</span>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </section>
      )}

      <footer className="footer">
        <div className="footer-inner">
          <a className="brand" href="https://www.beyondstagezero.com/">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Beyond Stage Zero</span>
          </a>
          <p>Unofficial tracker · SpaceX public telemetry</p>
        </div>
      </footer>
    </div>
  )
}

export default App
