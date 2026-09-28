import { createMap } from './map.js'
import { getMeta, loadTrack } from './path.js'
import { startTracker } from './tracker.js'
import {
  SPACEX_VEHICLE_TRACKER,
  describeLocation,
  formatAltitudeKm,
  formatDownrange,
  formatLatLon,
  haversineKm,
  formatSignedMissionClock,
  formatSpeedKmh,
  formatUpdateAge,
  gpsTimeToDate,
} from './utils.js'

const THEME_KEY = 'bsz-theme'
const SPACEX_WEBCAST =
  'https://www.spacex.com/launches/starship-flight-14'
/** Space.com simulcast of the SpaceX Flight 14 webcast. Official player cannot be embedded. */
const LIVESTREAM_EMBED =
  'https://www.youtube-nocookie.com/embed/CxHNK4UeVP4?rel=0&modestbranding=1'
/** Clear of the pad + climbing — SpaceX often ticks mission_time on the pad. */
const LIFTOFF_ALT_M = 1500
const LIFTOFF_SPEED_MS = 80
const PAD_RADIUS_DEG = 0.08

function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
  const btn = document.querySelector('.theme-toggle')
  if (btn) {
    btn.textContent = theme === 'dark' ? 'Light' : 'Dark'
    btn.setAttribute('aria-pressed', String(theme === 'dark'))
    btn.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    )
  }
}

