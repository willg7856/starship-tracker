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
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? 'SECOND' : 'SECONDS'} AGO`
  }
  const mins = Math.floor(seconds / 60)
  if (mins < 60) {
    return `${mins} ${mins === 1 ? 'MINUTE' : 'MINUTES'} AGO`
  }
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) {
    return `${hrs} ${hrs === 1 ? 'HOUR' : 'HOURS'} AGO`
  }
  const days = Math.floor(hrs / 24)
  return `${days} ${days === 1 ? 'DAY' : 'DAYS'} AGO`
}

function App() {
  const {
    ship,
    fetchedAt,
    error,
    loading,
    liveTrail,
    spaceNoticesExtension,
    positionStillSince,
    positionMoveConfirmed,
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

  // Nav age = time since lat/lon last changed (not feed clock ticks).
  // First page load is not a move — only say "last updated" after a real change.
  const liveLabel = error
    ? 'OFFLINE'
    : loading || !positionStillSince
      ? 'LINKING'
      : positionMoveConfirmed
        ? `LAST UPDATED ${formatUpdateAge(
            Math.max(
              0,
              Math.floor((nowMs - positionStillSince.getTime()) / 1000),
            ),
          )}`
        : 'NO MOVE SINCE LOAD'

  return (
    <div className="app">
      <header className="nav">
        <div className="nav-inner">
          <a className="brand-logo" href="https://www.beyondstagezero.com/">
            <span className="brand-logo-mark" aria-hidden="true" />
            <span className="brand-logo-text">
              <span className="brand-logo-bracket">[</span>
              BSZ
              <span className="brand-logo-bracket">]</span>
              <span className="brand-logo-sep">/</span>
              SHIP 40
            </span>
          </a>
          <div
            className="live-badge"
            data-state={error ? 'error' : loading ? 'loading' : 'live'}
          >
            <span className="live-dot" />
            {liveLabel}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-grid-bg" aria-hidden="true" />
        <div className="hero-inner">
          <p className="hero-eyebrow">Flight 13 · Starship</p>
          <h1 className="hero-h1">Ship 40</h1>
          <p className="hero-sub">
            Live location from SpaceX&apos;s public vehicle tracker.
          </p>
          <div className="hero-actions">
            <a
              className="btn btn-outline"
              href={SPACEX_VEHICLE_TRACKER}
              target="_blank"
              rel="noreferrer"
            >
              SpaceX tracker
            </a>
          </div>
        </div>
      </section>

      <section className="map-section" aria-label="Ship 40 map">
        <div className="map-frame">
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
        </div>
      </section>

      {current && (
        <section className="section telemetry" aria-label="Ship 40 telemetry">
          <div className="section-inner">
            <div className="telemetry-head">
              <div>
                <p className="section-eyebrow">Position</p>
                <h2>Last known fix</h2>
              </div>
              {place && <p className="telemetry-place">{place}</p>}
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
          <a className="brand-logo" href="https://www.beyondstagezero.com/">
            <span className="brand-logo-mark" aria-hidden="true" />
            <span className="brand-logo-text">
              <span className="brand-logo-bracket">[</span>
              BEYOND STAGE ZERO
              <span className="brand-logo-bracket">]</span>
            </span>
          </a>
          <p>Unofficial tracker · SpaceX public telemetry</p>
        </div>
      </footer>
    </div>
  )
}

export default App
