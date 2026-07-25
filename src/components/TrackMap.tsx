import { useEffect, useMemo } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
} from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { ShipTrack } from '../lib/spacex'
import 'leaflet/dist/leaflet.css'

type Props = {
  ship: ShipTrack
}

function Recenter({ center }: { center: LatLngExpression }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true })
  }, [center, map])
  return null
}

export function TrackMap({ ship }: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]

  const trail = useMemo(() => {
    const points = [...ship.trajectory]
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .sort((a, b) => a.time - b.time)
      .map((p) => [p.latitude, p.longitude] as LatLngExpression)

    // Keep only near-surface trail so deep-negative alt projections don't dominate.
    const surfaceish = [...ship.trajectory]
      .filter((p) => p.altitude > -2000 && p.altitude < 200_000)
      .sort((a, b) => a.time - b.time)
      .map((p) => [p.latitude, p.longitude] as LatLngExpression)

    return surfaceish.length >= 2 ? surfaceish : points
  }, [ship.trajectory])

  return (
    <MapContainer
      center={center}
      zoom={5}
      className="track-map"
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />
      <Recenter center={center} />
      {trail.length >= 2 && (
        <Polyline
          positions={trail}
          pathOptions={{
            color: '#C9853A',
            weight: 2.5,
            opacity: 0.85,
            dashArray: '2 10',
          }}
        />
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
        className="ship-marker"
      />
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
  )
}
