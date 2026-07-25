import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * Fit the map once per view-mode change only.
 * Do NOT re-fit when live telemetry updates — that fights manual zoom.
 */
function FitBoundsOnModeChange({
  mode,
  fullPath,
  driftPoints,
  live,
}: {
  mode: ViewMode
  fullPath: Array<[number, number]>
  driftPoints: Array<[number, number]>
  live: LatLngExpression
}) {
  const map = useMap()
  const fittedMode = useRef<ViewMode | null>(null)
  const fullPathRef = useRef(fullPath)
  const driftPointsRef = useRef(driftPoints)
  const liveRef = useRef(live)
  fullPathRef.current = fullPath
  driftPointsRef.current = driftPoints
  liveRef.current = live

  useEffect(() => {
    if (fittedMode.current === mode) return
    fittedMode.current = mode

    const liveNow = liveRef.current

    if (mode === 'drift') {
      const pts = driftPointsRef.current
      const bounds = L.latLngBounds(
        pts.length > 0 ? pts : [[LANDING_FIX.lat, LANDING_FIX.lon]],
      )
      bounds.extend(liveNow)
      map.fitBounds(bounds.pad(0.35), { animate: false })
      return
    }

    const path = fullPathRef.current
    if (path.length >= 2) {
      const bounds = L.latLngBounds(path)
      bounds.extend(liveNow)
      map.fitBounds(bounds.pad(0.08), { animate: false })
    }
  }, [mode, map])

  return null
}

export function TrackMap({ ship }: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]
  const landed = isNearSurface(current.altitude)
  const [mode, setMode] = useState<ViewMode>(landed ? 'drift' : 'flight')

  const { ascent, reentry, oceanDrift, full } = useMemo(() => buildFlightPath(), [])
  const notices = useMemo(() => getNoticePolygons(), [])

  // Archived ocean-drift track + live tip for close-up framing at mode switch.
  const driftFrame = useMemo(() => {
    const pts: Array<[number, number]> = oceanDrift.length
      ? [...oceanDrift]
      : [[LANDING_FIX.lat, LANDING_FIX.lon]]
    pts.push([current.latitude, current.longitude])
    return pts
  }, [oceanDrift, current.latitude, current.longitude])

  const liveDriftStub = useMemo(() => {
    if (!landed || oceanDrift.length === 0) return null
    const last = oceanDrift[oceanDrift.length - 1]
    const live: [number, number] = [current.latitude, current.longitude]
    if (Math.hypot(last[0] - live[0], last[1] - live[1]) < 1e-7) return null
    return [last, live] as Array<[number, number]>
  }, [landed, oceanDrift, current.latitude, current.longitude])

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
        maxZoom={18}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={18}
        />
        <FitBoundsOnModeChange
          mode={view}
          fullPath={full}
          driftPoints={driftFrame}
          live={center}
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

        {showFlightLayers && ascent.length >= 2 && (
          <Polyline
            positions={ascent}
            pathOptions={{
              color: '#C9853A',
              weight: 3,
              opacity: 0.95,
            }}
          />
        )}

        {showFlightLayers && reentry.length >= 2 && (
          <Polyline
            positions={reentry}
            pathOptions={{
              color: '#E0A85A',
              weight: 3,
              opacity: 0.95,
            }}
          />
        )}

        {/* Archived post-splashdown track (same samples Space Notices plots) */}
        {oceanDrift.length >= 2 && (
          <Polyline
            positions={oceanDrift}
            pathOptions={{
              color: '#F0C27A',
              weight: view === 'drift' ? 4 : 2.5,
              opacity: 0.95,
            }}
          />
        )}

        {/* Short stub from end of archive to current live fix */}
        {liveDriftStub && (
          <Polyline
            positions={liveDriftStub}
            pathOptions={{
              color: '#F0C27A',
              weight: view === 'drift' ? 4 : 2,
              opacity: 0.85,
              dashArray: '4 6',
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
            Close-up of archived post-splashdown track from{' '}
            <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
              Space Notices
            </a>
            . Open ring = splashdown; filled = live. Dashed tip = since archive
            ended. Zoom freely — view won’t reset on telemetry refresh.
          </>
        ) : (
          <>
            Full tracker series from{' '}
            <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
              Space Notices
            </a>{' '}
            (same Trajectory points): copper ascent, lighter reentry, gold ocean
            drift. Shaded = AHA / nav-warning areas.
          </>
        )}{' '}
        Scroll or +/− to zoom.
      </p>
    </div>
  )
}
