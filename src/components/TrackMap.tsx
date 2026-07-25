import { useEffect, useMemo, useRef } from 'react'
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
import { isNearSurface } from '../lib/spacex'
import type { ShipTrack } from '../lib/spacex'
import 'leaflet/dist/leaflet.css'

type Props = {
  ship: ShipTrack
}

const launchIcon = L.divIcon({
  className: 'path-marker launch-marker',
  html: '<span></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const landingIcon = L.divIcon({
  className: 'path-marker landing-marker',
  html: '<span></span>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

function FitFlightPath({
  path,
  current,
}: {
  path: Array<[number, number]>
  current: LatLngExpression
}) {
  const map = useMap()
  const fitted = useRef(false)

  useEffect(() => {
    if (fitted.current || path.length < 2) return
    const bounds = L.latLngBounds(path.map(([lat, lon]) => [lat, lon]))
    bounds.extend(current)
    map.fitBounds(bounds.pad(0.08), { animate: false })
    fitted.current = true
  }, [path, current, map])

  return null
}

export function TrackMap({ ship }: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]
  const landed = isNearSurface(current.altitude)

  const { coast, landing, full } = useMemo(() => buildFlightPath(), [])
  const booster = useMemo(() => getBoosterTrack(), [])
  const ioHazard = useMemo(() => getIndianOceanHazard(), [])
  const reentry = useMemo(() => getFaaReentryCorridor(), [])
  const ascent = useMemo(() => getAscentHazard(), [])

  const driftLine = useMemo(() => {
    if (!landed) return null
    const a: [number, number] = [LANDING_FIX.lat, LANDING_FIX.lon]
    const b: [number, number] = [current.latitude, current.longitude]
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) return null
    return [a, b] as Array<[number, number]>
  }, [landed, current.latitude, current.longitude])

  return (
    <div className="map-shell">
      <MapContainer
        center={center}
        zoom={3}
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
        <FitFlightPath path={full} current={center} />

        {ascent.length >= 3 && (
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

        {reentry.length >= 3 && (
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

        {ioHazard.length >= 3 && (
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

        {booster.length >= 2 && (
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

        {coast.length >= 2 && (
          <Polyline
            positions={coast}
            pathOptions={{
              color: '#C9853A',
              weight: 3,
              opacity: 0.95,
            }}
          />
        )}

        {landing.length >= 2 && (
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
              weight: 2,
              opacity: 0.95,
            }}
          />
        )}

        <Marker position={[LAUNCH_PAD.lat, LAUNCH_PAD.lon]} icon={launchIcon}>
          <Popup>
            <strong>Liftoff</strong>
            <br />
            {LAUNCH_PAD.label}
          </Popup>
        </Marker>

        {landed && (
          <Marker
            position={[LANDING_FIX.lat, LANDING_FIX.lon]}
            icon={landingIcon}
          >
            <Popup>
              <strong>Splashdown</strong>
              <br />
              First public SpaceX fix
            </Popup>
          </Marker>
        )}

        <CircleMarker
          center={center}
          radius={9}
          pathOptions={{
            color: '#F0C27A',
            fillColor: '#F0C27A',
            fillOpacity: 0.95,
            weight: 2,
          }}
        >
          <Popup>
            <strong>Ship 40</strong>
            <br />
            {landed ? 'Live position (drifting)' : 'Live SpaceX fix'}
          </Popup>
        </CircleMarker>
        <CircleMarker
          center={center}
          radius={18}
          pathOptions={{
            color: '#F0C27A',
            fillOpacity: 0,
            weight: 1,
            opacity: 0.45,
          }}
        />
      </MapContainer>

      <p className="map-caption">
        Copper solid: Flight Club Ship coast. Dashed: FAA Stage 2 reentry
        corridor to splashdown (
        <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
          FC sim
        </a>
        ). Gold stub: drift since landing. SpaceX does not publish a full archived
        ground track. Scroll or +/− to zoom.
      </p>
    </div>
  )
}
