import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SPACE_NOTICES_BAKED_LATEST_ID,
  SPLASHDOWN_GPS_TIME,
  SPLASHDOWN_MISSION_TIME,
  getFlightTrack,
} from '../data/flight13Path'
import { estimateLastMoveGpsTime } from '../lib/lastMove'
import {
  appendLiveFix,
  loadLiveTrail,
  saveLiveTrail,
  type LiveTrailPoint,
} from '../lib/liveTrail'
import {
  fetchSpaceNoticesShip40,
  pointsAfterId,
  type SpaceNoticesPoint,
} from '../lib/spaceNotices'
import {
  fetchShip40Tracker,
  gpsTimeToDate,
  shipTrackFromSpaceNoticesTip,
  type ShipTrack,
} from '../lib/spacex'

const POLL_MS = 10_000
const SPACE_NOTICES_POLL_MS = 60_000

export type PositionSource = 'spacex' | 'space-notices'

export type TrackerState = {
  ship: ShipTrack | null
  fetchedAt: Date | null
  error: string | null
  loading: boolean
  refreshing: boolean
  /** Internal: SpaceX live fix vs archived/fallback tip. Not shown in UI. */
  positionSource: PositionSource | null
  /** Accumulated near-surface SpaceX fixes since this browser started tracking. */
  liveTrail: LiveTrailPoint[]
  /** Newer trajectory samples beyond the baked path tip. */
  spaceNoticesExtension: SpaceNoticesPoint[]
  /**
   * When Ship 40 last actually changed position, derived from the shared
   * ground track so every device agrees.
   */
  lastMovedAt: Date | null
}

/** Mission/GPS time from real wall-clock elapsed since splashdown. */
function missionClockNow(nowMs = Date.now()): {
  gpsTime: number
  missionTime: number
} {
  const splashMs = gpsTimeToDate(SPLASHDOWN_GPS_TIME).getTime()
  const elapsed = Math.max(0, (nowMs - splashMs) / 1000)
  return {
    missionTime: SPLASHDOWN_MISSION_TIME + elapsed,
    gpsTime: SPLASHDOWN_GPS_TIME + elapsed,
  }
}

export function useShip40(): TrackerState {
  const [ship, setShip] = useState<ShipTrack | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [positionSource, setPositionSource] = useState<PositionSource | null>(
    null,
  )
  const [liveTrail, setLiveTrail] = useState<LiveTrailPoint[]>(() =>
    loadLiveTrail(),
  )
  const [spaceNoticesExtension, setSpaceNoticesExtension] = useState<
    SpaceNoticesPoint[]
  >([])
  const hasLoaded = useRef(false)
  const extensionRef = useRef<SpaceNoticesPoint[]>([])

  useEffect(() => {
    extensionRef.current = spaceNoticesExtension
  }, [spaceNoticesExtension])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadFromSpaceNotices(): Promise<boolean> {
      const points = await fetchSpaceNoticesShip40(controller.signal)
      if (cancelled) return false

      const extension = pointsAfterId(points, SPACE_NOTICES_BAKED_LATEST_ID)
      setSpaceNoticesExtension(extension)
      extensionRef.current = extension

      const tip = extension[extension.length - 1] ?? points[points.length - 1]
      if (!tip) return false

      const { gpsTime, missionTime } = missionClockNow()
      const nextShip = shipTrackFromSpaceNoticesTip(tip, {
        gpsTime,
        missionTime,
      })

      setShip(nextShip)
      setFetchedAt(new Date())
      setPositionSource('space-notices')
      setError(null)
      hasLoaded.current = true
      return true
    }

    async function load(isRefresh: boolean) {
      if (isRefresh) setRefreshing(true)
      else if (!hasLoaded.current) setLoading(true)

      try {
        const live = await fetchShip40Tracker(controller.signal)
        if (cancelled) return

        if (live) {
          setShip(live.ship)
          setFetchedAt(live.fetchedAt)
          setPositionSource('spacex')
          setError(null)
          hasLoaded.current = true

          setLiveTrail((prev) => {
            const next = appendLiveFix(prev, live.ship.current)
            if (next !== prev) saveLiveTrail(next)
            return next
          })
          return
        }

        // SpaceX cleared the public feed — keep the map alive via Space Notices.
        const ok = await loadFromSpaceNotices()
        if (!ok && !hasLoaded.current) {
          setError('No live Ship 40 position available')
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        try {
          const ok = await loadFromSpaceNotices()
          if (ok) return
        } catch {
          // fall through to surface the original error
        }
        if (!hasLoaded.current) {
          const message =
            err instanceof Error ? err.message : 'Failed to load tracker'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void load(false)
    const id = window.setInterval(() => void load(true), POLL_MS)

    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadSpaceNotices() {
      try {
        const points = await fetchSpaceNoticesShip40(controller.signal)
        if (cancelled) return
        const extension = pointsAfterId(points, SPACE_NOTICES_BAKED_LATEST_ID)
        setSpaceNoticesExtension(extension)

        // If we're already on the Space Notices fallback, refresh the tip.
        if (positionSource === 'space-notices') {
          const tip =
            extension[extension.length - 1] ?? points[points.length - 1]
          if (!tip) return
          const { gpsTime, missionTime } = missionClockNow()
          setShip(
            shipTrackFromSpaceNoticesTip(tip, {
              gpsTime,
              missionTime,
            }),
          )
          setFetchedAt(new Date())
        }
      } catch {
        // Space Notices is supplemental; don't wipe a good SpaceX fix.
      }
    }

    void loadSpaceNotices()
    const id = window.setInterval(
      () => void loadSpaceNotices(),
      SPACE_NOTICES_POLL_MS,
    )

    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(id)
    }
  }, [positionSource])

  const lastMovedAt = useMemo(() => {
    if (!ship?.current) return null
    const gps = estimateLastMoveGpsTime(
      ship.current,
      getFlightTrack(),
      spaceNoticesExtension,
    )
    return gpsTimeToDate(gps)
  }, [ship, spaceNoticesExtension])

  return {
    ship,
    fetchedAt,
    error,
    loading,
    refreshing,
    positionSource,
    liveTrail,
    spaceNoticesExtension,
    lastMovedAt,
  }
}
