import { gpsTimeToDate, haversineKm } from './spacex'

/** Bumped so first-load no longer pretends a move just happened. */
const STORAGE_KEY = 'bsz-ship40-position-still-v2'
/** Ignore GPS noise — only count a real position change past this. */
const MIN_MOVE_M = 15

export type PositionStillState = {
  latitude: number
  longitude: number
  /** GPS time when this position was first observed (or last real move). */
  since_gps_time: number
  /**
   * True only after this browser saw lat/lon actually change.
   * First page load must not count as an update.
   */
  moveConfirmed: boolean
}

function isValidState(value: unknown): value is PositionStillState {
  if (!value || typeof value !== 'object') return false
  const v = value as PositionStillState
  return (
    Number.isFinite(v.latitude) &&
    Number.isFinite(v.longitude) &&
    Number.isFinite(v.since_gps_time) &&
    typeof v.moveConfirmed === 'boolean'
  )
}

export function loadPositionStill(): PositionStillState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isValidState(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function savePositionStill(state: PositionStillState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota / private mode — in-memory tracking in the hook still works.
  }
}

/**
 * Update position-still state from a new SpaceX fix.
 * Same coordinates keep the prior since-time. A real move sets moveConfirmed.
 */
export function observePositionFix(
  prev: PositionStillState | null,
  fix: {
    gps_time: number
    latitude: number
    longitude: number
  },
): PositionStillState {
  if (
    prev &&
    haversineKm(
      prev.latitude,
      prev.longitude,
      fix.latitude,
      fix.longitude,
    ) *
      1000 <
      MIN_MOVE_M
  ) {
    return prev
  }

  // First observation in this browser — track the fix, but do not claim a move.
  if (!prev) {
    return {
      latitude: fix.latitude,
      longitude: fix.longitude,
      since_gps_time: fix.gps_time,
      moveConfirmed: false,
    }
  }

  // Lat/lon changed past the noise floor — this is a real update.
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    since_gps_time: fix.gps_time,
    moveConfirmed: true,
  }
}

export function positionStillSinceDate(
  state: PositionStillState | null,
): Date | null {
  if (!state) return null
  return gpsTimeToDate(state.since_gps_time)
}
