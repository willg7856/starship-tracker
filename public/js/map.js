import {
  buildFlightPath,
  getMeta,
  getNoticePolygons,
} from './path.js'
import { thinLatLonPath } from './trail.js'
import { formatLatLon, haversineKm, isNearSurface } from './utils.js'

const MAX_BRIDGE_KM = 1
const FOLLOW_ZOOM = 8
/** SpaceX pad-predicted trajectories often publish huge negative altitudes — ignore those. */
const TRAJ_ALT_MIN_M = -200
const TRAJ_ALT_MAX_M = 600_000
const PAD_STILL_ALT_M = 1500
const PAD_STILL_KM = 5

function isSaneTrajectoryPoint(p) {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180 &&
    Number.isFinite(p.altitude) &&
    p.altitude >= TRAJ_ALT_MIN_M &&
    p.altitude <= TRAJ_ALT_MAX_M
  )
}

function hazardStyle(notice) {
  const text = `${notice.name || ''} ${notice.type || ''}`.toUpperCase()
  const isReentry =
    text.includes('RE-ENTRY') ||
    text.includes('REENTRY') ||
    text.includes('SPLASHDOWN') ||
    text.includes('RETURN') ||
    text.includes('DEORBIT')
  // Merged unions use a single outline — no internal section borders.
  if (isReentry) {
    return {
      color: '#b45309',
      fillColor: '#e0a045',
      fillOpacity: 0.18,
      weight: 1,
      opacity: 0.7,
    }
  }
  return {
    color: '#c2410c',
    fillColor: '#ff5a1f',
    fillOpacity: 0.16,
    weight: 1,
    opacity: 0.65,
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

function sameWraps(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function createMap(container, { prelaunch = false } = {}) {
  const meta = getMeta()
  const paths = buildFlightPath()
  const notices = getNoticePolygons()
  /** @type {'follow' | 'wide' | 'auto'} */
  let camera = prelaunch ? 'wide' : 'follow'
  let showHazards = true
  let fittedCamera = null
  let latestLive = null
  let latestFullPath = []
  let userInteracting = false
  let activeWraps = [0]

  const layers = {
    ascent: [],
    reentry: [],
    hazards: [],
    live: [],
    ship: [],
    shipHalo: [],
    launch: [],
    landing: [],
    plannedLanding: [],
  }

  // Canonical geometry (unwrapped, primary world). Rebuild wraps from these.
  const source = {
    ascent: paths.ascent.length >= 2 ? paths.ascent : null,
    reentry: paths.reentry.length >= 2 ? paths.reentry : null,
    ascentStyle: { color: '#ff5a1f', weight: 3, opacity: 0.95 },
    reentryStyle: { color: '#e64613', weight: 3, opacity: 0.95 },
    live: null,
    liveStyle: null,
    launch: {
      latlng: [meta.launchPad.lat, meta.launchPad.lon],
      popup: `<strong>Liftoff</strong><br>${meta.launchPad.label}`,
    },
    landing: null,
    plannedLanding:
      prelaunch && meta.landingFix
        ? {
            latlng: [meta.landingFix.lat, meta.landingFix.lon],
            popup: `<strong>Planned splashdown</strong><br>${meta.landingFix.label}<br>${formatLatLon(
              meta.landingFix.lat,
              meta.landingFix.lon,
            )}`,
          }
        : null,
    ship: null,
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
    minZoom: 1,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    scrollWheelZoom: true,
  }).setView(initialCenter, prelaunch ? 7 : FOLLOW_ZOOM)

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18 },
  ).addTo(map)

  // Canvas is more reliable for many wrapped polygons than SVG.
  const vectorRenderer = L.canvas({ padding: 0.75 })

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

  function wrapsForView() {
    const bounds = map.getBounds()
    const west = bounds.getWest()
    const east = bounds.getEast()
    // Cover the visible range plus one world on each side for smooth pans.
    const start = Math.floor(west / 360) * 360 - 360
    const end = Math.ceil(east / 360) * 360 + 360
    const out = []
    for (let offset = start; offset <= end; offset += 360) out.push(offset)
    return out.length ? out : [0]
  }

  function addPolylineCopies(points, style, bucket) {
    if (!points || points.length < 2) return
    const unwrapped = unwrapRing(points)
    for (const offset of activeWraps) {
      bucket.push(
        L.polyline(shiftLatLngs(unwrapped, offset), {
          ...style,
          renderer: vectorRenderer,
        }).addTo(map),
      )
    }
  }

  function addPolygonCopies(ring, style, popupHtml, bucket) {
    if (!ring || ring.length < 3) return
    const unwrapped = unwrapRing(ring)
    for (const offset of activeWraps) {
      const layer = L.polygon(shiftLatLngs(unwrapped, offset), {
        ...style,
        renderer: vectorRenderer,
      })
      if (popupHtml) layer.bindPopup(popupHtml)
      layer.addTo(map)
      bucket.push(layer)
    }
  }

  function addMarkerCopies(latlng, icon, popupHtml, bucket) {
    for (const offset of activeWraps) {
      bucket.push(
        L.marker(shiftLatLng(latlng, offset), { icon })
          .bindPopup(popupHtml)
          .addTo(map),
      )
    }
  }

  function rebuildHazards() {
    clearLayerList(map, layers.hazards)
    if (!showHazards) return
    for (const notice of notices) {
      // No click popup: notice titles are truncated NOTAM/LNM jargon and
      // add little beyond the visual hazard fill itself.
      const style = hazardStyle(notice)
      for (const ring of notice.polygons || []) {
        addPolygonCopies(ring, style, null, layers.hazards)
      }
    }
  }

  function rebuildStaticMarkers() {
    clearLayerList(map, layers.launch)
    clearLayerList(map, layers.plannedLanding)
    clearLayerList(map, layers.landing)
    if (source.launch) {
      addMarkerCopies(
        source.launch.latlng,
        launchIcon,
        source.launch.popup,
        layers.launch,
      )
    }
    if (source.plannedLanding) {
      addMarkerCopies(
        source.plannedLanding.latlng,
        landingIcon,
        source.plannedLanding.popup,
        layers.plannedLanding,
      )
    }
    if (source.landing) {
      addMarkerCopies(
        source.landing.latlng,
        landingIcon,
        source.landing.popup,
        layers.landing,
      )
    }
  }

  function rebuildPaths() {
    clearLayerList(map, layers.ascent)
    clearLayerList(map, layers.reentry)
    clearLayerList(map, layers.live)
    if (source.ascent) addPolylineCopies(source.ascent, source.ascentStyle, layers.ascent)
    if (source.reentry) {
      addPolylineCopies(source.reentry, source.reentryStyle, layers.reentry)
    }
    if (source.live) {
      addPolylineCopies(source.live, source.liveStyle, layers.live)
    }
  }

  function rebuildShip() {
    clearLayerList(map, layers.ship)
    clearLayerList(map, layers.shipHalo)
    if (!source.ship) return
    const { latlng, radius, halo, popup } = source.ship
    for (const offset of activeWraps) {
      const pos = shiftLatLng(latlng, offset)
      layers.shipHalo.push(
        L.circleMarker(pos, {
          radius: halo,
          color: '#ff5a1f',
          fillOpacity: 0,
          weight: 1,
          opacity: 0.45,
          renderer: vectorRenderer,
        }).addTo(map),
      )
      layers.ship.push(
        L.circleMarker(pos, {
          radius,
          color: '#ff5a1f',
          fillColor: '#ff5a1f',
          fillOpacity: 0.95,
          weight: 2,
          renderer: vectorRenderer,
        })
          .bindPopup(popup)
          .addTo(map),
      )
    }
  }

  function rebuildAllWraps(force = false) {
    const next = wrapsForView()
    if (!force && sameWraps(next, activeWraps)) return
    activeWraps = next
    rebuildHazards()
    rebuildStaticMarkers()
    rebuildPaths()
    rebuildShip()
  }

  rebuildAllWraps(true)

  const shell = container.closest('.map-shell') || container.parentElement

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
        rebuildHazards()
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

    if (camera === 'wide' || camera === 'auto') {
      if (!force && fittedCamera === 'wide') return
      fittedCamera = 'wide'
      const bounds = overviewBounds()
      map.fitBounds(bounds.pad(0.18), {
        animate: !force,
        duration: 0.55,
        maxZoom: 4,
      })
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

  map.on('moveend zoomend', () => {
    rebuildAllWraps(false)
  })

  return {
    update({ ship, liveTrail = [], spaceNoticesExtension = [] }) {
      if (!ship?.current) {
        rebuildAllWraps(false)
        map.invalidateSize()
        return
      }

      const current = ship.current
      const live = [current.latitude, current.longitude]
      latestLive = live
      const landed = isNearSurface(current.altitude)
      const stillOnPad =
        Number.isFinite(current.altitude) &&
        current.altitude < PAD_STILL_ALT_M &&
        haversineKm(
          meta.launchPad.lat,
          meta.launchPad.lon,
          current.latitude,
          current.longitude,
        ) < PAD_STILL_KM

      // Keep the planned splashdown marker while Ship 41 is still on the pad.
      if (stillOnPad && meta.landingFix) {
        source.plannedLanding = {
          latlng: [meta.landingFix.lat, meta.landingFix.lon],
          popup: `<strong>Planned splashdown</strong><br>${meta.landingFix.label}<br>${formatLatLon(
            meta.landingFix.lat,
            meta.landingFix.lon,
          )}`,
        }
      } else {
        source.plannedLanding = null
      }

      if (camera === 'auto' && !landed) {
        camera = 'follow'
        syncCameraButtons()
      }

      const snExtensionPath = spaceNoticesExtension.map((p) => [
        p.latitude,
        p.longitude,
      ])

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
          .filter(isSaneTrajectoryPoint)
          .map((p) => [p.latitude, p.longitude])
        // Prefer the live SpaceX path once it has real motion / altitude.
        if (sxPath.length >= 2) fullPath = thinLatLonPath(sxPath)
      }

      // Always extend the displayed path with the live tip.
      if (
        fullPath.length &&
        (fullPath[fullPath.length - 1][0] !== live[0] ||
          fullPath[fullPath.length - 1][1] !== live[1])
      ) {
        fullPath = [...fullPath, live]
      } else if (!fullPath.length) {
        fullPath = [live]
      }

      const livePath = liveTrail.map((p) => [p.latitude, p.longitude])
      latestFullPath = fullPath

      if (!meta.hasFlightPath && fullPath.length >= 2) {
        source.ascent = fullPath
      }
      source.ascentStyle = {
        color: '#ff5a1f',
        weight: 3,
        opacity: 0.95,
      }
      source.reentryStyle = {
        color: '#e64613',
        weight: 3,
        opacity: 0.95,
      }

      source.live = null
      source.liveStyle = null
      if (livePath.length >= 2) {
        source.live = thinLatLonPath(livePath)
        source.liveStyle = {
          color: '#ffc400',
          weight: 2.5,
          opacity: 0.95,
        }
      }

      if (landed && meta.landingFix && !stillOnPad) {
        source.landing = {
          latlng: [meta.landingFix.lat, meta.landingFix.lon],
          popup: `<strong>Splashdown</strong><br>${formatLatLon(
            meta.landingFix.lat,
            meta.landingFix.lon,
          )}`,
        }
      } else {
        source.landing = null
      }

      const shipLabel = meta.vehicle || 'Ship 41'
      source.ship = {
        latlng: live,
        radius: 9,
        halo: 18,
        popup: `<strong>${shipLabel}</strong><br>${formatLatLon(live[0], live[1])}<br>Live from SpaceX`,
      }

      // Keep wrap copies in sync with the viewport, then redraw live layers.
      const nextWraps = wrapsForView()
      if (!sameWraps(nextWraps, activeWraps)) {
        activeWraps = nextWraps
        rebuildHazards()
      }
      rebuildStaticMarkers()
      rebuildPaths()
      rebuildShip()
      applyCamera(false)
      map.invalidateSize()
    },
  }
}
