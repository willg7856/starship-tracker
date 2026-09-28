import {
  buildFlightPath,
  getMeta,
  getNoticePolygons,
  splitPathByDistanceGap,
} from './path.js'
import { thinLatLonPath } from './trail.js'
import { formatLatLon, haversineKm, isNearSurface } from './utils.js'

const MAX_BRIDGE_KM = 1
const FOLLOW_ZOOM = 8
/** Draw overlays on neighboring world copies so wrapping maps stay populated. */
const LON_WRAPS = [0]

function hazardStyle(notice) {
  const text = `${notice.name || ''} ${notice.type || ''}`.toUpperCase()
  const isReentry =
    text.includes('RE-ENTRY') ||
    text.includes('REENTRY') ||
    text.includes('SPLASHDOWN') ||
    text.includes('RETURN') ||
    text.includes('DEORBIT')
  if (isReentry) {
    return {
      color: '#b45309',
      fillColor: '#e0a045',
      fillOpacity: 0.16,
      weight: 1.25,
      opacity: 0.75,
    }
  }
  return {
    color: '#c2410c',
    fillColor: '#ff5a1f',
    fillOpacity: 0.14,
    weight: 1.25,
    opacity: 0.7,
  }
}

/** Keep rings continuous across the antimeridian for Leaflet. */
function unwrapRing(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return ring
  const out = [[ring[0][0], ring[0][1]]]
  for (let i = 1; i < ring.length; i++) {
    const lat = ring[i][0]
    let lon = ring[i][1]
    const prev = out[out.length - 1][1]
    while (lon - prev > 180) lon -= 360
    while (lon - prev < -180) lon += 360
    out.push([lat, lon])
  }
  return out
}

function shiftLatLng(latlng, lonOffset) {
  return [latlng[0], latlng[1] + lonOffset]
}

function shiftLatLngs(points, lonOffset) {
  return points.map((p) => shiftLatLng(p, lonOffset))
}

function clearLayerList(map, list) {
  for (const layer of list) map.removeLayer(layer)
  list.length = 0
}

