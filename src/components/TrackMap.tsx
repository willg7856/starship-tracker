import { useEffect, useMemo, useRef } from 'react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import type { LatLngExpression } from 'leaflet'
import {
  FLIGHT_PATH_SOURCE,
  LAUNCH_PAD,
  buildFlightPath,
} from '../data/flight13Path'
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

  const { simulated, toSplashdown } = useMemo(
    () =>
      buildFlightPath({
        lat: current.latitude,
        lon: current.longitude,
        label: 'Ship 40 splashdown',
      }),
    [current.latitude, current.longitude],
  )

  const fitPath = useMemo(
    () => [...simulated, ...toSplashdown],
    [simulated, toSplashdown],
  )

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
        <FitFlightPath path={fitPath} current={center} />

        {simulated.length >= 2 && (
          <Polyline
            positions={simulated}
            pathOptions={{
              color: '#C9853A',
              weight: 3,
              opacity: 0.95,
            }}
          />
        )}

        {toSplashdown.length >= 2 && (
          <Polyline
            positions={toSplashdown}
            pathOptions={{
              color: '#F0C27A',
              weight: 2.5,
              opacity: 0.85,
              dashArray: '6 8',
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
            Live SpaceX splashdown fix
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
        Solid path: {FLIGHT_PATH_SOURCE.name} Flight 13 Ship simulation (
        <a href={FLIGHT_PATH_SOURCE.url} target="_blank" rel="noreferrer">
          open
        </a>
        ). Dashed leg: to live SpaceX splashdown fix. Scroll or +/− to zoom.
      </p>
    </div>
  )
}
