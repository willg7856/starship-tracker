import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SPACE_NOTICES_BAKED_LATEST_ID,
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
  type ShipTrack,
} from '../lib/spacex'

const POLL_MS = 10_000
const SPACE_NOTICES_POLL_MS = 60_000

export type TrackerState = {
  ship: ShipTrack | null
  fetchedAt: Date | null
  error: string | null
  loading: boolean
  refreshing: boolean
  /** Accumulated near-surface SpaceX fixes since this browser started tracking. */
  liveTrail: LiveTrailPoint[]
  /** Newer Space Notices trajectory samples beyond the baked path tip. */
  spaceNoticesExtension: SpaceNoticesPoint[]
  /**
   * When Ship 40 last actually changed position, derived from the shared
   * ground track so every device agrees.
   */
  lastMovedAt: Date | null
}

export function useShip40(): TrackerState {
  const [ship, setShip] = useState<ShipTrack | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [liveTrail, setLiveTrail] = useState<LiveTrailPoint[]>(() =>
    loadLiveTrail(),
  )
  const [spaceNoticesExtension, setSpaceNoticesExtension] = useState<
    SpaceNoticesPoint[]
  >([])
  const hasLoaded = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load(isRefresh: boolean) {
      if (isRefresh) setRefreshing(true)
      else if (!hasLoaded.current) setLoading(true)

      try {
        const { ship: nextShip, fetchedAt: at } = await fetchShip40Tracker(
          controller.signal,
        )

        if (cancelled) return
        setShip(nextShip)
        setFetchedAt(at)
        setError(null)
        hasLoaded.current = true

        setLiveTrail((prev) => {
          const next = appendLiveFix(prev, nextShip.current)
          if (next !== prev) saveLiveTrail(next)
          return next
        })
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        const message =
          err instanceof Error ? err.message : 'Failed to load SpaceX tracker'
        setError(message)
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
        setSpaceNoticesExtension(
          pointsAfterId(points, SPACE_NOTICES_BAKED_LATEST_ID),
        )
      } catch {
        // Space Notices is supplemental path data; SpaceX tracker remains primary.
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
  }, [])

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
    liveTrail,
    spaceNoticesExtension,
    lastMovedAt,
  }
}
