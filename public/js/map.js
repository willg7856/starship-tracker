import {
  buildFlightPath,
  getMeta,
  splitPathByDistanceGap,
} from './path.js'
import { thinLatLonPath } from './trail.js'
import { formatLatLon, haversineKm, isNearSurface } from './utils.js'

const MAX_BRIDGE_KM = 1
const FOLLOW_ZOOM = 8

export function createMap(container, { prelaunch = false } = {}) {
  const meta = getMeta()
  const paths = buildFlightPath()
  let mode = prelaunch || !meta.hasFlightPath ? 'flight' : 'drift'
  /** @type {'follow' | 'wide' | 'auto'} */
  let camera = prelaunch ? 'wide' : 'follow'
  let fittedCamera = null
  let fittedMode = null
  let latestLive = null
  let latestFullPath = []
  let latestDriftFrame = []
  let userInteracting = false
  let layers = {
    ascent: null,
    reentry: null,
    drift: [],
    live: null,
    ship: null,
    shipHalo: null,
    launch: null,
    landing: null,
    plannedLanding: null,
  }

  const initialCenter = prelaunch
    ? [meta.launchPad.lat, meta.launchPad.lon]
    : meta.landingFix
      ? [meta.landingFix.lat, meta.landingFix.lon]
      : [meta.launchPad.lat, meta.launchPad.lon]

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: true,
    maxZoom: 18,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    scrollWheelZoom: true,
  }).setView(initialCenter, prelaunch ? 7 : FOLLOW_ZOOM)

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18 },
  ).addTo(map)

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

  layers.launch = L.marker([meta.launchPad.lat, meta.launchPad.lon], {
    icon: launchIcon,
  })
    .bindPopup(`<strong>Liftoff</strong><br>${meta.launchPad.label}`)
    .addTo(map)

  if (paths.ascent.length >= 2) {
    layers.ascent = L.polyline(paths.ascent, {
      color: '#ff5a1f',
      weight: 3,
      opacity: 0.95,
    }).addTo(map)
  }
  if (paths.reentry.length >= 2) {
    layers.reentry = L.polyline(paths.reentry, {
      color: '#e64613',
      weight: 3,
      opacity: 0.95,
    }).addTo(map)
  }

  if (prelaunch && meta.landingFix) {
    layers.plannedLanding = L.marker(
      [meta.landingFix.lat, meta.landingFix.lon],
      { icon: landingIcon },
    )
      .bindPopup(
        `<strong>Planned splashdown</strong><br>${meta.landingFix.label}<br>${formatLatLon(
          meta.landingFix.lat,
          meta.landingFix.lon,
        )}`,
      )
      .addTo(map)
  }

  const shell = container.closest('.map-shell') || container.parentElement

  let toggleEl = shell?.querySelector('.map-view-toggle')
  if (!prelaunch && !toggleEl && shell) {
    toggleEl = document.createElement('div')
    toggleEl.className = 'map-view-toggle'
    toggleEl.setAttribute('role', 'group')
    toggleEl.setAttribute('aria-label', 'Map path view')
    toggleEl.hidden = true
    toggleEl.innerHTML =
      '<button type="button" data-mode="drift" class="active">Drift</button>' +
      '<button type="button" data-mode="flight">Flight</button>'
    shell.prepend(toggleEl)
    toggleEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]')
      if (!btn) return
      mode = btn.dataset.mode
      toggleEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b === btn)
      })
      fittedMode = null
      if (camera === 'auto') applyCamera(true)
    })
  }
  if (toggleEl && prelaunch) toggleEl.hidden = true

  let cameraEl = shell?.querySelector('.map-camera-controls')
  if (!cameraEl && shell) {
    cameraEl = document.createElement('div')
    cameraEl.className = 'map-camera-controls'
    cameraEl.setAttribute('role', 'group')
    cameraEl.setAttribute('aria-label', 'Map camera')
    cameraEl.innerHTML =
      '<button type="button" data-camera="follow">Follow</button>' +
      '<button type="button" data-camera="wide">Wide</button>'
    shell.append(cameraEl)
    cameraEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-camera]')
      if (!btn) return
      setCamera(btn.dataset.camera, true)
    })
  }

  function syncCameraButtons() {
    if (!cameraEl) return
    cameraEl.querySelectorAll('button[data-camera]').forEach((b) => {
      b.classList.toggle('active', b.dataset.camera === camera)
    })
  }

  function setCamera(next, force = false) {
    camera = next
    fittedCamera = null
    fittedMode = null
    userInteracting = false
    syncCameraButtons()
    applyCamera(force)
  }

  function overviewBounds() {
    const points = []
    points.push([meta.launchPad.lat, meta.launchPad.lon])
    if (meta.landingFix) {
      points.push([meta.landingFix.lat, meta.landingFix.lon])
    }
    for (const p of latestFullPath) points.push(p)
    for (const p of latestDriftFrame) points.push(p)
    if (latestLive) points.push(latestLive)
    if (points.length < 2) {
      return L.latLngBounds(
        points[0] || initialCenter,
        points[0] || initialCenter,
      )
    }
    return L.latLngBounds(points)
  }

  function applyCamera(force = false) {
    if (userInteracting && !force) return

    if (camera === 'follow') {
      if (!latestLive) return
      if (!force && fittedCamera === 'follow') {
        map.panTo(latestLive, { animate: true, duration: 0.45 })
        return
      }
      fittedCamera = 'follow'
      map.setView(latestLive, FOLLOW_ZOOM, { animate: !force, duration: 0.5 })
      return
    }

    if (camera === 'wide') {
      if (!force && fittedCamera === 'wide') return
      fittedCamera = 'wide'
      const bounds = overviewBounds()
      map.fitBounds(bounds.pad(0.18), {
        animate: !force,
        duration: 0.55,
        maxZoom: 4,
      })
      return
    }

    // auto: legacy drift/flight framing
    const view = mode
    if (!force && fittedMode === view) return
    fittedMode = view
    if (view === 'drift') {
      const anchor = meta.landingFix
        ? [[meta.landingFix.lat, meta.landingFix.lon]]
        : [[meta.launchPad.lat, meta.launchPad.lon]]
      const bounds = L.latLngBounds(
        latestDriftFrame.length ? latestDriftFrame : anchor,
      )
      if (latestLive) bounds.extend(latestLive)
      map.fitBounds(bounds.pad(0.35), { animate: false })
      return
    }
    if (latestFullPath.length >= 2) {
      const bounds = L.latLngBounds(latestFullPath)
      if (latestLive) bounds.extend(latestLive)
      map.fitBounds(bounds.pad(0.08), { animate: false })
      return
    }
    if (latestLive) {
      map.setView(latestLive, Math.max(map.getZoom(), 6), { animate: false })
    }
  }

  syncCameraButtons()
  if (prelaunch) {
    latestFullPath = paths.full.length
      ? paths.full
      : [
          [meta.launchPad.lat, meta.launchPad.lon],
          meta.landingFix
            ? [meta.landingFix.lat, meta.landingFix.lon]
            : [meta.launchPad.lat, meta.launchPad.lon],
        ]
    setCamera('wide', true)
  }

  map.on('dragstart zoomstart', () => {
    if (camera === 'follow') {
      userInteracting = true
      camera = 'auto'
      fittedCamera = null
      syncCameraButtons()
    }
  })

  function clearDriftLayers() {
    for (const layer of layers.drift) map.removeLayer(layer)
    layers.drift = []
    if (layers.live) {
      map.removeLayer(layers.live)
      layers.live = null
    }
  }

  return {
    update({ ship, liveTrail = [], spaceNoticesExtension = [] }) {
      if (!ship?.current) {
        map.invalidateSize()
        return
      }

      if (layers.plannedLanding) {
        map.removeLayer(layers.plannedLanding)
        layers.plannedLanding = null
      }

      const current = ship.current
      const live = [current.latitude, current.longitude]
      latestLive = live
      const landed = isNearSurface(current.altitude)
      const view = landed && meta.hasFlightPath ? mode : 'flight'

      if (toggleEl) toggleEl.hidden = !(landed && meta.hasFlightPath)

      // Prefer Follow during ascent/flight; keep Wide if user chose it.
      if (camera === 'auto' && !landed) {
        camera = 'follow'
        syncCameraButtons()
      }

      const snExtensionPath = spaceNoticesExtension.map((p) => [
        p.latitude,
        p.longitude,
      ])

      const oceanDriftCleanSegments = (() => {
        const extended = paths.oceanDriftSegments.map((seg) => [...seg])
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
      })()

      let fullPath = [...paths.full]
      if (snExtensionPath.length > 0) {
        const last = fullPath[fullPath.length - 1]
        const firstSn = snExtensionPath[0]
        if (
          !(
            last &&
            haversineKm(last[0], last[1], firstSn[0], firstSn[1]) >
              MAX_BRIDGE_KM
          )
        ) {
          fullPath = [...fullPath, ...snExtensionPath]
        }
      }

      const sxTrajectory = Array.isArray(ship.trajectory) ? ship.trajectory : []
      if (!meta.hasFlightPath && sxTrajectory.length >= 2) {
        const sxPath = sxTrajectory
          .filter(
            (p) =>
              Number.isFinite(p.latitude) &&
              Number.isFinite(p.longitude) &&
              (p.altitude == null || p.altitude > -500000),
          )
          .map((p) => [p.latitude, p.longitude])
        if (sxPath.length >= 2) fullPath = thinLatLonPath(sxPath)
      }

      const livePath = liveTrail.map((p) => [p.latitude, p.longitude])
      const driftFrame = meta.landingFix
        ? [[meta.landingFix.lat, meta.landingFix.lon]]
        : [[meta.launchPad.lat, meta.launchPad.lon]]
      for (const seg of oceanDriftCleanSegments) for (const p of seg) driftFrame.push(p)
      for (const p of livePath) driftFrame.push(p)
      driftFrame.push(live)

      latestFullPath = fullPath
      latestDriftFrame = driftFrame

      clearDriftLayers()
      for (const segment of oceanDriftCleanSegments) {
        if (segment.length < 2) continue
        const layer = L.polyline(segment, {
          color: '#ffc400',
          weight: view === 'drift' ? 4 : 2.5,
          opacity: 0.95,
        }).addTo(map)
        layers.drift.push(layer)
      }

      if (!meta.hasFlightPath && fullPath.length >= 2) {
        if (layers.ascent) map.removeLayer(layers.ascent)
        layers.ascent = L.polyline(fullPath, {
          color: '#ff5a1f',
          weight: 3,
          opacity: 0.95,
        }).addTo(map)
      }

      if (landed && livePath.length) {
        const tipSeg = oceanDriftCleanSegments[oceanDriftCleanSegments.length - 1]
        const anchor = tipSeg?.[tipSeg.length - 1]
        const firstLive = livePath[0]
        let pts = null
        if (
          anchor &&
          haversineKm(anchor[0], anchor[1], firstLive[0], firstLive[1]) >
            MAX_BRIDGE_KM
        ) {
          pts = livePath.length >= 2 ? thinLatLonPath(livePath) : null
        } else {
          pts = []
          if (anchor) pts.push(anchor)
          for (const p of livePath) pts.push(p)
          const last = pts[pts.length - 1]
          if (
            last &&
            haversineKm(last[0], last[1], live[0], live[1]) <= MAX_BRIDGE_KM &&
            Math.hypot(last[0] - live[0], last[1] - live[1]) > 1e-7
          ) {
            pts.push(live)
          }
          pts = pts.length >= 2 ? thinLatLonPath(pts) : null
        }
        if (pts) {
          layers.live = L.polyline(pts, {
            color: '#ffc400',
            weight: view === 'drift' ? 4 : 2.5,
            opacity: 0.95,
          }).addTo(map)
        }
      }

      if (layers.ascent) {
        layers.ascent.setStyle({ opacity: view === 'flight' ? 0.95 : 0.55 })
      }
      if (layers.reentry) {
        layers.reentry.setStyle({ opacity: view === 'flight' ? 0.95 : 0.55 })
      }

      if (landed && meta.landingFix) {
        if (!layers.landing) {
          layers.landing = L.marker(
            [meta.landingFix.lat, meta.landingFix.lon],
            { icon: landingIcon },
          )
            .bindPopup(
              `<strong>Splashdown</strong><br>${formatLatLon(
                meta.landingFix.lat,
                meta.landingFix.lon,
              )}`,
            )
            .addTo(map)
        }
      } else if (layers.landing) {
        map.removeLayer(layers.landing)
        layers.landing = null
      }

      const radius = view === 'drift' ? 11 : 9
      const halo = view === 'drift' ? 22 : 18
      const shipLabel = meta.vehicle || 'Ship 41'
      if (!layers.ship) {
        layers.shipHalo = L.circleMarker(live, {
          radius: halo,
          color: '#ff5a1f',
          fillOpacity: 0,
          weight: 1,
          opacity: 0.45,
        }).addTo(map)
        layers.ship = L.circleMarker(live, {
          radius,
          color: '#ff5a1f',
          fillColor: '#ff5a1f',
          fillOpacity: 0.95,
          weight: 2,
        })
          .bindPopup(
            `<strong>${shipLabel}</strong><br>${formatLatLon(live[0], live[1])}`,
          )
          .addTo(map)
      } else {
        layers.ship.setLatLng(live)
        layers.ship.setRadius(radius)
        layers.ship.setPopupContent(
          `<strong>${shipLabel}</strong><br>${formatLatLon(live[0], live[1])}`,
        )
        layers.shipHalo.setLatLng(live)
        layers.shipHalo.setRadius(halo)
      }

      applyCamera(false)
      map.invalidateSize()
    },
  }
}
