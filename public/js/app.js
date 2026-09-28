import { drawTelemetryCharts, recordTelemetrySample } from './charts.js'
import { distanceAlongTrailKm, loadLiveTrail } from './trail.js'
import { createMap } from './map.js'
import { getMeta, loadTrack, setActualLiftoffMs, setPlannedLiftoffMs } from './path.js'
import { startTracker } from './tracker.js'
import {
  GPS_TO_UNIX_OFFSET,
  SPACEX_VEHICLE_TRACKER,
  describeLocation,
  formatAltitudeKm,
  formatDownrange,
  formatLatLon,
  haversineKm,
  formatSignedMissionClock,
  formatSpeedKmh,
  formatUpdateAge,
} from './utils.js'

const THEME_KEY = 'bsz-theme'
const SPACEX_WEBCAST =
  'https://www.spacex.com/launches/starship-flight-14'
/** Space.com simulcast of the SpaceX Flight 14 webcast. Official player cannot be embedded. */
const LIVESTREAM_EMBED =
  'https://www.youtube-nocookie.com/embed/CxHNK4UeVP4?rel=0&modestbranding=1'
const LIVESTREAM_KEY = 'bsz-livestream-urls'
/**
 * Movement off the pad, not the planned clock. SpaceX mission_time already
 * ticks while Ship 41 is sitting at Starbase, so T+ starts only after we
 * see the ship leave.
 */
const MOVE_ALT_M = 200
const MOVE_SPEED_MS = 10
const MOVE_RANGE_KM = 0.15
const LIFTOFF_AT_KEY = 'bsz-flight14-liftoff-ms'
const LANDED_ELAPSED_KEY = 'bsz-flight14-landed-elapsed-s'
const ALTITUDE_ZERO_KEY = 'bsz-flight14-altitude-zero-s'
let chartsPainted = false
let liftoffAtMs = readLiftoffAt()
let liftoffConfirmed = liftoffAtMs != null
let sawOnPad = false
let moveStreak = 0
let firstMoveAtMs = null
let lastSampleKey = null
let samplesSeen = 0
let seenFlying = false
let landedElapsedSeconds = readLandedElapsed()
let altitudeZeroElapsedSeconds = readAltitudeZero()
let clockStopped = false

function readAltitudeZero() {
  try {
    const n = Number(localStorage.getItem(ALTITUDE_ZERO_KEY))
    return Number.isFinite(n) && n > 30 ? n : null
  } catch {
    return null
  }
}

function rememberAltitudeZero(seconds) {
  if (!(seconds > 30) || seconds > 20 * 3600) return
  if (
    altitudeZeroElapsedSeconds != null &&
    seconds >= altitudeZeroElapsedSeconds - 0.5
  ) {
    return
  }
  altitudeZeroElapsedSeconds = seconds
  try {
    localStorage.setItem(ALTITUDE_ZERO_KEY, String(seconds))
  } catch {
    /* ignore */
  }
}

function readLandedElapsed() {
  try {
    const n = Number(localStorage.getItem(LANDED_ELAPSED_KEY))
    return Number.isFinite(n) && n > 30 ? n : null
  } catch {
    return null
  }
}

function rememberLandedElapsed(seconds, fromTrail) {
  if (!(seconds > 30) || seconds > 20 * 3600) return
  if (fromTrail) {
    if (
      landedElapsedSeconds != null &&
      seconds >= landedElapsedSeconds - 0.5
    ) {
      return
    }
    landedElapsedSeconds = seconds
    try {
      localStorage.setItem(LANDED_ELAPSED_KEY, String(seconds))
    } catch {
      /* ignore */
    }
    return
  }
  if (landedElapsedSeconds != null) return
  landedElapsedSeconds = seconds
}