export function createMap(container, { prelaunch = false } = {}) {
  const meta = getMeta()
  const paths = buildFlightPath()
  const notices = getNoticePolygons()
  let mode = prelaunch || !meta.hasFlightPath ? 'flight' : 'drift'
  /** @type {'follow' | 'wide' | 'auto'} */
  let camera = prelaunch ? 'wide' : 'follow'
  let showHazards = true
  let fittedCamera = null
  let fittedMode = null
  let latestLive = null
  let latestFullPath = []
  let latestDriftFrame = []
  let userInteracting = false
  let layers = {
    ascent: [],
    reentry: [],
    drift: [],
    hazards: [],
    live: [],
    ship: [],
    shipHalo: [],
    launch: [],
    landing: [],
    plannedLanding: [],
  }

  const initialCenter = prelaunch
    ? [meta.launchPad.lat, meta.launchPad.lon]
    : meta.landingFix
      ? [meta.landingFix.lat, meta.landingFix.lon]
      : [meta.launchPad.lat, meta.launchPad.lon]

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: false,
    maxBounds: [
      [-85, -180],
      [85, 180],
    ],
    maxBoundsViscosity: 1,
    maxZoom: 18,
    minZoom: 2,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    scrollWheelZoom: true,
  }).setView(initialCenter, prelaunch ? 7 : FOLLOW_ZOOM)

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, noWrap: true, bounds: [
      [-85, -180],
      [85, 180],
    ] },
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

  function addWrappedMarkers(latlng, icon, popupHtml, bucket) {
    for (const offset of LON_WRAPS) {
      const marker = L.marker(shiftLatLng(latlng, offset), { icon })
        .bindPopup(popupHtml)
        .addTo(map)
      bucket.push(marker)
    }
  }

  function addWrappedPolyline(points, style, bucket) {
    if (!points || points.length < 2) return
    const unwrapped = unwrapRing(points)
    for (const offset of LON_WRAPS) {
      const layer = L.polyline(shiftLatLngs(unwrapped, offset), style).addTo(map)
      bucket.push(layer)
    }
  }

  function addWrappedPolygon(ring, style, popupHtml, bucket) {
    if (!ring || ring.length < 3) return
    const unwrapped = unwrapRing(ring)
    for (const offset of LON_WRAPS) {
      const layer = L.polygon(shiftLatLngs(unwrapped, offset), style)
      if (popupHtml) layer.bindPopup(popupHtml)
      layer.addTo(map)
      bucket.push(layer)
    }
  }

  function setWrappedStyle(bucket, style) {
    for (const layer of bucket) layer.setStyle(style)
  }

  addWrappedMarkers(
    [meta.launchPad.lat, meta.launchPad.lon],
    launchIcon,
    `<strong>Liftoff</strong><br>${meta.launchPad.label}`,
    layers.launch,
  )

  if (paths.ascent.length >= 2) {
    addWrappedPolyline(
      paths.ascent,
      { color: '#ff5a1f', weight: 3, opacity: 0.95 },
      layers.ascent,
    )
  }
  if (paths.reentry.length >= 2) {
    addWrappedPolyline(
      paths.reentry,
      { color: '#e64613', weight: 3, opacity: 0.95 },
      layers.reentry,
    )
  }

  if (prelaunch && meta.landingFix) {
    addWrappedMarkers(
      [meta.landingFix.lat, meta.landingFix.lon],
      landingIcon,
      `<strong>Planned splashdown</strong><br>${meta.landingFix.label}<br>${formatLatLon(
        meta.landingFix.lat,
        meta.landingFix.lon,
      )}`,
      layers.plannedLanding,
    )
  }

  function clearHazardLayers() {
    clearLayerList(map, layers.hazards)
  }

  function renderHazards() {
    clearHazardLayers()
    if (!showHazards) return
    for (const notice of notices) {
      const rings = notice.polygons || []
      const title = notice.name || notice.id || 'Hazard zone'
      const kind = notice.type ? ` <span>${notice.type}</span>` : ''
      const popup = `<strong>Hazard zone</strong>${kind}<br>${title.replace(/</g, '&lt;')}`
      const style = hazardStyle(notice)
      for (const ring of rings) {
        addWrappedPolygon(ring, style, popup, layers.hazards)
      }
    }
  }

  renderHazards()

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
      '<button type="button" data-camera="wide">Wide</button>' +
      '<button type="button" data-hazards="toggle" class="active" aria-pressed="true">Hazards</button>'
    shell.append(cameraEl)
    cameraEl.addEventListener('click', (e) => {
      const hazardBtn = e.target.closest('button[data-hazards]')
      if (hazardBtn) {
        showHazards = !showHazards
        hazardBtn.classList.toggle('active', showHazards)
        hazardBtn.setAttribute('aria-pressed', String(showHazards))
        renderHazards()
        if (camera === 'wide') {
          fittedCamera = null
          applyCamera(true)
        }
        return
      }
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
    if (showHazards) {
      for (const notice of notices) {
        for (const ring of notice.polygons || []) {
          for (const pt of unwrapRing(ring)) {
            if (
              Array.isArray(pt) &&
              Number.isFinite(pt[0]) &&
              Number.isFinite(pt[1])
            ) {
              points.push(pt)
            }
          }
        }
      }
    }
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
    clearLayerList(map, layers.drift)
    clearLayerList(map, layers.live)
  }

  return {
    update({ ship, liveTrail = [], spaceNoticesExtension = [] }) {
      if (!ship?.current) {
        map.invalidateSize()
        return
      }

      if (layers.plannedLanding.length) {
        clearLayerList(map, layers.plannedLanding)
      }

      const current = ship.current
      const live = [current.latitude, current.longitude]
      latestLive = live
      const landed = isNearSurface(current.altitude)
      const view = landed && meta.hasFlightPath ? mode : 'flight'

      if (toggleEl) toggleEl.hidden = !(landed && meta.hasFlightPath)

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
        addWrappedPolyline(
          segment,
          {
            color: '#ffc400',
            weight: view === 'drift' ? 4 : 2.5,
            opacity: 0.95,
          },
          layers.drift,
        )
      }

      if (!meta.hasFlightPath && fullPath.length >= 2) {
        clearLayerList(map, layers.ascent)
        addWrappedPolyline(
          fullPath,
          { color: '#ff5a1f', weight: 3, opacity: 0.95 },
          layers.ascent,
        )
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
          addWrappedPolyline(
            pts,
            {
              color: '#ffc400',
              weight: view === 'drift' ? 4 : 2.5,
              opacity: 0.95,
            },
            layers.live,
          )
        }
      }

      setWrappedStyle(layers.ascent, {
        opacity: view === 'flight' ? 0.95 : 0.55,
      })
      setWrappedStyle(layers.reentry, {
        opacity: view === 'flight' ? 0.95 : 0.55,
      })

      if (landed && meta.landingFix) {
        if (!layers.landing.length) {
          addWrappedMarkers(
            [meta.landingFix.lat, meta.landingFix.lon],
            landingIcon,
            `<strong>Splashdown</strong><br>${formatLatLon(
              meta.landingFix.lat,
              meta.landingFix.lon,
            )}`,
            layers.landing,
          )
        }
      } else if (layers.landing.length) {
        clearLayerList(map, layers.landing)
      }

      const radius = view === 'drift' ? 11 : 9
      const halo = view === 'drift' ? 22 : 18
      const shipLabel = meta.vehicle || 'Ship 41'
      const popup = `<strong>${shipLabel}</strong><br>${formatLatLon(live[0], live[1])}`
      if (!layers.ship.length) {
        for (const offset of LON_WRAPS) {
          const pos = shiftLatLng(live, offset)
          layers.shipHalo.push(
            L.circleMarker(pos, {
              radius: halo,
              color: '#ff5a1f',
              fillOpacity: 0,
              weight: 1,
              opacity: 0.45,
            }).addTo(map),
          )
          layers.ship.push(
            L.circleMarker(pos, {
              radius,
              color: '#ff5a1f',
              fillColor: '#ff5a1f',
              fillOpacity: 0.95,
              weight: 2,
            })
              .bindPopup(popup)
              .addTo(map),
          )
        }
      } else {
        for (let i = 0; i < LON_WRAPS.length; i++) {
          const pos = shiftLatLng(live, LON_WRAPS[i])
          layers.ship[i].setLatLng(pos)
          layers.ship[i].setRadius(radius)
          layers.ship[i].setPopupContent(popup)
          layers.shipHalo[i].setLatLng(pos)
          layers.shipHalo[i].setRadius(halo)
        }
      }

      applyCamera(false)
      map.invalidateSize()
    },
  }
}
