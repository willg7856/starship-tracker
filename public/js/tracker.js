import { getMeta } from './path.js'
import {
  appendLiveFix,
  estimateLastMoveGpsTime,
  loadLiveTrail,
  saveLiveTrail,
} from './trail.js'
import { gpsTimeToDate, haversineKm } from './utils.js'

const POLL_MS = 1_000
const SPACE_NOTICES_POLL_MS = 60_000
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

function speedFromFixes(prev, next) {
  const dt = next.gps_time - prev.gps_time
  if (!(dt >= 1) || dt > 180) return null
  const a = prev.r_ecef
  const b = next.r_ecef
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length >= 3 &&
    b.length >= 3 &&
    [a[0], a[1], a[2], b[0], b[1], b[2]].every(Number.isFinite)
  ) {
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt
  }
  if (
    ![prev.latitude, prev.longitude, next.latitude, next.longitude].every(
      Number.isFinite,
    )
  ) {
    return null
  }
  const groundM =
    haversineKm(prev.latitude, prev.longitude, next.latitude, next.longitude) *
    1000
  const dAlt =
    Number.isFinite(next.altitude) && Number.isFinite(prev.altitude)
      ? next.altitude - prev.altitude
      : 0
  return Math.hypot(groundM, dAlt) / dt
}

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
    const derived = speedFromFixes(lastSpeedFix, fix)
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
  const pollId = setInterval(() => void load(), POLL_MS)
  const snId = setInterval(() => void loadSpaceNotices(), SPACE_NOTICES_POLL_MS)

  return () => {
    controller.abort()
    clearInterval(pollId)
    clearInterval(snId)
  }
}