function readLiftoffAt() {
  try {
    const n = Number(sessionStorage.getItem(LIFTOFF_AT_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

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
            <div class="topbar-metric since-landing" hidden>
              <span class="topbar-metric-label">Since landing</span>
              <span class="topbar-metric-value" data-live="since-landing">0:00:00</span>
            </div>
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

      <section class="livestream" id="livestream" aria-label="Livestreams" hidden>
        <div class="livestream-inner">
          <div class="livestream-head">
            <div>
              <h2>Livestreams</h2>
              <p>
                Two players side by side. Paste a YouTube or Twitch link in either, or start with the
                <a href="${SPACEX_WEBCAST}" target="_blank" rel="noreferrer">SpaceX webcast</a>
                simulcast.
              </p>
            </div>
            <button type="button" class="livestream-close">Close</button>
          </div>
          <div class="livestream-grid">
            ${[0, 1]
              .map(
                (slot) => `
            <div class="livestream-slot" data-slot="${slot}">
              <form class="livestream-form">
                <label class="visually-hidden" for="livestream-url-${slot}">Stream ${slot + 1} link</label>
                <input
                  id="livestream-url-${slot}"
                  type="url"
                  inputmode="url"
                  placeholder="Paste a YouTube or Twitch link"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button type="submit">Play</button>
                ${
                  slot === 0
                    ? '<button type="button" class="livestream-reset">Flight 14</button>'
                    : '<button type="button" class="livestream-clear">Clear</button>'
                }
              </form>
              <p class="livestream-note" hidden></p>
              <div class="livestream-frame">
                <iframe
                  title="Livestream ${slot + 1}"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                  referrerpolicy="strict-origin-when-cross-origin"
                ></iframe>
              </div>
            </div>`,
              )
              .join('')}
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
          <div class="telemetry-charts">
            <figure class="telem-chart">
              <figcaption>Altitude</figcaption>
              <canvas data-chart="altitude" aria-label="Altitude over time"></canvas>
            </figure>
            <figure class="telem-chart">
              <figcaption>Speed <span>km/h</span></figcaption>
              <canvas data-chart="speed" aria-label="Speed over time"></canvas>
            </figure>
          </div>
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
    drawTelemetryCharts()
  })
  setTheme(getTheme())

  const watchBtn = document.querySelector('.watch-toggle')
  const livestream = document.querySelector('.livestream')
  const slots = [...livestream.querySelectorAll('.livestream-slot')]

  const savedStreams = loadSavedStreams()
  slots.forEach((slot, index) => {
    const input = slot.querySelector('input')
    if (savedStreams[index]) input.value = savedStreams[index]
  })

  const rememberStreams = () => {
    const urls = slots.map((slot) => slot.querySelector('input').value.trim())
    try {
      localStorage.setItem(LIVESTREAM_KEY, JSON.stringify(urls))
    } catch {
      /* ignore */
    }
  }

  const showSlotNote = (slot, message) => {
    const note = slot.querySelector('.livestream-note')
    if (!message) {
      note.hidden = true
      note.textContent = ''
      return
    }
    note.hidden = false
    note.textContent = message
  }

  const playSlot = (slot, embed) => {
    slot.querySelector('iframe').src = embed || 'about:blank'
    showSlotNote(slot, '')
  }

  const startSlots = () => {
    slots.forEach((slot, index) => {
      const frame = slot.querySelector('iframe')
      const assigned = frame.getAttribute('src')
      if (assigned && assigned !== 'about:blank') return
      const raw = slot.querySelector('input').value.trim()
      const custom = embedFromLivestreamUrl(raw)
      if (custom) {
        playSlot(slot, custom)
        return
      }
      if (raw) {
        showSlotNote(slot, 'That link can’t be embedded. Use a YouTube or Twitch URL.')
        return
      }
      if (index === 0) playSlot(slot, LIVESTREAM_EMBED)
    })
  }

  const setLivestreamOpen = (open) => {
    livestream.hidden = !open
    watchBtn.setAttribute('aria-expanded', String(open))
    watchBtn.classList.toggle('active', open)
    if (open) startSlots()
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }
  watchBtn.addEventListener('click', () => {
    setLivestreamOpen(livestream.hidden)
  })
  livestream.querySelector('.livestream-close').addEventListener('click', () => {
    setLivestreamOpen(false)
  })
  slots.forEach((slot) => {
    slot.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      const raw = slot.querySelector('input').value.trim()
      const embed = embedFromLivestreamUrl(raw)
      if (!embed) {
        showSlotNote(slot, 'That link can’t be embedded. Use a YouTube or Twitch URL.')
        return
      }
      playSlot(slot, embed)
      rememberStreams()
    })
    slot.querySelector('.livestream-reset')?.addEventListener('click', () => {
      slot.querySelector('input').value = ''
      playSlot(slot, LIVESTREAM_EMBED)
      rememberStreams()
    })
    slot.querySelector('.livestream-clear')?.addEventListener('click', () => {
      slot.querySelector('input').value = ''
      playSlot(slot, '')
      rememberStreams()
    })
  })

  const topbar = document.querySelector('.topbar')
  const syncTopbar = () => {
    document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)
  }
  syncTopbar()
  window.addEventListener('resize', () => {
    syncTopbar()
    drawTelemetryCharts()
  })
}

