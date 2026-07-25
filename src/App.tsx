import { useMemo } from 'react'
import { TrackMap } from './components/TrackMap'
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

function App() {
  const { ship, mission, fetchedAt, error, loading, refreshing } = useShip40()

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
          ? 'still on first tracked fix'
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

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="topbar">
        <p className="brand">SHIP 40</p>
        <div className="live-pill" data-state={error ? 'error' : loading ? 'loading' : 'live'}>
          <span className="live-dot" />
          <span>
            {error ? 'OFFLINE' : loading ? 'LINKING' : refreshing ? 'SYNCING' : 'LIVE'}
          </span>
        </div>
      </header>

      <main className="hero">
        <section className="hero-copy">
          <h1>Ship 40</h1>
          <p className="lede">
            Location pulled straight from SpaceX&apos;s public Starship vehicle
            tracker — the same feed that powers spacex.com.
          </p>

          <div className="cta-row">
            <a className="cta primary" href={SPACEX_MISSION_PAGE} target="_blank" rel="noreferrer">
              Flight 13 on SpaceX
            </a>
            <a className="cta ghost" href={SPACEX_VEHICLE_TRACKER} target="_blank" rel="noreferrer">
              Official vehicle tracker
            </a>
          </div>
        </section>

        <section className="map-plane" aria-label="Ship 40 map">
          {current && ship ? (
            <TrackMap ship={ship} />
          ) : (
            <div className="map-skeleton">
              {error ? (
                <p>{error}</p>
              ) : (
                <p>Acquiring SpaceX telemetry…</p>
              )}
            </div>
          )}
          <div className="map-scrim" aria-hidden="true" />
        </section>
      </main>

      {current && (
        <section className="telemetry" aria-label="Ship 40 telemetry">
          <div className="telemetry-head">
            <h2>Last known fix</h2>
            <p>{place}</p>
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
                  {drift.label}{' '}
                  <span>{drift.direction}</span>
                </dd>
              </div>
            )}
          </dl>

          {drift && (
            <p className="drift-note">
              Drift is live SpaceX position minus the first public splashdown fix
              we recorded ({drift.baseline}) — not an official SpaceX drift
              product, and not measured from the exact touchdown second.
            </p>
          )}

          <p className="source-line">
            Source: SpaceX starship_tracker_public.json via /api/tracker
            {stamp ? ` · GPS ${stamp}` : ''}
            {fetchedAt
              ? ` · polled ${fetchedAt.toLocaleTimeString('en-US', { timeZone: 'UTC' })} UTC`
              : ''}
          </p>
        </section>
      )}

      {mission?.paragraphs?.[0]?.content && (
        <section className="mission-note">
          <h2>{mission.title}</h2>
          <p>{mission.paragraphs[0].content}</p>
        </section>
      )}

      <footer className="footer">
        <p>
          Unofficial tracker. Telemetry is published by SpaceX for their website
          vehicle tracker and refreshes about every 10 seconds.
        </p>
      </footer>
    </div>
  )
}

export default App
