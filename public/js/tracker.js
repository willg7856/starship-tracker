import { flightStorageKey, shipKey } from './flight.js'
import {
  orbitFixAt,
  orbitTrail,
  orbitWindow,
  plannedReentryPath,
  reconstructedPath,
  refreshOrbit,
  starlinkFixAt,
} from './orbit.js'
import { getMeta } from './path.js'
import {
  appendLiveFix,
  estimateLastMoveGpsTime,
  loadLiveTrail,
  mergeTrailAhead,
  altitudeZeroElapsedSeconds,
  pointsFromNoticesCoordinates,
  restElapsedSeconds,
  saveLiveTrail,
} from './trail.js'
import { GPS_TO_UNIX_OFFSET, MAX_MISSION_S, gpsTimeToDate, speedBetweenFixes } from './utils.js'

// SpaceX's tracker updates about every 30 s: 2 s polls pick a new fix up
// quickly. With no live ship (before launch, after the flight, tracker
// off) poll more gently, and not at all while the tab is hidden: every
// poll is a CDN request, multiplied by every viewer.
const POLL_MS = 2_000
const IDLE_POLL_MS = 10_000
// The Space Notices trail only changes when there is real flight data.
const SHIP_TRAIL_POLL_MS = 120_000
const SHIP_KEY = shipKey
const LAST_FIX_KEY = flightStorageKey('last-fix-v1')

function readLastFix() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LAST_FIX_KEY) || 'null')
    return saved && Number.isFinite(saved.gps_time) ? saved : null
  } catch {
    return null
  }
}

let lastSpeedFix = readLastFix()
let lastDerivedSpeed = Number.isFinite(lastSpeedFix?.derivedSpeed)
  ? lastSpeedFix.derivedSpeed
  : null

/**
 * SpaceX is publishing position but leaving speed at 0. Measure speed from
 * the last two fixes. Keep a reported speed once it is actually non-zero.
 */
function withDerivedSpeed(current) {
  if (!current || !Number.isFinite(current.gps_time)) return current
  const fix = {
    gps_time: current.gps_time,
    latitude: current.latitude,
    longitude: current.longitude,
    altitude: current.altitude,
    r_ecef: current.r_ecef,
  }
  const reported = Number.isFinite(current.speed) ? current.speed : null
  let speed = reported
  const newer = lastSpeedFix && fix.gps_time > lastSpeedFix.gps_time + 0.5
  if (reported > 1) {
    lastDerivedSpeed = null
  } else if (newer) {
    const derived = speedBetweenFixes(lastSpeedFix, fix)
    if (Number.isFinite(derived) && derived >= 0 && derived < 12_000) {
      speed = derived
      lastDerivedSpeed = derived
    }
  } else if (Number.isFinite(lastDerivedSpeed)) {
    speed = lastDerivedSpeed
  }
  const flying = Number.isFinite(current.altitude) && current.altitude > 2000
  if (!(reported > 1) && !(Number.isFinite(speed) && speed > 1) && flying) {
    speed = null
  }
  if (!lastSpeedFix || newer) {
    lastSpeedFix = { ...fix, derivedSpeed: lastDerivedSpeed }
    try {
      sessionStorage.setItem(LAST_FIX_KEY, JSON.stringify(lastSpeedFix))
    } catch {
      /* ignore */
    }
  }
  if (speed === current.speed) return current
  return { ...current, speed }
}

/**
 * SpaceX keys vehicles as `ship42`, `booster22`, and so on. Prefer this
 * flight's ship; otherwise take the only ship with a live fix.
 */
function pickShip(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (SHIP_KEY && raw[SHIP_KEY]?.current) return raw[SHIP_KEY]
  const ships = Object.entries(raw).filter(
    ([key, value]) => /^ship\d+$/i.test(key) && value?.current,
  )
  return ships.length === 1 ? ships[0][1] : null
}