function loadSavedStreams() {
  try {
    const raw = localStorage.getItem(LIVESTREAM_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return [parsed[0] || '', parsed[1] || '']
    }
    const legacy = localStorage.getItem('bsz-livestream-url')
    return legacy ? [legacy, ''] : ['', '']
  } catch {
    return ['', '']
  }
}

function youtubeEmbed(id) {
  if (!/^[\w-]{6,}$/.test(id)) return null
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1`
}

/** Turn a pasted YouTube or Twitch link into an embeddable player URL. */
function embedFromLivestreamUrl(raw) {
  if (!raw || !raw.trim()) return null
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '')

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id ? youtubeEmbed(id) : null
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return youtubeEmbed(url.searchParams.get('v') || '')
    const match = url.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/)
    if (match) return youtubeEmbed(match[1])
    return null
  }
  if (host === 'twitch.tv' || host === 'player.twitch.tv') {
    const parent = encodeURIComponent(window.location.hostname)
    const channelParam = url.searchParams.get('channel')
    if (channelParam) {
      return `https://player.twitch.tv/?channel=${encodeURIComponent(channelParam)}&parent=${parent}`
    }
    const videoParam = url.searchParams.get('video')
    if (videoParam) {
      return `https://player.twitch.tv/?video=${encodeURIComponent(videoParam)}&parent=${parent}`
    }
    const video = url.pathname.match(/^\/videos\/(\d+)/)
    if (video) return `https://player.twitch.tv/?video=${video[1]}&parent=${parent}`
    const channel = url.pathname.split('/').filter(Boolean)[0]
    if (
      channel &&
      !['directory', 'downloads', 'settings', 'subscriptions', 'wallet'].includes(channel)
    ) {
      return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}`
    }
  }
  return null
}

function sampleKey(state) {
  const current = state?.ship?.current
  if (!current) return null
  return [current.gps_time, current.altitude, current.speed, current.latitude, current.longitude].join('|')
}

/** True once the live fix is no longer pad GPS noise. */
function startedToMove(state) {
  const current = state?.ship?.current
  if (!current) return false
  const { altitude, speed, latitude, longitude } = current
  if (Number.isFinite(speed) && speed >= MOVE_SPEED_MS) return true
  if (
    Number.isFinite(altitude) &&
    altitude >= MOVE_ALT_M &&
    altitude < 600_000
  ) {
    return true
  }
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const pad = getMeta().launchPad
    if (haversineKm(pad.lat, pad.lon, latitude, longitude) >= MOVE_RANGE_KM) {
      return true
    }
  }
  return false
}

function clearStoredLiftoff() {
  liftoffAtMs = null
  liftoffConfirmed = false
  try {
    sessionStorage.removeItem(LIFTOFF_AT_KEY)
  } catch {
    /* ignore */
  }
}

function confirmLiftoff(atMs) {
  liftoffAtMs = atMs
  liftoffConfirmed = true
  try {
    sessionStorage.setItem(LIFTOFF_AT_KEY, String(atMs))
  } catch {
    /* ignore */
  }
}

/**
 * Liftoff implied by SpaceX mission_time. On the pad that field has already
 * been ticking for hours, so it only counts once the ship is clearly flying
 * and the result sits near the planned T-0.
 */
function officialLiftoffMs(state) {
  if (!clearlyAirborne(state)) return null
  const current = state.ship.current
  const mission = current.mission_time
  const gps = current.gps_time
  if (!Number.isFinite(mission) || !Number.isFinite(gps)) return null
  if (mission < 1 || mission > 20 * 3600) return null
  const fixMs = (gps + GPS_TO_UNIX_OFFSET) * 1000
  const liftoff = fixMs - mission * 1000
  if (liftoff > fixMs || fixMs - liftoff > 20 * 3600 * 1000) return null
  const planned = getMeta().plannedLiftoffMs
  if (typeof planned === 'number' && Math.abs(liftoff - planned) > 30 * 60 * 1000) {
    return null
  }
  return liftoff
}

function clearlyAirborne(state) {
  const current = state?.ship?.current
  if (!current) return false
  if (
    Number.isFinite(current.altitude) &&
    current.altitude >= 2000 &&
    current.altitude < 600_000
  ) {
    return true
  }
  if (Number.isFinite(current.latitude) && Number.isFinite(current.longitude)) {
    const pad = getMeta().launchPad
    if (haversineKm(pad.lat, pad.lon, current.latitude, current.longitude) >= 5) {
      return true
    }
  }
  return false
}

/**
 * Watch live fixes. T+ starts only after two moving samples, and only if we
 * already saw the ship sitting on the pad. A page opened mid-flight uses
 * SpaceX mission elapsed time instead of the planned clock.
 */
function observePad(state, nowMs) {
  const key = sampleKey(state)
  if (!state?.ship?.current || key == null || key === lastSampleKey) return
  lastSampleKey = key
  samplesSeen += 1
  const moving = startedToMove(state)

  if (samplesSeen === 1 && !moving) {
    sawOnPad = true
    clearStoredLiftoff()
    return
  }
  if (liftoffConfirmed) return
  if (!moving) {
    sawOnPad = true
    moveStreak = 0
    firstMoveAtMs = null
    return
  }
  if (!sawOnPad) return
  if (moveStreak === 0) firstMoveAtMs = nowMs
  moveStreak += 1
  if (moveStreak >= 2) confirmLiftoff(firstMoveAtMs ?? nowMs)
}

/** Still on the countdown, including a frozen T- 0:00:00 after the planned time. */
function holdingCountdown(state) {
  if (officialLiftoffMs(state) != null) return false
  if (liftoffConfirmed) return false
  if (startedToMove(state) && !sawOnPad && samplesSeen > 0) return false
  return true
}

/**
 * Seconds from liftoff: negative before launch (T-), zero while held, positive after (T+).
 */
function downrangeFromPadKm(current) {
  if (!Number.isFinite(current?.latitude) || !Number.isFinite(current?.longitude)) {
    return null
  }
  try {
    const pad = getMeta().launchPad
    return haversineKm(pad.lat, pad.lon, current.latitude, current.longitude)
  } catch {
    return null
  }
}

/**
 * After liftoff, freeze T+ once the readouts are both 0. On the pad those
 * readouts are already 0, so a ship still at Starbase does not stop the clock.
 */
function landedClockSeconds(state) {
  const current = state?.ship?.current
  if (!current) return null
  if (
    (Number.isFinite(current.altitude) && current.altitude >= 500) ||
    (Number.isFinite(current.speed) && current.speed > 1)
  ) {
    seenFlying = true
  }
  const rangeKm = downrangeFromPadKm(current)
  const atRest =
    formatAltitudeKm(current.altitude) === '0' &&
    formatSpeedKmh(current.speed) === '0' &&
    Number.isFinite(rangeKm) &&
    rangeKm >= 5
  if (!atRest) return null
  if (Number.isFinite(state.altitudeZeroElapsedSeconds)) {
    rememberAltitudeZero(state.altitudeZeroElapsedSeconds)
  }
  if (Number.isFinite(state.landedElapsedSeconds)) {
    rememberLandedElapsed(state.landedElapsedSeconds, true)
  } else if (
    seenFlying &&
    Number.isFinite(current.mission_time) &&
    current.mission_time > 30
  ) {
    rememberLandedElapsed(current.mission_time, false)
  }
  return landedElapsedSeconds
}

function missionOffsetSeconds(state, nowMs) {
  observePad(state, nowMs)
  clockStopped = false
  const official = officialLiftoffMs(state)
  if (official != null) {
    setActualLiftoffMs(official)
  }
  const landed = landedClockSeconds(state)
  if (landed != null) {
    clockStopped = true
    return landed
  }
  if (official != null) {
    return Math.max(0, (nowMs - official) / 1000)
  }
  if (liftoffConfirmed && liftoffAtMs != null) {
    return Math.max(0, (nowMs - liftoffAtMs) / 1000)
  }
  const planned = getMeta().plannedLiftoffMs
  if (!holdingCountdown(state)) {
    if (typeof planned !== 'number') return 0
    return Math.max(0, (nowMs - planned) / 1000)
  }
  if (typeof planned !== 'number') return null
  // Hold at T- 0:00:00 once the planned time passes without movement off the pad.
  return Math.min(0, (nowMs - planned) / 1000)
}

function formatDuration(seconds) {
  const total = Math.floor(Math.max(0, seconds))
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return days > 0 ? `${days}d ${clock}` : clock
}

/** Seconds after the frozen landing mark. Counts up while T+ stays put. */
function secondsSinceLanding(state, nowMs) {
  if (landedElapsedSeconds == null) return null
  let liftoffMs = null
  try {
    const actual = getMeta().actualLiftoffMs
    if (typeof actual === 'number') liftoffMs = actual
  } catch {
    liftoffMs = null
  }
  const current = state?.ship?.current
  if (
    liftoffMs == null &&
    current &&
    Number.isFinite(current.gps_time) &&
    Number.isFinite(current.mission_time) &&
    current.mission_time > 1
  ) {
    liftoffMs = (current.gps_time - current.mission_time + GPS_TO_UNIX_OFFSET) * 1000
  }
  if (liftoffMs == null) return null
  return Math.max(0, (nowMs - liftoffMs) / 1000 - landedElapsedSeconds)
}

function renderSinceLanding(state, nowMs, landed) {
  const el = document.querySelector('.since-landing')
  const value = document.querySelector('[data-live="since-landing"]')
  if (!el || !value) return
  const since = landed ? secondsSinceLanding(state, nowMs) : null
  if (since == null) {
    el.hidden = true
    return
  }
  el.hidden = false
  value.textContent = formatDuration(since)
  el.setAttribute('aria-label', `Time since Starship landed, ${value.textContent}`)
}

function renderMissionClock(state, nowMs) {
  const el = document.querySelector('.mission-clock')
  if (!el) return
  const offset = missionOffsetSeconds(state, nowMs)
  const launched = !holdingCountdown(state)
  const holding =
    !launched && typeof offset === 'number' && offset === 0
  el.textContent = formatSignedMissionClock(offset ?? 0, launched ? 'T+' : 'T-')
  el.dataset.phase = launched ? 'flight' : 'prelaunch'
  el.dataset.hold = holding ? 'true' : 'false'
  el.dataset.stopped = clockStopped ? 'true' : 'false'
  el.setAttribute(
    'aria-label',
    clockStopped
      ? 'Mission elapsed time, stopped at landing'
      : launched
        ? 'Mission elapsed time'
        : holding
          ? 'Holding at T-0 until Starship leaves the pad'
          : 'Countdown to planned liftoff',
  )
  renderSinceLanding(state, nowMs, clockStopped)
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
  const rangeKm = haversineKm(
    pad.lat,
    pad.lon,
    current.latitude,
    current.longitude,
  )
  // Pad GPS sits a few metres off the surveyed point. Show that as still on the pad.
  const onPad = Number.isFinite(rangeKm) && rangeKm < 0.15
  const downrange = onPad ? '0 m' : formatDownrange(rangeKm)
  const rangeNote = onPad ? 'on the pad' : 'from pad'
  let traveledKm = 0
  try {
    traveledKm = distanceAlongTrailKm(loadLiveTrail())
  } catch {
    traveledKm = 0
  }
  const traveled = onPad ? '0 m' : formatDownrange(traveledKm)

  const grid = document.querySelector('.telemetry-grid')
  grid.innerHTML = `
    <div><dt>Coordinates</dt><dd>${formatLatLon(current.latitude, current.longitude)}</dd></div>
    <div><dt>Downrange</dt><dd>${downrange} <span>${rangeNote}</span></dd></div>
    <div><dt>Traveled</dt><dd>${traveled} <span>total</span></dd></div>
  `
  if (recordTelemetrySample(current) || !chartsPainted) {
    chartsPainted = true
    requestAnimationFrame(() => drawTelemetryCharts())
  }
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
  const refreshPlannedLiftoff = async () => {
    try {
      const res = await fetch('/api/launch-time', { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json()
      const ms = Date.parse(body?.plannedLiftoff)
      if (!Number.isFinite(ms)) return
      if (ms < Date.parse('2026-09-27T00:00:00Z') || ms > Date.parse('2026-10-02T00:00:00Z')) {
        return
      }
      setPlannedLiftoffMs(ms)
    } catch {
      /* keep the baked target */
    }
  }
  void refreshPlannedLiftoff()
  const liftoffPoll = setInterval(() => void refreshPlannedLiftoff(), 20_000)

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

  window.addEventListener('beforeunload', () => {
    clearInterval(liftoffPoll)
    stop()
  })
}

main()
