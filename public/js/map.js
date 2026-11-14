import {
  buildFlightPath,
  getMeta,
  getNoticePolygons,
} from './path.js'
import { thinLatLonPath } from './trail.js'
import { allStarlinkPositions, loadAllStarlinks } from './starlinks-all.js'
import { formatLatLon, haversineKm, isNearSurface } from './utils.js'

const FOLLOW_ZOOM = 8
const ORBIT_FOLLOW_ZOOM = 4
const PAD_STILL_ALT_M = 1500
const PAD_STILL_KM = 5

function hazardStyle(notice) {
  const text = `${notice.name || ''} ${notice.type || ''}`.toUpperCase()
  const isReentry =
    text.includes('RE-ENTRY') ||
    text.includes('REENTRY') ||
    text.includes('SPLASHDOWN') ||
    text.includes('RETURN') ||
    text.includes('DEORBIT')
  // Backup return areas, only used if the ship cannot come home: dashed.
  if (text.includes('CONTINGENCY')) {
    return {
      color: '#b45309',
      fillColor: '#e0a045',
      fillOpacity: 0.1,
      weight: 1,
      opacity: 0.7,
      dashArray: '4 4',
    }
  }
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

/**
 * Split a [lat, lon] path where it crosses the antimeridian, into pieces
 * whose longitudes all lie in [-180, 180]. Each cut gets an interpolated
 * point on the ±180 line so neighbouring pieces meet exactly.
 */
export function splitAtAntimeridian(points) {
  const norm = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180
  const pieces = []
  let cur = []
  let prev = null
  for (const p of points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const pt = [p[0], norm(p[1])]
    if (prev) {
      const d = pt[1] - prev[1]
      if (Math.abs(d) > 180) {
        // Crossing: continue the longitude across the edge, interpolate.
        const edge = d < 0 ? 180 : -180
        const lonU = pt[1] + (d < 0 ? 360 : -360)
        const t = (edge - prev[1]) / (lonU - prev[1])
        const lat = prev[0] + t * (pt[0] - prev[0])
        cur.push([lat, edge])
        pieces.push(cur)
        cur = [[lat, -edge]]
      }
    }
    cur.push(pt)
    prev = pt
  }
  if (cur.length) pieces.push(cur)
  return pieces
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
  /**
   * follow: keep the ship centred every update (zoom is the viewer's).
   * wide: fit the whole flight. free: the viewer dragged the map.
   * @type {'follow' | 'wide' | 'free'}
   */
  let camera = prelaunch ? 'wide' : 'follow'
  // Until the viewer picks a camera, switch to Follow once the ship flies.
  let viewerChoseCamera = false
  let latestAltitude = null
  // Off by default: the zones cover a lot of ocean. The toggle shows them.
  let showHazards = false
  let fittedCamera = null
  let latestLive = null
  let latestFullPath = []
  let activeWraps = [0]

  const layers = {
    ascent: [],
    reentry: [],
    hazards: [],
    live: [],
    planned: [],
    booster: [],
    starlink: [],
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
            popup: `<strong>${landingTitle(meta, true)}</strong><br>${meta.landingFix.label}<br>${formatLatLon(
              meta.landingFix.lat,
              meta.landingFix.lon,
            )}`,
          }
        : null,
    ship: null,
    // Planned re-entry path into the launch site (dashed).
    planned: null,
    // Super Heavy, when SpaceX publishes its position.
    booster: null,
    // The Starlink batch the ship deployed (toggle).
    starlink: null,
  }
  let showStarlink = false

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
    // Cut the path at the antimeridian so every piece lies in [-180, 180]:
    // a multi-orbit ground track then draws every orbit in the visible
    // world (one continuous unwrapped line spans many worlds, and only the
    // few copies around the view were drawn, dropping earlier orbits).
    const pieces = splitAtAntimeridian(points)
    for (const piece of pieces) {
      if (piece.length < 2) continue
      for (const offset of activeWraps) {
        bucket.push(
          L.polyline(shiftLatLngs(piece, offset), {
            ...style,
            renderer: vectorRenderer,
          }).addTo(map),
        )
      }
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
    clearLayerList(map, layers.planned)
    if (source.planned) {
      addPolylineCopies(
        source.planned,
        { color: '#ff5a1f', weight: 2, opacity: 0.8, dashArray: '6 6' },
        layers.planned,
      )
    }
  }

  /*
   * Every active Starlink satellite as small dots (no trails), drawn on one
   * canvas in its own pane under the ship's line and markers. Positioned the
   * way Leaflet's own canvas renderer is: reset on move/zoom end, hidden
   * during zoom animation, so panning stays smooth with ~10,000 dots.
   */
  const allPane = map.createPane('allStarlinks')
  allPane.style.zIndex = '350'
  allPane.style.pointerEvents = 'none'
  const allCanvas = L.DomUtil.create('canvas', 'all-starlinks-canvas', allPane)
  let allDots = null
  let showAll = false
  let allTimer = null

  function drawAllStarlinks() {
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    L.DomUtil.setPosition(allCanvas, map.containerPointToLayerPoint([0, 0]))
    allCanvas.width = Math.round(size.x * dpr)
    allCanvas.height = Math.round(size.y * dpr)
    allCanvas.style.width = `${size.x}px`
    allCanvas.style.height = `${size.y}px`
    const ctx = allCanvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    if (!showAll || !allDots || !allDots.length) return
    const dark = document.documentElement.dataset.theme === 'dark'
    ctx.fillStyle = dark ? 'rgba(147, 197, 253, 0.75)' : 'rgba(37, 99, 235, 0.6)'
    const b = map.getBounds()
    const west = b.getWest() - 2
    const east = b.getEast() + 2
    const south = b.getSouth() - 2
    const north = b.getNorth() + 2
    const r = map.getZoom() >= 5 ? 1.6 : 1.1
    for (let i = 0; i < allDots.length; i += 2) {
      const lat = allDots[i]
      if (lat < south || lat > north) continue
      const lon = allDots[i + 1]
      for (const offset of activeWraps) {
        const x = lon + offset
        if (x < west || x > east) continue
        const p = map.latLngToContainerPoint([lat, x])
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2)
      }
    }
  }
  map.on('zoomstart', () => {
    allCanvas.style.visibility = 'hidden'
  })
  map.on('moveend zoomend resize viewreset', () => {
    allCanvas.style.visibility = ''
    if (showAll) drawAllStarlinks()
  })

  async function toggleAllStarlinks(btn) {
    showAll = !showAll
    btn.classList.toggle('active', showAll)
    btn.setAttribute('aria-pressed', String(showAll))
    clearInterval(allTimer)
    if (!showAll) {
      drawAllStarlinks()
      btn.textContent = 'All Starlinks'
      return
    }
    btn.textContent = 'Loading…'
    try {
      const count = await loadAllStarlinks()
      if (!showAll) return
      btn.textContent = `All Starlinks · ${count.toLocaleString('en-US')}`
      const refresh = () => {
        allDots = allStarlinkPositions(Date.now())
        drawAllStarlinks()
      }
      refresh()
      allTimer = setInterval(refresh, 5000)
    } catch {
      showAll = false
      btn.classList.remove('active')
      btn.setAttribute('aria-pressed', 'false')
      btn.textContent = 'All Starlinks (unavailable)'
      setTimeout(() => {
        btn.textContent = 'All Starlinks'
      }, 4000)
    }
  }

  function rebuildStarlink() {
    clearLayerList(map, layers.starlink)
    if (!showStarlink || !source.starlink) return
    // Trail behind the batch that fades out the further back it goes: one
    // short segment per step, opacity rising toward the marker.
    const trail = source.starlink.trail
    if (Array.isArray(trail) && trail.length >= 2) {
      let pts = unwrapRing(trail)
      const anchor = Math.round(pts[pts.length - 1][1] / 360) * 360
      if (anchor !== 0) pts = shiftLatLngs(pts, -anchor)
      const n = pts.length - 1
      for (const offset of activeWraps) {
        for (let i = 0; i < n; i++) {
          const opacity = 0.05 + 0.85 * ((i + 1) / n) ** 1.5
          layers.starlink.push(
            L.polyline(shiftLatLngs([pts[i], pts[i + 1]], offset), {
              color: '#3b82f6',
              weight: 3,
              opacity,
              lineCap: 'round',
              interactive: false,
              renderer: vectorRenderer,
            }).addTo(map),
          )
        }
      }
    }
    for (const offset of activeWraps) {
      layers.starlink.push(
        L.circleMarker(shiftLatLng(source.starlink.latlng, offset), {
          radius: 6,
          color: '#1d4ed8',
          fillColor: '#60a5fa',
          fillOpacity: 0.95,
          weight: 2,
          renderer: vectorRenderer,
        })
          .bindPopup(source.starlink.popup)
          .bindTooltip(source.starlink.label, {
            permanent: true,
            direction: 'right',
            offset: [8, 0],
            className: 'starlink-label',
          })
          .addTo(map),
      )
    }
  }

  function rebuildBooster() {
    clearLayerList(map, layers.booster)
    if (!source.booster) return
    for (const offset of activeWraps) {
      layers.booster.push(
        L.circleMarker(shiftLatLng(source.booster.latlng, offset), {
          radius: 7,
          color: '#12141a',
          fillColor: '#f2f1ec',
          fillOpacity: 0.95,
          weight: 2,
          renderer: vectorRenderer,
        })
          .bindPopup(source.booster.popup)
          .addTo(map),
      )
    }
  }

  function rebuildShip() {
    rebuildBooster()
    rebuildStarlink()
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
      (getNoticePolygons().length
        ? '<button type="button" data-hazards="toggle" aria-pressed="false">Hazards</button>'
        : '') +
      '<button type="button" data-starlink="toggle" aria-pressed="false" hidden title="Show the Starlink satellites the ship deployed">Starlinks</button>' +
      '<button type="button" data-all-starlinks="toggle" aria-pressed="false" title="Show every active Starlink satellite (Celestrak)">All Starlinks</button>'
    shell.append(cameraEl)
    cameraEl.addEventListener('click', (e) => {
      const allBtn = e.target.closest('button[data-all-starlinks]')
      if (allBtn) {
        void toggleAllStarlinks(allBtn)
        return
      }
      const starlinkBtn = e.target.closest('button[data-starlink]')
      if (starlinkBtn) {
        showStarlink = !showStarlink
        starlinkBtn.classList.toggle('active', showStarlink)
        starlinkBtn.setAttribute('aria-pressed', String(showStarlink))
        rebuildStarlink()
        return
      }
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
      viewerChoseCamera = true
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

  /** The ship's position on the world copy nearest the current view. */
  function nearestCopy(latlng) {
    const centerLng = map.getCenter().lng
    const shift = Math.round((centerLng - latlng[1]) / 360) * 360
    return [latlng[0], latlng[1] + shift]
  }

  function applyCamera(force = false) {
    if (camera === 'free') return

    if (camera === 'follow') {
      if (!latestLive) return
      const target = nearestCopy(latestLive)
      if (!force && fittedCamera === 'follow') {
        // Keep the viewer's zoom; just keep the ship centred.
        map.panTo(target, { animate: true, duration: 0.45, noMoveStart: true })
        return
      }
      fittedCamera = 'follow'
      // Orbit needs a much wider view than ascent or landing.
      const zoom =
        Number.isFinite(latestAltitude) && latestAltitude > 100_000 ? ORBIT_FOLLOW_ZOOM : FOLLOW_ZOOM
      map.setView(target, zoom, { animate: !force, duration: 0.5 })
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

  // Only a drag means the viewer wants to look elsewhere. Zooming (buttons,
  // wheel, pinch) keeps following. Programmatic moves never fire dragstart.
  map.on('dragstart', () => {
    if (camera === 'free') return
    viewerChoseCamera = true
    camera = 'free'
    fittedCamera = null
    syncCameraButtons()
  })

  map.on('moveend zoomend', () => {
    rebuildAllWraps(false)
  })

  return {
    update({ ship, liveTrail = [], plannedPath = null, booster = null, starlink = null }) {
      const shipName = meta.vehicle || 'Starship'
      const apart = Number.isFinite(starlink?.distanceKm)
        ? `≈ ${Math.round(starlink.distanceKm).toLocaleString('en-US')} km from ${shipName}`
        : null
      source.starlink = starlink
        ? {
            latlng: [starlink.latitude, starlink.longitude],
            trail: starlink.trail,
            label: apart ? `Starlinks · ${apart}` : 'Starlinks',
            popup: `<strong>${starlink.name}</strong><br>${formatLatLon(
              starlink.latitude,
              starlink.longitude,
            )}<br>${Math.round(starlink.altitude / 1000)} km · ${Math.round(
              starlink.speed * 3.6,
            ).toLocaleString('en-US')} km/h${apart ? `<br>${apart}` : ''}<br>From SpaceX's published orbit`,
          }
        : null
      const starlinkBtn = cameraEl?.querySelector('button[data-starlink]')
      if (starlinkBtn) starlinkBtn.hidden = !starlink
      source.planned = plannedPath && plannedPath.length >= 2 ? plannedPath : null
      source.booster = booster?.current
        ? {
            latlng: [booster.current.latitude, booster.current.longitude],
            popup: `<strong>${booster.label}</strong><br>${formatLatLon(
              booster.current.latitude,
              booster.current.longitude,
            )}<br>Live from SpaceX`,
          }
        : null
      if (!ship?.current) {
        rebuildPaths()
        rebuildShip()
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

      // Keep the planned splashdown marker while the ship is still on the pad.
      if (stillOnPad && meta.landingFix) {
        source.plannedLanding = {
          latlng: [meta.landingFix.lat, meta.landingFix.lon],
          popup: `<strong>${landingTitle(meta, true)}</strong><br>${meta.landingFix.label}<br>${formatLatLon(
            meta.landingFix.lat,
            meta.landingFix.lon,
          )}`,
        }
      } else {
        source.plannedLanding = null
      }

      latestAltitude = current.altitude
      if (!viewerChoseCamera && camera !== 'follow' && !landed && !stillOnPad) {
        camera = 'follow'
        fittedCamera = null
        syncCameraButtons()
      }

      // Only the fixes already recorded. SpaceX `trajectory` is the predicted path ahead.
      const flown = []
      for (const p of liveTrail) {
        if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
          flown.push([p.latitude, p.longitude])
        }
      }
      const tip = flown[flown.length - 1]
      if (!tip || tip[0] !== live[0] || tip[1] !== live[1]) flown.push(live)
      latestFullPath = flown

      source.ascent = null
      source.reentry = null
      source.live = flown.length >= 2 ? thinLatLonPath(flown) : null
      source.liveStyle = source.live
        ? { color: '#ff5a1f', weight: 3, opacity: 0.95 }
        : null

      if (landed && meta.landingFix && !stillOnPad) {
        source.landing = {
          latlng: [meta.landingFix.lat, meta.landingFix.lon],
          popup: `<strong>${landingTitle(meta, false)}</strong><br>${formatLatLon(
            meta.landingFix.lat,
            meta.landingFix.lon,
          )}`,
        }
      } else {
        source.landing = null
      }

      const shipLabel = meta.vehicle || 'Starship'
      source.ship = {
        latlng: live,
        radius: 9,
        halo: 18,
        popup: `<strong>${shipLabel}</strong><br>${formatLatLon(live[0], live[1])}<br>${
          current.estimated ? 'Estimated from published orbit' : 'Live from SpaceX'
        }`,
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

function landingTitle(meta, planned) {
  const word = meta.landingFix?.kind === 'catch' ? 'catch' : 'splashdown'
  return planned ? `Planned ${word}` : word[0].toUpperCase() + word.slice(1)
}
