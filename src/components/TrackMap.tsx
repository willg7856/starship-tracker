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
  getNoticePolygons,
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
      map.fitBounds(bounds.pad(0.55), { animate: false, maxZoom: 10 })
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
  const notices = useMemo(() => getNoticePolygons(), [])

  const driftBounds = useMemo(
    () =>
      [
        [LANDING_FIX.lat, LANDING_FIX.lon],
        [current.latitude, current.longitude],
      ] as Array<[number, number]>,
    [current.latitude, current.longitude],
  )

  const driftLine = useMemo(() => {
    if (!landed) return null
    const a: [number, number] = [LANDING_FIX.lat, LANDING_FIX.lon]
    const b: [number, number] = [current.latitude, current.longitude]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) return null
    return [a, b] as Array<[number, number]>
  }, [landed, current.latitude, current.longitude])

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
        zoom={landed ? 9 : 3}
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

        {showFlightLayers &&
          notices.map((group) =>
            group.polygons.map((poly, idx) => (
              <Polygon
                key={`${group.id}-${idx}`}
                positions={poly}
                pathOptions={{
                  color:
                    group.type === 'ADP_LINK_FILE'
                      ? '#C9853A'
                      : group.type === 'NAVWARNING'
                        ? '#6E8B9A'
                        : '#B4553A',
                  weight: 1,
                  opacity: 0.45,
                  fillColor:
                    group.type === 'ADP_LINK_FILE'
                      ? '#C9853A'
                      : group.type === 'NAVWARNING'
                        ? '#6E8B9A'
                        : '#B4553A',
                  fillOpacity: 0.06,
                }}
              >
                <Popup>
                  {group.name}
                  <br />
                  {group.id}
                </Popup>
              </Polygon>
            )),
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
              color: '#F0C27A',
              weight: 3,
              opacity: 0.95,
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
              <strong>Splashdown</strong>
              <br />
              {formatLatLon(LANDING_FIX.lat, LANDING_FIX.lon)}
              <br />
              First near-surface SpaceX fix
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
            Close-up: open ring = splashdown fix from Space Notices archive;
            filled = live SpaceX position. Gold line = ocean drift (~
            {Math.round(
              L.latLng(LANDING_FIX.lat, LANDING_FIX.lon).distanceTo(
                L.latLng(current.latitude, current.longitude),
              ) / 1000,
            )}{' '}
            km).
          </>
        ) : (
          <>
            Track from{' '}
            <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
              Space Notices
            </a>{' '}
            archived SpaceX vehicle-tracker fixes (liftoff → splashdown). Shaded
            polygons: published AHA / nav-warning areas.
          </>
        )}{' '}
        Scroll or +/− to zoom.
      </p>
    </div>
  )
}
