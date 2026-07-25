import { useEffect, useMemo, useState } from 'react'
import { TrackMap } from './components/TrackMap'
import { useRecoveryVessel } from './hooks/useRecoveryVessel'
import { useShip40 } from './hooks/useShip40'
import { LANDING_FIX } from './data/flight13Path'
import {
  SPACEX_MISSION_PAGE,
  SPACEX_VEHICLE_TRACKER,
  bearingDegrees,
  describeLocation,
  formatAltitudeKm,
  formatBearingCardinal,
  formatDriftDistance,
  formatLatLon,
  formatMissionClock,
  formatSpeedKmh,
  gpsTimeToDate,
  haversineKm,
  isNearSurface,
} from './lib/spacex'

function formatUpdateAge(seconds: number): string {
  if (seconds < 60) return `${seconds}S AGO`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}M AGO`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}H AGO`
  const days = Math.floor(hrs / 24)
  return `${days}D AGO`
}

function App() {
  const { ship, mission, fetchedAt, error, loading, liveTrail } = useShip40()
  const { vessel } = useRecoveryVessel()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const current = ship?.current
  const place = useMemo(() => {
    if (!current) return null
    return describeLocation(current.latitude, current.longitude, current.altitude)
  }, [current])

  const drift = useMemo(() => {
    if (!current || !isNearSurface(current.altitude)) return null
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
    return {
      km,
      label: formatDriftDistance(km),
      direction:
        km < 0.05
          ? 'still on splashdown fix'
          : `moved ${formatBearingCardinal(bearing)}`,
      baseline: formatLatLon(LANDING_FIX.lat, LANDING_FIX.lon),
    }
  }, [current])

  const stamp = current
    ? gpsTimeToDate(current.gps_time).toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }) + ' UTC'
    : null

  const lastUpdateAt = current
    ? gpsTimeToDate(current.gps_time)
    : fetchedAt

  const liveLabel = error
    ? 'OFFLINE'
    : loading || !lastUpdateAt
      ? 'LINKING'
      : formatUpdateAge(
          Math.max(0, Math.floor((nowMs - lastUpdateAt.getTime()) / 1000)),
        )

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
          <h1 className="hero-h1">
            Ship 40
            <span className="hero-h1-divider" />
            <span className="hero-h1-sub">Live tracker</span>
          </h1>
          <p className="hero-sub">
            Location from SpaceX&apos;s public Starship vehicle tracker — the
            same feed that powers spacex.com — with the Flight 13 ground track
            archived by Space Notices.
          </p>
          <div className="hero-actions">
            <a
              className="btn btn-primary"
              href={SPACEX_MISSION_PAGE}
              target="_blank"
              rel="noreferrer"
            >
              Flight 13 on SpaceX
            </a>
            <a
              className="btn btn-outline"
              href={SPACEX_VEHICLE_TRACKER}
              target="_blank"
              rel="noreferrer"
            >
              Official vehicle tracker
            </a>
          </div>
        </div>
      </section>

      <section className="map-section" aria-label="Ship 40 map">
        <div className="map-frame">
          {current && ship ? (
            <TrackMap ship={ship} liveTrail={liveTrail} vessel={vessel} />
          ) : (
            <div className="map-skeleton">
              {error ? <p>{error}</p> : <p>Acquiring SpaceX telemetry…</p>}
            </div>
          )}
        </div>
      </section>

      {current && (
        <section className="section telemetry" aria-label="Ship 40 telemetry">
          <div className="section-inner">
            <div className="telemetry-head">
              <div>
                <p className="section-eyebrow">Telemetry</p>
                <h2>Last known fix</h2>
              </div>
              <p className="telemetry-place">{place}</p>
            </div>

            <dl className={`telemetry-grid${drift ? ' with-drift' : ''}`}>
              <div>
                <dt>Coordinates</dt>
                <dd>{formatLatLon(current.latitude, current.longitude)}</dd>
              </div>
              <div>
                <dt>Mission clock</dt>
                <dd>{formatMissionClock(current.mission_time)}</dd>
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
            </dl>

            {drift && (
              <p className="drift-note">
                Drift distance is live SpaceX position minus the splashdown fix
                archived by{' '}
                <a
                  href="https://space-notices.com/entry/launch-starship-flight-13"
                  target="_blank"
                  rel="noreferrer"
                >
                  Space Notices
                </a>{' '}
                ({drift.baseline}). The map uses the Space Notices archive
                through the latest published sample, then grows its own path
                from each new SpaceX fix (~every 10s) in this browser.
              </p>
            )}

            <p className="source-line">
              Source: SpaceX starship_tracker_public.json via /api/tracker
              {stamp ? ` · GPS ${stamp}` : ''}
              {fetchedAt
                ? ` · polled ${fetchedAt.toLocaleTimeString('en-US', {
                    timeZone: 'UTC',
                  })} UTC`
                : ''}
            </p>
          </div>
        </section>
      )}

      {mission?.paragraphs?.[0]?.content && (
        <section className="section mission-note">
          <div className="section-inner">
            <p className="section-eyebrow">Mission</p>
            <h2>{mission.title}</h2>
            <p>{mission.paragraphs[0].content}</p>
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
          <p>
            Unofficial Ship 40 tracker. Telemetry from SpaceX&apos;s public
            vehicle tracker · refreshes about every 10 seconds.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
