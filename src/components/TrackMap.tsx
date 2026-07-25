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
  LANDING_FIX,
  LAUNCH_PAD,
  buildFlightPath,
  getNoticePolygons,
} from '../data/flight13Path'
import type { LiveTrailPoint } from '../lib/liveTrail'
import { formatLatLon, isNearSurface } from '../lib/spacex'
import type { ShipTrack } from '../lib/spacex'
import type { RecoveryVessel } from '../lib/vessel'
import 'leaflet/dist/leaflet.css'

type Props = {
  ship: ShipTrack
  liveTrail?: LiveTrailPoint[]
  vessel?: RecoveryVessel | null
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

const boatIcon = L.divIcon({
  className: 'path-marker boat-marker',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
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
  vessel,
}: {
  mode: ViewMode
  fullPath: Array<[number, number]>
  driftPoints: Array<[number, number]>
  live: LatLngExpression
  vessel: LatLngExpression | null
}) {
  const map = useMap()
  const fittedMode = useRef<ViewMode | null>(null)
  const sawVessel = useRef(false)
  const fullPathRef = useRef(fullPath)
  const driftPointsRef = useRef(driftPoints)
  const liveRef = useRef(live)
  const vesselRef = useRef(vessel)
  fullPathRef.current = fullPath
  driftPointsRef.current = driftPoints
  liveRef.current = live
  vesselRef.current = vessel

  // When AIS boat position first arrives, re-fit full-flight view once so it is on-screen.
  useEffect(() => {
    if (!vessel || sawVessel.current) return
    sawVessel.current = true
    if (fittedMode.current === 'flight') fittedMode.current = null
  }, [vessel])

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
      if (vesselRef.current) bounds.extend(vesselRef.current)
      map.fitBounds(bounds.pad(0.08), { animate: false })
    }
  }, [mode, map, vessel])

  return null
}

export function TrackMap({ ship, liveTrail = [], vessel = null }: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]
  const landed = isNearSurface(current.altitude)
  // Default to full flight so the whole Trajectory is visible; drift is opt-in.
  const [mode, setMode] = useState<ViewMode>('flight')

  const { ascent, reentry, oceanDrift, full } = useMemo(() => buildFlightPath(), [])
  const notices = useMemo(() => getNoticePolygons(), [])

  // Live SpaceX fixes accumulated while this browser has been polling.
  const livePath = useMemo(() => {
    const pts: Array<[number, number]> = liveTrail.map((p) => [
      p.latitude,
      p.longitude,
    ])
    const tip: [number, number] = [current.latitude, current.longitude]
    const last = pts[pts.length - 1]
    if (
      !last ||
      Math.hypot(last[0] - tip[0], last[1] - tip[1]) > 1e-7
    ) {
      pts.push(tip)
    }
    return pts
  }, [liveTrail, current.latitude, current.longitude])

  // Archived ocean-drift + live trail for close-up framing at mode switch.
  const driftFrame = useMemo(() => {
    const pts: Array<[number, number]> = oceanDrift.length
      ? [...oceanDrift]
      : [[LANDING_FIX.lat, LANDING_FIX.lon]]
    for (const p of livePath) pts.push(p)
    return pts
  }, [oceanDrift, livePath])

  /**
   * Bridge from the end of the archived drift path through every recorded
   * live SpaceX fix (no longer a single straight stub to "now").
   */
  const liveDriftPath = useMemo(() => {
    if (!landed || livePath.length === 0) return null
    const pts: Array<[number, number]> = []
    if (oceanDrift.length > 0) {
      pts.push(oceanDrift[oceanDrift.length - 1])
    }
    for (const p of livePath) pts.push(p)
    return pts.length >= 2 ? pts : null
  }, [landed, oceanDrift, livePath])

  const view = landed ? mode : 'flight'
  const vesselPos: LatLngExpression | null = vessel
    ? [vessel.latitude, vessel.longitude]
    : null

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
        // Fractional zoom + softer wheel scaling so zoom feels continuous.
        zoomSnap={0.1}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        wheelDebounceTime={20}
        zoomAnimation
        fadeAnimation
        markerZoomAnimation
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
          vessel={vesselPos}
        />

        {/* Notice polygons only in full-flight view (they clutter the close-up). */}
        {view === 'flight' &&
          notices.map((group) =>
            group.polygons.map((poly, idx) => (
              <Polygon
                key={`${group.id}-${idx}`}
                positions={poly}
                pathOptions={{
                  color:
                    group.type === 'ADP_LINK_FILE'
                      ? '#ff5a1f'
                      : group.type === 'NAVWARNING'
                        ? '#2dc2d9'
                        : '#e33636',
                  weight: 1,
                  opacity: 0.45,
                  fillColor:
                    group.type === 'ADP_LINK_FILE'
                      ? '#ff5a1f'
                      : group.type === 'NAVWARNING'
                        ? '#2dc2d9'
                        : '#e33636',
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

        {/* Always draw the full Flight 13 tracker path (ascent + reentry). */}
        {ascent.length >= 2 && (
          <Polyline
            positions={ascent}
            pathOptions={{
              color: '#ff5a1f',
              weight: 3,
              opacity: view === 'flight' ? 0.95 : 0.55,
            }}
          />
        )}

        {reentry.length >= 2 && (
          <Polyline
            positions={reentry}
            pathOptions={{
              color: '#e64613',
              weight: 3,
              opacity: view === 'flight' ? 0.95 : 0.55,
            }}
          />
        )}

        {/* Archived post-splashdown track */}
        {oceanDrift.length >= 2 && (
          <Polyline
            positions={oceanDrift}
            pathOptions={{
              color: '#ffc400',
              weight: view === 'drift' ? 4 : 2.5,
              opacity: 0.95,
            }}
          />
        )}

        {/* Live SpaceX trail after the archive (grows with each new fix) */}
        {liveDriftPath && (
          <Polyline
            positions={liveDriftPath}
            pathOptions={{
              color: '#ffc400',
              weight: view === 'drift' ? 4 : 2.5,
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
              {formatLatLon(LANDING_FIX.lat, LANDING_FIX.lon)}
              <br />
              First near-surface SpaceX fix
            </Popup>
          </Marker>
        )}

        {vessel && vesselPos && (
          <Marker position={vesselPos} icon={boatIcon}>
            <Popup>
              <strong>{vessel.name}</strong>
              <br />
              MMSI {vessel.mmsi}
              <br />
              {formatLatLon(vessel.latitude, vessel.longitude)}
              {vessel.speedKn != null ? (
                <>
                  <br />
                  {vessel.speedKn.toFixed(1)} kn
                </>
              ) : null}
              {vessel.ageMinutes != null ? (
                <>
                  <br />
                  AIS ~{Math.max(0, Math.round(vessel.ageMinutes))} min ago
                </>
              ) : null}
              <br />
              <a
                href={vessel.marinetrafficUrl}
                target="_blank"
                rel="noreferrer"
              >
                MarineTraffic
              </a>
            </Popup>
          </Marker>
        )}

        <CircleMarker
          center={center}
          radius={view === 'drift' ? 11 : 9}
          pathOptions={{
            color: '#ff5a1f',
            fillColor: '#ff5a1f',
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
            color: '#ff5a1f',
            fillOpacity: 0,
            weight: 1,
            opacity: 0.45,
          }}
        />
      </MapContainer>
    </div>
  )
}
