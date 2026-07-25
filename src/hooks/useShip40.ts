import { useEffect, useRef, useState } from 'react'
import {
  appendLiveFix,
  loadLiveTrail,
  saveLiveTrail,
  type LiveTrailPoint,
} from '../lib/liveTrail'
import { fetchShip40Tracker, type ShipTrack } from '../lib/spacex'

const POLL_MS = 10_000

export type TrackerState = {
  ship: ShipTrack | null
  fetchedAt: Date | null
  error: string | null
  loading: boolean
  refreshing: boolean
  /** Accumulated near-surface SpaceX fixes since this browser started tracking. */
  liveTrail: LiveTrailPoint[]
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

  return { ship, fetchedAt, error, loading, refreshing, liveTrail }
}
