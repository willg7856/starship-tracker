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
import { gpsTimeToDate, speedBetweenFixes } from './utils.js'

const POLL_MS = 1_000
const SPACE_NOTICES_POLL_MS = 60_000
const SHIP_TRAIL_POLL_MS = 30_000
const SHIP_KEY = 'ship41'
const LAST_FIX_KEY = 'bsz-ship41-last-fix-v1'

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

export async function fetchShip41Tracker(signal) {
  const res = await fetch('/api/tracker', {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`SpaceX tracker returned ${res.status}`)
  const raw = await res.json()
  const ship = raw?.[SHIP_KEY]
  if (!ship?.current) return null
  return { ship, fetchedAt: new Date() }
}

export async function fetchSpaceNoticesShip41(signal) {
  const res = await fetch(`/api/space-notices-ship41?t=${Date.now()}`, {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Space Notices returned ${res.status}`)
  const raw = await res.json()
  if (!Array.isArray(raw)) throw new Error('Space Notices feed was not an array')
  return raw
    .filter(
      (p) =>
        p &&
        typeof p.id === 'number' &&
        typeof p.latitude === 'number' &&
        typeof p.longitude === 'number',
    )
    .sort((a, b) => a.id - b.id)
}

function pointsAfterId(points, afterId) {
  return points.filter((p) => p.id > afterId)
}

function missionClockNow(nowMs = Date.now()) {
  const { splashdownGpsTime, splashdownMissionTime } = getMeta()
  if (
    typeof splashdownGpsTime !== 'number' ||
    typeof splashdownMissionTime !== 'number'
  ) {
    return null
  }
  const splashMs = gpsTimeToDate(splashdownGpsTime).getTime()
  const elapsed = Math.max(0, (nowMs - splashMs) / 1000)
  return {
    missionTime: splashdownMissionTime + elapsed,
    gpsTime: splashdownGpsTime + elapsed,
  }
}

function shipTrackFromSpaceNoticesTip(tip, opts) {
  return {
    current: {
      gps_time: opts.gpsTime,
      mission_time: opts.missionTime,
      altitude: -20,
      speed: 0,
      latitude: tip.latitude,
      longitude: tip.longitude,
    },
    trajectory: [],
  }
}

/**
 * Poll SpaceX + Space Notices. Calls onChange(state) whenever something updates.
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
    if (state.ship?.current) {
      if (state.positionSource === 'spacex' && state.fetchedAt) {
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
    if (Number.isFinite(mission) && mission > 1 && mission < 20 * 3600) {
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

  async function loadFromSpaceNotices() {
    const points = await fetchSpaceNoticesShip41(controller.signal)
    const { bakedLatestId } = getMeta()
    const extension = pointsAfterId(points, bakedLatestId)
    state.spaceNoticesExtension = extension
    const tip = extension[extension.length - 1] ?? points[points.length - 1]
    if (!tip) return false
    const clock = missionClockNow()
    if (!clock) return false
    state.ship = shipTrackFromSpaceNoticesTip(tip, clock)
    state.fetchedAt = new Date()
    state.positionSource = 'space-notices'
    positionSource = 'space-notices'
    state.error = null
    hasLoaded = true
    return true
  }

  async function load() {
    try {
      const live = await fetchShip41Tracker(controller.signal)
      if (live) {
        state.ship = {
          ...live.ship,
          current: withDerivedSpeed(live.ship.current),
        }
        state.fetchedAt = live.fetchedAt
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
      const ok = await loadFromSpaceNotices()
      if (!ok && !hasLoaded) {
        state.error = null
        // Pre-launch: no ship41 telemetry yet is expected.
      }
    } catch (err) {
      if (controller.signal.aborted) return
      try {
        if (await loadFromSpaceNotices()) return
      } catch {
        /* keep original error */
      }
      if (!hasLoaded) {
        state.error = err instanceof Error ? err.message : 'Failed to load tracker'
      }
    } finally {
      state.loading = false
      emit()
    }
  }

  async function loadSpaceNotices() {
    try {
      const points = await fetchSpaceNoticesShip41(controller.signal)
      const { bakedLatestId } = getMeta()
      const extension = pointsAfterId(points, bakedLatestId)
      state.spaceNoticesExtension = extension
      if (positionSource === 'space-notices') {
        const tip = extension[extension.length - 1] ?? points[points.length - 1]
        const clock = missionClockNow()
        if (tip && clock) {
          state.ship = shipTrackFromSpaceNoticesTip(tip, clock)
          state.fetchedAt = new Date()
        }
      }
      emit()
    } catch {
      /* supplemental */
    }
  }

  void load()
  void loadSpaceNotices()
  void loadSharedTrail()
  const pollId = setInterval(() => void load(), POLL_MS)
  const snId = setInterval(() => void loadSpaceNotices(), SPACE_NOTICES_POLL_MS)
  const trailId = setInterval(() => void loadSharedTrail(), SHIP_TRAIL_POLL_MS)

  return () => {
    controller.abort()
    clearInterval(pollId)
    clearInterval(snId)
    clearInterval(trailId)
  }
}
