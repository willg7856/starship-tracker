import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight } from './_flight.js'

/** Kept for pages loaded before /api/flight existed. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const info = await discoverFlight()
    if (!info?.plannedLiftoff) {
      res.status(502).json({ error: 'SpaceX has no Starship T-0' })
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=60')
    res.status(200).json({
      plannedLiftoff: info.plannedLiftoff,
      paused: info.paused,
      landingMissionTime: info.landingMissionTime,
      flight: info.flight,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
