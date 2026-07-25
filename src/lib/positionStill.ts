import { gpsTimeToDate, haversineKm } from './spacex'

const STORAGE_KEY = 'bsz-ship40-position-still-v1'
/** Ignore GPS noise — only count a real position change past this. */
const MIN_MOVE_M = 15

export type PositionStillState = {
  latitude: number
  longitude: number
  /** GPS time when this position was first observed (or last real move). */
  since_gps_time: number
}

function isValidState(value: unknown): value is PositionStillState {
  if (!value || typeof value !== 'object') return false
  const v = value as PositionStillState
  return (
    Number.isFinite(v.latitude) &&
    Number.isFinite(v.longitude) &&
    Number.isFinite(v.since_gps_time)
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
 * Update "position still since" from a new SpaceX fix.
 * Same coordinates (within MIN_MOVE_M) keep the prior since-time.
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
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    since_gps_time: fix.gps_time,
  }
}

export function positionStillSinceDate(
  state: PositionStillState | null,
): Date | null {
  if (!state) return null
  return gpsTimeToDate(state.since_gps_time)
}
