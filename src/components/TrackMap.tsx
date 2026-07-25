import { useEffect, useMemo, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import type { LatLngExpression } from 'leaflet'
import {
  FLIGHT_PATH_SOURCE,
  LANDING_FIX,
  LAUNCH_PAD,
  buildFlightPath,
  getAscentHazard,
  getBoosterTrack,
  getFaaReentryCorridor,
  getIndianOceanHazard,
} from '../data/flight13Path'
import { formatLatLon, isNearSurface } from '../lib/spacex'
import type { ShipTrack } from '../lib/spacex'
import 'leaflet/dist/leaflet.css'

type Props = {
  ship: ShipTrack
}

type ViewMode = 'drift' | 'flight'

const launchIcon = L.divIcon({
  className: 'path-marker launch-marker',
  html: '<span></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const landingIcon = L.divIcon({
  className: 'path-marker landing-marker',
  html: '<span></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

function FitBounds({
  mode,
  fullPath,
  driftBounds,
  current,
}: {
  mode: ViewMode
  fullPath: Array<[number, number]>
  driftBounds: Array<[number, number]>
  current: LatLngExpression
}) {
  const map = useMap()

  useEffect(() => {
    if (mode === 'drift' && driftBounds.length >= 1) {
      const bounds = L.latLngBounds(driftBounds.map(([lat, lon]) => [lat, lon]))
      bounds.extend(current)
      // Keep a readable close-up even when drift is still small.
      map.fitBounds(bounds.pad(0.85), { animate: false, maxZoom: 11 })
      return
    }
    if (fullPath.length >= 2) {
      const bounds = L.latLngBounds(fullPath.map(([lat, lon]) => [lat, lon]))
      bounds.extend(current)
      map.fitBounds(bounds.pad(0.08), { animate: false })
    }
  }, [mode, fullPath, driftBounds, current, map])

  return null
}

export function TrackMap({ ship }: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]
  const landed = isNearSurface(current.altitude)
  const [mode, setMode] = useState<ViewMode>(landed ? 'drift' : 'flight')

  const { coast, landing, full } = useMemo(() => buildFlightPath(), [])
  const booster = useMemo(() => getBoosterTrack(), [])
  const ioHazard = useMemo(() => getIndianOceanHazard(), [])
  const reentry = useMemo(() => getFaaReentryCorridor(), [])
  const ascent = useMemo(() => getAscentHazard(), [])

  const driftBounds = useMemo(() => {
    const pts: Array<[number, number]> = [
      [LANDING_FIX.lat, LANDING_FIX.lon],
      [current.latitude, current.longitude],
    ]
    return pts
  }, [current.latitude, current.longitude])

  const driftLine = useMemo(() => {
    if (!landed) return null
    const a: [number, number] = [LANDING_FIX.lat, LANDING_FIX.lon]
    const b: [number, number] = [current.latitude, current.longitude]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) return null
    return [a, b] as Array<[number, number]>
  }, [landed, current.latitude, current.longitude])

  // If the ship is still flying, force full-flight view.
  const view = landed ? mode : 'flight'
  const showFlightLayers = view === 'flight'

  return (
    <div className="map-shell">
      {landed && (
        <div className="map-view-toggle" role="group" aria-label="Map view">
          <button
            type="button"
            className={view === 'drift' ? 'active' : undefined}
            onClick={() => setMode('drift')}
          >
            Drift close-up
          </button>
          <button
            type="button"
            className={view === 'flight' ? 'active' : undefined}
            onClick={() => setMode('flight')}
          >
            Full flight
          </button>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={landed ? 10 : 3}
        className="track-map"
        scrollWheelZoom
        zoomControl
        attributionControl={false}
        worldCopyJump
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        <FitBounds
          mode={view}
          fullPath={full}
          driftBounds={driftBounds}
          current={center}
        />

        {showFlightLayers && ascent.length >= 3 && (
          <Polygon
            positions={ascent}
            pathOptions={{
              color: '#6E8B9A',
              weight: 1,
              opacity: 0.25,
              fillColor: '#6E8B9A',
              fillOpacity: 0.04,
            }}
          />
        )}

        {showFlightLayers && reentry.length >= 3 && (
          <Polygon
            positions={reentry}
            pathOptions={{
              color: '#C9853A',
              weight: 1,
              opacity: 0.4,
              fillColor: '#C9853A',
              fillOpacity: 0.07,
            }}
          >
            <Popup>FAA Stage 2 reentry hazard corridor (approx.)</Popup>
          </Polygon>
        )}

        {showFlightLayers && ioHazard.length >= 3 && (
          <Polygon
            positions={ioHazard}
            pathOptions={{
              color: '#C9853A',
              weight: 1,
              opacity: 0.3,
              fillColor: '#C9853A',
              fillOpacity: 0.05,
            }}
          >
            <Popup>Indian Ocean splashdown hazard zone</Popup>
          </Polygon>
        )}

        {showFlightLayers && booster.length >= 2 && (
          <Polyline
            positions={booster}
            pathOptions={{
              color: '#6E8B9A',
              weight: 2,
              opacity: 0.55,
              dashArray: '2 6',
            }}
          />
        )}

        {showFlightLayers && coast.length >= 2 && (
          <Polyline
            positions={coast}
            pathOptions={{
              color: '#C9853A',
              weight: 3,
              opacity: 0.95,
            }}
          />
        )}

        {showFlightLayers && landing.length >= 2 && (
          <Polyline
            positions={landing}
            pathOptions={{
              color: '#C9853A',
              weight: 3,
              opacity: 0.9,
              dashArray: '7 9',
            }}
          />
        )}

        {driftLine && (
          <Polyline
            positions={driftLine}
            pathOptions={{
              color: '#F0C27A',
              weight: view === 'drift' ? 4 : 2,
              opacity: 1,
            }}
          />
        )}

        {showFlightLayers && (
          <Marker position={[LAUNCH_PAD.lat, LAUNCH_PAD.lon]} icon={launchIcon}>
            <Popup>
              <strong>Liftoff</strong>
              <br />
              {LAUNCH_PAD.label}
            </Popup>
          </Marker>
        )}

        {landed && (
          <Marker
            position={[LANDING_FIX.lat, LANDING_FIX.lon]}
            icon={landingIcon}
          >
            <Popup>
              <strong>First tracked fix</strong>
              <br />
              {formatLatLon(LANDING_FIX.lat, LANDING_FIX.lon)}
              <br />
              Baseline used for drift
            </Popup>
          </Marker>
        )}

        <CircleMarker
          center={center}
          radius={view === 'drift' ? 11 : 9}
          pathOptions={{
            color: '#F0C27A',
            fillColor: '#F0C27A',
            fillOpacity: 0.95,
            weight: 2,
          }}
        >
          <Popup>
            <strong>Ship 40 now</strong>
            <br />
            {formatLatLon(current.latitude, current.longitude)}
          </Popup>
        </CircleMarker>
        <CircleMarker
          center={center}
          radius={view === 'drift' ? 22 : 18}
          pathOptions={{
            color: '#F0C27A',
            fillOpacity: 0,
            weight: 1,
            opacity: 0.45,
          }}
        />
      </MapContainer>

      <p className="map-caption">
        {view === 'drift' ? (
          <>
            Close-up: open ring = first tracked splashdown fix; filled = live
            SpaceX position. Gold line = drift between them.
          </>
        ) : (
          <>
            Copper solid: Flight Club Ship coast. Dashed: FAA Stage 2 reentry
            corridor (
            <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
              FC sim
            </a>
            ). SpaceX does not publish a full archived ground track.
          </>
        )}{' '}
        Scroll or +/− to zoom.
      </p>
    </div>
  )
}
