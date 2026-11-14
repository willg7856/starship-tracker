import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight } from './_flight.js'
import { discoverOrbits } from './_orbit.js'

/** Best published orbit for the current flight's ship (see _orbit.ts). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const info = await discoverFlight()
    const { best: orbit, payload } = info
      ? await discoverOrbits(info.flight, info.ship, info.plannedLiftoff)
      : { best: null, payload: null }
    // Orbit data changes every few hours at most; keep upstream load low.
    // Cache a found orbit longer than a miss, so a dropped upstream
    // connection is retried soon.
    res.setHeader(
      'Cache-Control',
      orbit ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' : 'public, max-age=60, s-maxage=60',
    )
    res.status(200).json({ flight: info?.flight ?? null, orbit, payload })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