export async function fetchShipTracker(signal) {
  const res = await fetch('/api/tracker', {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`SpaceX tracker returned ${res.status}`)
  const raw = await res.json()
  const ship = pickShip(raw)
  return { ship: ship?.current ? ship : null, booster: pickBooster(raw), fetchedAt: new Date() }
}

const STARLINK_TRAIL_S = 15 * 60

/**
 * Straight-line distance from the ship to the Starlink batch, compared at
 * the moment of the ship's fix (SpaceX's gps_time is true GPS time, 18 s
 * ahead of UTC); for an estimated ship, at the current time.
 */
function shipToStarlinkKm(ship) {
  if (!ship) return null
  const at = Number.isFinite(ship.gps_time) && !ship.estimated
    ? (ship.gps_time + GPS_TO_UNIX_OFFSET - 18) * 1000
    : Date.now()
  const sat = starlinkFixAt(at)
  if (!sat) return null
  const a = ship.r_ecef
  const b = sat.r_ecef
  if (Array.isArray(a) && a.length >= 3 && a.every(Number.isFinite)) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1000
  }
  if (![ship.latitude, ship.longitude, ship.altitude].every(Number.isFinite)) return null
  // No Earth-fixed position on the fix: great-circle distance at the
  // average altitude, combined with the altitude difference.
  const R = 6371
  const toR = (d) => (d * Math.PI) / 180
  const dφ = toR(sat.latitude - ship.latitude)
  const dλ = toR(sat.longitude - ship.longitude)
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(toR(ship.latitude)) * Math.cos(toR(sat.latitude)) * Math.sin(dλ / 2) ** 2
  const ground = 2 * (R + (ship.altitude + sat.altitude) / 2000) * Math.asin(Math.sqrt(h))
  return Math.hypot(ground, (ship.altitude - sat.altitude) / 1000)
}

/** The planned re-entry path, shown from 30 min before the deorbit burn. */
function plannedPathNow() {
  try {
    const m = getMeta()
    const t0 = m.actualLiftoffMs ?? m.plannedLiftoffMs
    if (!Number.isFinite(t0)) return null
    const met = (Date.now() - t0) / 1000
    return met >= orbitWindow().deorbit - 1800 ? plannedReentryPath() : null
  } catch {
    return null
  }
}

/**
 * SpaceX keys a booster as e.g. `booster22`. Returns the one live booster,
 * if SpaceX publishes exactly one.
 */
function pickBooster(raw) {
  if (!raw || typeof raw !== 'object') return null
  const boosters = Object.entries(raw).filter(
    ([key, value]) => /^booster\d+$/i.test(key) && value?.current,
  )
  if (boosters.length !== 1) return null
  const [key, value] = boosters[0]
  const c = value.current
  if (![c.latitude, c.longitude].every(Number.isFinite)) return null
  return { label: `Booster ${key.replace(/\D+/g, '')}`, current: c }
}

/**
 * Poll SpaceX (and the Space Notices flight trail). Calls onChange(state)
 * whenever something updates.
 */
