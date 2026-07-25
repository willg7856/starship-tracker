import { useEffect, useState } from 'react'
import { fetchRecoveryVessel, type RecoveryVessel } from '../lib/vessel'

/** AIS updates less often than SpaceX telemetry — poll about once a minute. */
const POLL_MS = 60_000

export function useRecoveryVessel() {
  const [vessel, setVessel] = useState<RecoveryVessel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const next = await fetchRecoveryVessel(controller.signal)
        if (cancelled) return
        setVessel(next)
        setError(null)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load vessel')
      }
    }

    void load()
    const id = window.setInterval(() => void load(), POLL_MS)

    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(id)
    }
  }, [])

  return { vessel, error }
}
