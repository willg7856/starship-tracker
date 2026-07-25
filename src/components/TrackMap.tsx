import { useEffect, useMemo, useRef, useState } from 'react'
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
  LANDING_FIX,
  LAUNCH_PAD,
  buildFlightPath,
  splitPathByDistanceGap,
} from '../data/flight13Path'
import type { LiveTrailPoint } from '../lib/liveTrail'
import { thinLatLonPath } from '../lib/liveTrail'
import type { SpaceNoticesPoint } from '../lib/spaceNotices'
import { formatLatLon, haversineKm, isNearSurface } from '../lib/spacex'
import type { ShipTrack } from '../lib/spacex'

/** Don't stitch live/SN tip segments across jumps larger than this. */
const MAX_BRIDGE_KM = 1
import 'leaflet/dist/leaflet.css'

type Props = {
  ship: ShipTrack
  liveTrail?: LiveTrailPoint[]
  /** Newer Space Notices samples beyond the baked archive tip. */
  spaceNoticesExtension?: SpaceNoticesPoint[]
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

export function TrackMap({
  ship,
  liveTrail = [],
  spaceNoticesExtension = [],
}: Props) {
  const current = ship.current
  const center: LatLngExpression = [current.latitude, current.longitude]
  const landed = isNearSurface(current.altitude)
  const [mode, setMode] = useState<ViewMode>('drift')

  const { ascent, reentry, oceanDriftSegments, full } = useMemo(
    () => buildFlightPath(),
    [],
  )

  const snExtensionPath = useMemo(
    () =>
      spaceNoticesExtension.map(
        (p) => [p.latitude, p.longitude] as [number, number],
      ),
    [spaceNoticesExtension],
  )

  // Thin each continuous Space Notices drift segment; never join across gaps.
  const oceanDriftCleanSegments = useMemo(() => {
    const extended = [...oceanDriftSegments]
    if (snExtensionPath.length > 0) {
      const lastSeg = extended[extended.length - 1]
      const anchor = lastSeg?.[lastSeg.length - 1]
      const firstSn = snExtensionPath[0]
      if (
        anchor &&
        haversineKm(anchor[0], anchor[1], firstSn[0], firstSn[1]) <=
          MAX_BRIDGE_KM
      ) {
        extended[extended.length - 1] = thinLatLonPath([
          ...lastSeg,
          ...snExtensionPath,
        ])
      } else {
        for (const seg of splitPathByDistanceGap(snExtensionPath)) {
          extended.push(thinLatLonPath(seg))
        }
      }
    }
    return extended.map((seg) => thinLatLonPath(seg))
  }, [oceanDriftSegments, snExtensionPath])

  const fullPath = useMemo(() => {
    const pts = [...full]
    if (snExtensionPath.length === 0) return pts
    const last = pts[pts.length - 1]
    const firstSn = snExtensionPath[0]
    if (
      last &&
      haversineKm(last[0], last[1], firstSn[0], firstSn[1]) > MAX_BRIDGE_KM
    ) {
      return pts
    }
    return [...pts, ...snExtensionPath]
  }, [full, snExtensionPath])

  const livePath = useMemo(() => {
    // Trail is already thinned on write; don't stitch the raw jittery tip onto it.
    return liveTrail.map((p) => [p.latitude, p.longitude] as [number, number])
  }, [liveTrail])

  const driftFrame = useMemo(() => {
    const pts: Array<[number, number]> = [[LANDING_FIX.lat, LANDING_FIX.lon]]
    for (const seg of oceanDriftCleanSegments) for (const p of seg) pts.push(p)
    for (const p of livePath) pts.push(p)
    pts.push([current.latitude, current.longitude])
    return pts
  }, [oceanDriftCleanSegments, livePath, current.latitude, current.longitude])

  // Near-tip live trail only — do not bridge across archive / telemetry gaps.
  const liveDriftPath = useMemo(() => {
    if (!landed || livePath.length === 0) return null
    const tipSeg = oceanDriftCleanSegments[oceanDriftCleanSegments.length - 1]
    const anchor = tipSeg?.[tipSeg.length - 1]
    const firstLive = livePath[0]
    if (
      anchor &&
      haversineKm(anchor[0], anchor[1], firstLive[0], firstLive[1]) >
        MAX_BRIDGE_KM
    ) {
      return livePath.length >= 2 ? thinLatLonPath(livePath) : null
    }
    const pts: Array<[number, number]> = []
    if (anchor) pts.push(anchor)
    for (const p of livePath) pts.push(p)
    const tip: [number, number] = [current.latitude, current.longitude]
    const last = pts[pts.length - 1]
    if (
      last &&
      haversineKm(last[0], last[1], tip[0], tip[1]) <= MAX_BRIDGE_KM &&
      Math.hypot(last[0] - tip[0], last[1] - tip[1]) > 1e-7
    ) {
      pts.push(tip)
    }
    return pts.length >= 2 ? thinLatLonPath(pts) : null
  }, [
    landed,
    oceanDriftCleanSegments,
    livePath,
    current.latitude,
    current.longitude,
  ])

  const view = landed ? mode : 'flight'

  return (
    <div className="map-shell">
      {landed && (
        <div className="map-view-toggle" role="group" aria-label="Map view">
          <button
            type="button"
            className={view === 'drift' ? 'active' : undefined}
            onClick={() => setMode('drift')}
          >
            Drift
          </button>
          <button
            type="button"
            className={view === 'flight' ? 'active' : undefined}
            onClick={() => setMode('flight')}
          >
            Flight
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
          fullPath={fullPath}
          driftPoints={driftFrame}
          live={center}
        />

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

        {oceanDriftCleanSegments.map((segment, idx) => (
          <Polyline
            key={`drift-${idx}`}
            positions={segment}
            pathOptions={{
              color: '#ffc400',
              weight: view === 'drift' ? 4 : 2.5,
              opacity: 0.95,
            }}
          />
        ))}

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
            <strong>Ship 40</strong>
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
