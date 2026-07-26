import {
  buildFlightPath,
  getMeta,
  splitPathByDistanceGap,
} from './path.js'
import { thinLatLonPath } from './trail.js'
import { formatLatLon, haversineKm, isNearSurface } from './utils.js'

const MAX_BRIDGE_KM = 1

export function createMap(container) {
  const meta = getMeta()
  const paths = buildFlightPath()
  let mode = 'drift'
  let fittedMode = null
  let layers = {
    ascent: null,
    reentry: null,
    drift: [],
    live: null,
    ship: null,
    shipHalo: null,
    launch: null,
    landing: null,
  }

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: true,
    maxZoom: 18,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    scrollWheelZoom: true,
  }).setView([meta.landingFix.lat, meta.landingFix.lon], 9)

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
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

  layers.ascent = L.polyline(paths.ascent, {
    color: '#ff5a1f',
    weight: 3,
    opacity: 0.95,
  }).addTo(map)
  layers.reentry = L.polyline(paths.reentry, {
    color: '#e64613',
    weight: 3,
    opacity: 0.95,
  }).addTo(map)

  const shell = container.closest('.map-shell') || container.parentElement
  let toggleEl = shell?.querySelector('.map-view-toggle')
  if (!toggleEl && shell) {
    toggleEl = document.createElement('div')
    toggleEl.className = 'map-view-toggle'
    toggleEl.setAttribute('role', 'group')
    toggleEl.setAttribute('aria-label', 'Map view')
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
      // force re-fit on next update
      fittedMode = null
    })
  }

  function fit(view, driftPoints, fullPath, live) {
    if (fittedMode === view) return
    fittedMode = view
    if (view === 'drift') {
      const bounds = L.latLngBounds(
        driftPoints.length
          ? driftPoints
          : [[meta.landingFix.lat, meta.landingFix.lon]],
      )
      bounds.extend(live)
      map.fitBounds(bounds.pad(0.35), { animate: false })
      return
    }
    if (fullPath.length >= 2) {
      const bounds = L.latLngBounds(fullPath)
      bounds.extend(live)
      map.fitBounds(bounds.pad(0.08), { animate: false })
    }
  }

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
      const current = ship.current
      const live = [current.latitude, current.longitude]
      const landed = isNearSurface(current.altitude)
      const view = landed ? mode : 'flight'

      if (toggleEl) toggleEl.hidden = !landed

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

      const livePath = liveTrail.map((p) => [p.latitude, p.longitude])
      const driftFrame = [[meta.landingFix.lat, meta.landingFix.lon]]
      for (const seg of oceanDriftCleanSegments) for (const p of seg) driftFrame.push(p)
      for (const p of livePath) driftFrame.push(p)
      driftFrame.push(live)

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

      // live tip trail
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

      layers.ascent.setStyle({ opacity: view === 'flight' ? 0.95 : 0.55 })
      layers.reentry.setStyle({ opacity: view === 'flight' ? 0.95 : 0.55 })

      if (landed) {
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
            `<strong>Ship 40</strong><br>${formatLatLon(live[0], live[1])}`,
          )
          .addTo(map)
      } else {
        layers.ship.setLatLng(live)
        layers.ship.setRadius(radius)
        layers.ship.setPopupContent(
          `<strong>Ship 40</strong><br>${formatLatLon(live[0], live[1])}`,
        )
        layers.shipHalo.setLatLng(live)
        layers.shipHalo.setRadius(halo)
      }

      fit(view, driftFrame, fullPath, live)
      map.invalidateSize()
    },
  }
}