export function startTracker(onChange) {
  const state = {
    ship: null,
    fetchedAt: null,
    error: null,
    loading: true,
    positionSource: null,
    liveTrail: loadLiveTrail(),
    landedElapsedSeconds: null,
    altitudeZeroElapsedSeconds: null,
    spaceNoticesExtension: [],
    lastMovedAt: null,
  }

  const emit = () => {
    state.plannedPath = plannedPathNow()
    state.mapTrail = trailForMap()
    const now = Date.now()
    state.starlink = starlinkFixAt(now)
    if (state.starlink) {
      // Short trail behind the batch: the last 15 minutes, oldest first.
      const trail = []
      for (let s = STARLINK_TRAIL_S; s >= 0; s -= 30) {
        const f = starlinkFixAt(now - s * 1000)
        if (f) trail.push([f.latitude, f.longitude])
      }
      state.starlink.trail = trail
      state.starlink.distanceKm = shipToStarlinkKm(state.ship?.current)
    }
    if (state.ship?.current) {
      if ((state.positionSource === 'spacex' || state.positionSource === 'orbit') && state.fetchedAt) {
        // Prefer telemetry freshness while SpaceX is publishing live fixes.
        state.lastMovedAt = state.fetchedAt
      } else {
        const gps = estimateLastMoveGpsTime(
          state.ship.current,
          state.spaceNoticesExtension,
        )
        state.lastMovedAt = gpsTimeToDate(gps)
      }
    } else {
      state.lastMovedAt = null
    }
    onChange({ ...state })
  }

  /**
   * The flown path for the map. Live SpaceX fixes only exist from when this
   * browser opened the page, so the part before that is rebuilt (pad at
   * liftoff, then the published orbit) and joined to the live fixes.
   */
  let backfill = { key: null, points: [] }
  function trailForMap() {
    const trail = state.liveTrail || []
    if (state.positionSource !== 'spacex' || !state.ship?.current) return trail
    const first = trail[0] ?? state.ship.current
    const firstMs = (first.gps_time + GPS_TO_UNIX_OFFSET - 18) * 1000
    const key = `${orbitVersion}/${Math.round(first.gps_time)}`
    if (backfill.key !== key) {
      // Stop a little before the first live fix so the two join cleanly.
      backfill = { key, points: reconstructedPath(firstMs - 20_000) }
    }
    return (backfill.points.length ? backfill.points : []).concat(fillGaps(trail))
  }

  /**
   * Live fixes saved from an earlier visit leave a gap until this one; a
   * straight line across it would cut across the map. Fill gaps longer than
   * 2 minutes from the published orbit.
   */
  let gapCache = { key: null, points: [] }
  function fillGaps(trail) {
    if (trail.length < 2) return trail
    const key = `${orbitVersion}/${trail.length}/${Math.round(trail[trail.length - 1].gps_time)}`
    if (gapCache.key === key) return gapCache.points
    const toMs = (gps) => (gps + GPS_TO_UNIX_OFFSET - 18) * 1000
    const out = [trail[0]]
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1]
      const b = trail[i]
      if (b.gps_time - a.gps_time > 120) {
        const mid = reconstructedPath(toMs(b.gps_time) - 15_000, 30, toMs(a.gps_time) + 15_000)
        for (const p of mid) out.push(p)
      }
      out.push(b)
    }
    gapCache = { key, points: out }
    return out
  }

  const controller = new AbortController()
  let hasLoaded = false
  let positionSource = null
  let noticesCoordinates = null

  function applySharedTrail() {
    const current = state.ship?.current
    if (!noticesCoordinates || !current) return
    let pad = null
    try {
      pad = getMeta().launchPad
    } catch {
      pad = null
    }
    const history = pointsFromNoticesCoordinates(noticesCoordinates, current, pad)
    if (history.length < 2) return
    const mission = current.mission_time
    if (Number.isFinite(mission) && mission > 1 && mission < MAX_MISSION_S) {
      const liftoffGps = current.gps_time - mission
      const rest = restElapsedSeconds(history, liftoffGps)
      if (rest != null) state.landedElapsedSeconds = rest
      const touched = altitudeZeroElapsedSeconds(history, liftoffGps)
      if (touched != null) state.altitudeZeroElapsedSeconds = touched
    }
    const merged = mergeTrailAhead(history, state.liveTrail)
    state.liveTrail = merged
    saveLiveTrail(merged)
    applySpeedFromTrail()
  }

  function applySpeedFromTrail() {
    const current = state.ship?.current
    const trail = state.liveTrail
    if (!current || !trail || trail.length < 2) return
    if (Number.isFinite(current.speed) && current.speed > 1) return
    const spd = speedBetweenFixes(trail[trail.length - 2], trail[trail.length - 1])
    if (!Number.isFinite(spd) || spd <= 1 || spd >= 12_000) return
    lastDerivedSpeed = spd
    const tip = trail[trail.length - 1]
    lastSpeedFix = {
      gps_time: tip.gps_time,
      latitude: tip.latitude,
      longitude: tip.longitude,
      altitude: tip.altitude,
      r_ecef: tip.r_ecef,
      derivedSpeed: spd,
    }
    state.ship = {
      ...state.ship,
      current: { ...current, speed: spd },
    }
  }

  async function loadSharedTrail() {
    try {
      const res = await fetch('/api/ship-trail', {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!res.ok) return
      const body = await res.json()
      if (!Array.isArray(body?.coordinates) || body.coordinates.length < 2) return
      noticesCoordinates = body.coordinates
      applySharedTrail()
      emit()
    } catch {
      /* the live fix still draws; history fills in on the next poll */
    }
  }

  /**
   * No SpaceX telemetry: use the estimated position from the published (or
   * modelled) orbit while the ship is on orbit. Outside that window, drop the
   * estimate so the page says plainly that there is no live position.
   */
  let orbitTrailSeeded = false
  let orbitVersion = 0
  function applyOrbitFix() {
    const now = Date.now()
    const fix = orbitFixAt(now)
    if (!fix) {
      if (state.positionSource === 'orbit') {
        state.ship = null
        state.positionSource = null
        positionSource = null
      }
      return false
    }
    state.ship = { current: fix, trajectory: [] }
    // After SpaceX's planned catch time the estimate sits at the pad; that
    // planned time is what stops the clock (no live data to confirm it).
    if (fix.estimated === 'plan') state.landedElapsedSeconds = fix.mission_time
    state.fetchedAt = new Date(now)
    state.positionSource = 'orbit'
    positionSource = 'orbit'
    state.error = null
    hasLoaded = true
    if (!orbitTrailSeeded) {
      state.liveTrail = orbitTrail(now)
      orbitTrailSeeded = true
    } else {
      state.liveTrail = appendLiveFix(state.liveTrail, fix)
    }
    return true
  }

  async function load() {
    try {
      const feed = await fetchShipTracker(controller.signal)
      state.booster = feed.booster
      const live = feed.ship ? feed : null
      if (live) {
        state.ship = {
          ...live.ship,
          current: withDerivedSpeed(live.ship.current),
        }
        state.fetchedAt = live.fetchedAt
        if (positionSource === 'orbit') {
          // Real telemetry is back: replace the estimated track.
          state.liveTrail = loadLiveTrail()
        }
        state.positionSource = 'spacex'
        positionSource = 'spacex'
        state.error = null
        hasLoaded = true
        const next = appendLiveFix(state.liveTrail, live.ship.current)
        if (next !== state.liveTrail) {
          state.liveTrail = next
          saveLiveTrail(next)
        }
        applySharedTrail()
        return
      }
      // SpaceX answered but has no ship (normal before launch, or with
      // its tracker switched off): estimate from the orbit / flight plan.
      applyOrbitFix()
      if (!hasLoaded) state.error = null
    } catch (err) {
      if (controller.signal.aborted) return
      if (positionSource !== 'spacex' && applyOrbitFix()) return
      if (!hasLoaded) {
        state.error = err instanceof Error ? err.message : 'Failed to load tracker'
      }
    } finally {
      state.loading = false
      emit()
    }
  }

  // Published orbits update every few hours; re-check every 10 minutes and
  // rebuild the estimated track when a better or newer one appears.
  const syncOrbit = () =>
    refreshOrbit()
      .then((changed) => {
        if (changed) {
          orbitTrailSeeded = false
          orbitVersion += 1
        }
      })
      .catch(() => {})
  void syncOrbit()
  const orbitId = setInterval(syncOrbit, 10 * 60_000)
  void load()
  void loadSharedTrail()
  let pollId = null
  const schedulePoll = () => {
    clearTimeout(pollId)
    if (controller.signal.aborted || document.hidden) return
    pollId = setTimeout(
      () => void load().finally(schedulePoll),
      positionSource === 'spacex' ? POLL_MS : IDLE_POLL_MS,
    )
  }
  const onVisibility = () => {
    if (document.hidden) {
      clearTimeout(pollId)
    } else {
      void load().finally(schedulePoll)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  schedulePoll()
  const trailId = setInterval(() => {
    if (!document.hidden) void loadSharedTrail()
  }, SHIP_TRAIL_POLL_MS)

  return () => {
    clearInterval(orbitId)
    controller.abort()
    clearTimeout(pollId)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(trailId)
  }
}
