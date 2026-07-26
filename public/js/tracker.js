import { getMeta } from './path.js'
import {
  appendLiveFix,
  estimateLastMoveGpsTime,
  loadLiveTrail,
  saveLiveTrail,
} from './trail.js'
import { gpsTimeToDate } from './utils.js'

const POLL_MS = 10_000
const SPACE_NOTICES_POLL_MS = 60_000

export async function fetchShip40Tracker(signal) {
  const res = await fetch(`/api/tracker?t=${Date.now()}`, {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`SpaceX tracker returned ${res.status}`)
  const raw = await res.json()
  if (!raw?.ship40?.current) return null
  return { ship: raw.ship40, fetchedAt: new Date() }
}

export async function fetchSpaceNoticesShip40(signal) {
  const res = await fetch(`/api/space-notices-ship40?t=${Date.now()}`, {
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
      const gps = estimateLastMoveGpsTime(
        state.ship.current,
        state.spaceNoticesExtension,
      )
      state.lastMovedAt = gpsTimeToDate(gps)
    } else {
      state.lastMovedAt = null
    }
    onChange({ ...state })
  }

  const controller = new AbortController()
  let hasLoaded = false
  let positionSource = null

  async function loadFromSpaceNotices() {
    const points = await fetchSpaceNoticesShip40(controller.signal)
    const { bakedLatestId } = getMeta()
    const extension = pointsAfterId(points, bakedLatestId)
    state.spaceNoticesExtension = extension
    const tip = extension[extension.length - 1] ?? points[points.length - 1]
    if (!tip) return false
    const clock = missionClockNow()
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
      const live = await fetchShip40Tracker(controller.signal)
      if (live) {
        state.ship = live.ship
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
      if (!ok && !hasLoaded) state.error = 'No live Ship 40 position available'
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
      const points = await fetchSpaceNoticesShip40(controller.signal)
      const { bakedLatestId } = getMeta()
      const extension = pointsAfterId(points, bakedLatestId)
      state.spaceNoticesExtension = extension
      if (positionSource === 'space-notices') {
        const tip = extension[extension.length - 1] ?? points[points.length - 1]
        if (tip) {
          state.ship = shipTrackFromSpaceNoticesTip(tip, missionClockNow())
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