function renderShell(root) {
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="powered-by" href="https://www.beyondstagezero.com/">
            <span class="brand-mark" aria-hidden="true"></span>
            Powered by Beyond Stage Zero
          </a>
          <div class="topbar-metrics">
            <p class="mission-clock" data-phase="prelaunch" aria-live="polite">T- —</p>
            <div class="topbar-metric">
              <span class="topbar-metric-label">Altitude</span>
              <span class="topbar-metric-value" data-live="altitude">— <span>km</span></span>
            </div>
            <div class="topbar-metric">
              <span class="topbar-metric-label">Speed</span>
              <span class="topbar-metric-value" data-live="speed">— <span>km/h</span></span>
            </div>
            <p class="status-line" data-state="loading">Updated —</p>
          </div>
        </div>
      </header>
      <header class="masthead">
        <div class="masthead-inner">
          <div class="masthead-brand-block">
            <h1 class="masthead-title">
              Live Starship Tracking
              <span class="masthead-title-meta">Flight 14</span>
            </h1>
            <p class="masthead-sub">
              Live location from SpaceX's public vehicle tracker.
            </p>
          </div>
          <div class="masthead-actions">
            <button type="button" class="watch-toggle" aria-expanded="false" aria-controls="livestream">
              Watch
            </button>
            <button type="button" class="theme-toggle">Dark</button>
            <a class="masthead-link" href="${SPACEX_VEHICLE_TRACKER}" target="_blank" rel="noreferrer">
              SpaceX tracker
            </a>
          </div>
        </div>
      </header>

      <section class="livestream" id="livestream" aria-label="Flight 14 livestream" hidden>
        <div class="livestream-inner">
          <div class="livestream-head">
            <div>
              <h2>Livestream</h2>
              <p>
                Space.com simulcast of the SpaceX webcast.
                <a href="${SPACEX_WEBCAST}" target="_blank" rel="noreferrer">Watch on SpaceX</a>
              </p>
            </div>
            <button type="button" class="livestream-close">Close</button>
          </div>
          <div class="livestream-frame">
            <iframe
              title="Starship Flight 14 livestream"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
            ></iframe>
          </div>
        </div>
      </section>

      <section class="map-section" aria-label="Starship Flight 14 map">
        <div class="map-skeleton"><p>Acquiring telemetry…</p></div>
      </section>

      <section class="section telemetry" aria-label="Starship telemetry" hidden>
        <div class="section-inner">
          <div class="telemetry-head">
            <div>
              <h2>Last known fix</h2>
              <p class="telemetry-place"></p>
            </div>
          </div>
          <dl class="telemetry-grid"></dl>
        </div>
      </section>

      <footer class="footer">
        <div class="footer-inner">
          <a class="brand" href="https://www.beyondstagezero.com/">
            <span class="brand-mark" aria-hidden="true"></span>
            <span class="brand-name">Beyond Stage Zero</span>
          </a>
          <p>Unofficial tracker · SpaceX public telemetry</p>
        </div>
      </footer>
    </div>
  `

  document.querySelector('.theme-toggle').addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  })
  setTheme(getTheme())

  const watchBtn = document.querySelector('.watch-toggle')
  const livestream = document.querySelector('.livestream')
  const livestreamFrame = livestream.querySelector('iframe')
  const setLivestreamOpen = (open) => {
    livestream.hidden = !open
    watchBtn.setAttribute('aria-expanded', String(open))
    watchBtn.classList.toggle('active', open)
    if (open && !livestreamFrame.src) {
      livestreamFrame.src = LIVESTREAM_EMBED
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }
  watchBtn.addEventListener('click', () => {
    setLivestreamOpen(livestream.hidden)
  })
  livestream.querySelector('.livestream-close').addEventListener('click', () => {
    setLivestreamOpen(false)
  })

  const topbar = document.querySelector('.topbar')
  const syncTopbar = () => {
    document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)
  }
  syncTopbar()
  window.addEventListener('resize', syncTopbar)
}

function liveMissionTime(state, nowMs) {
  const current = state.ship?.current
  if (!current) return null
  const meta = getMeta()
  if (state.positionSource === 'space-notices') {
    if (
      typeof meta.splashdownGpsTime !== 'number' ||
      typeof meta.splashdownMissionTime !== 'number'
    ) {
      return current.mission_time
    }
    const splashMs = gpsTimeToDate(meta.splashdownGpsTime).getTime()
    return meta.splashdownMissionTime + Math.max(0, (nowMs - splashMs) / 1000)
  }
  if (!state.fetchedAt) return current.mission_time
  const elapsedS = Math.max(0, (nowMs - state.fetchedAt.getTime()) / 1000)
  return current.mission_time + elapsedS
}

function isNearPad(lat, lon) {
  const pad = getMeta().launchPad
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat - pad.lat) < PAD_RADIUS_DEG &&
    Math.abs(lon - pad.lon) < PAD_RADIUS_DEG
  )
}

/**
 * True only once the vehicle has clearly left the pad. Pad telemetry often
 * publishes a ticking mission_time / low altitude before Flight 14 liftoff.
 */
function hasLiftoff(state) {
  if (!state?.ship?.current) return false
  const { altitude, speed, latitude, longitude } = state.ship.current
  const onPad = isNearPad(latitude, longitude)
  if (onPad && !(Number.isFinite(altitude) && altitude > LIFTOFF_ALT_M)) {
    return false
  }
  if (Number.isFinite(altitude) && altitude > LIFTOFF_ALT_M) return true
  if (Number.isFinite(speed) && speed > LIFTOFF_SPEED_MS) return true
  return false
}

/**
 * Seconds from liftoff: negative before launch (T-), positive after (T+).
 */
function missionOffsetSeconds(state, nowMs) {
  if (hasLiftoff(state)) {
    const mission = liveMissionTime(state, nowMs)
    return Math.max(0, mission ?? 0)
  }
  const planned = getMeta().plannedLiftoffMs
  if (typeof planned !== 'number') return null
  // Hold at T- 0:00:00 once past the window open without confirmed liftoff.
  return Math.min(0, (nowMs - planned) / 1000)
}

function renderMissionClock(state, nowMs) {
  const el = document.querySelector('.mission-clock')
  if (!el) return
  const offset = missionOffsetSeconds(state, nowMs)
  const launched = hasLiftoff(state)
  el.textContent = formatSignedMissionClock(offset ?? 0)
  el.dataset.phase = launched ? 'flight' : 'prelaunch'
  el.setAttribute(
    'aria-label',
    launched ? 'Mission elapsed time' : 'Countdown to planned liftoff',
  )
}

function renderLiveReadouts(state) {
  const altEl = document.querySelector('[data-live="altitude"]')
  const spdEl = document.querySelector('[data-live="speed"]')
  if (!altEl || !spdEl) return
  const current = state?.ship?.current
  if (!current) {
    altEl.innerHTML = '— <span>km</span>'
    spdEl.innerHTML = '— <span>km/h</span>'
    return
  }
  altEl.innerHTML = `${formatAltitudeKm(current.altitude)} <span>km</span>`
  spdEl.innerHTML = `${formatSpeedKmh(current.speed)} <span>km/h</span>`
}

function renderTelemetry(state) {
  const section = document.querySelector('.telemetry')
  const current = state.ship?.current
  if (!current) {
    section.hidden = true
    return
  }
  section.hidden = false
  const place = describeLocation(
    current.latitude,
    current.longitude,
    current.altitude,
  )
  document.querySelector('.telemetry-place').textContent = place

  const pad = getMeta().launchPad
  const downrange = formatDownrange(
    haversineKm(pad.lat, pad.lon, current.latitude, current.longitude),
  )

  const grid = document.querySelector('.telemetry-grid')
  grid.innerHTML = `
    <div><dt>Coordinates</dt><dd>${formatLatLon(current.latitude, current.longitude)}</dd></div>
    <div><dt>Downrange</dt><dd>${downrange} <span>from pad</span></dd></div>
  `
}

function renderStatus(state, nowMs) {
  const el = document.querySelector('.status-line')
  let label = 'Updated —'
  let dataState = 'loading'
  const updatedAt = state.fetchedAt || state.lastMovedAt
  if (state.error) {
    label = 'Offline'
    dataState = 'error'
  } else if (!state.loading && updatedAt) {
    label = `Updated ${formatUpdateAge(
      Math.max(0, Math.floor((nowMs - updatedAt.getTime()) / 1000)),
    )}`
    dataState = 'live'
  } else if (!state.loading && !state.ship?.current) {
    label = 'Updated —'
    dataState = 'waiting'
  }
  el.textContent = label
  el.dataset.state = dataState
}

function ensureMap(mapApi, prelaunch) {
  const mapSection = document.querySelector('.map-section')
  const needsCreate =
    !mapApi ||
    (mapApi.prelaunch && !prelaunch) ||
    !document.getElementById('track-map')
  if (!needsCreate) return mapApi
  mapSection.innerHTML =
    '<div class="map-shell"><div id="track-map" class="track-map"></div></div>'
  const next = createMap(document.getElementById('track-map'), { prelaunch })
  next.prelaunch = prelaunch
  return next
}

async function main() {
  const root = document.getElementById('app')
  renderShell(root)

  try {
    await loadTrack()
  } catch (err) {
    document.querySelector('.map-skeleton').innerHTML =
      `<p>${err instanceof Error ? err.message : 'Failed to load path'}</p>`
    return
  }

  const meta = getMeta()
  let mapApi = ensureMap(null, !meta.hasFlightPath)
  let latest = { ship: null, loading: true, error: null, lastMovedAt: null }

  const tick = (state) => {
    const nowMs = Date.now()
    renderMissionClock(state, nowMs)
    renderLiveReadouts(state)
    renderStatus(state, nowMs)
    renderTelemetry(state)
  }

  tick(latest)

  const stop = startTracker((state) => {
    latest = state
    tick(state)

    if (!state.ship?.current) {
      mapApi = ensureMap(mapApi, !meta.hasFlightPath)
      mapApi.update({
        ship: null,
        liveTrail: state.liveTrail,
        spaceNoticesExtension: state.spaceNoticesExtension,
      })
      return
    }

    mapApi = ensureMap(mapApi, false)
    mapApi.update({
      ship: state.ship,
      liveTrail: state.liveTrail,
      spaceNoticesExtension: state.spaceNoticesExtension,
    })
  })

  setInterval(() => {
    if (!latest) return
    tick(latest)
  }, 250)

  window.addEventListener('beforeunload', stop)
}

main()
