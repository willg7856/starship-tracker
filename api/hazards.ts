import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight } from './_flight.js'
import { discoverHazards } from './_hazards.js'

/** Hazard areas for the current flight, from its Space Notices page. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const info = await discoverFlight()
    const groups = info ? await discoverHazards(info.flight) : null
    res.setHeader(
      'Cache-Control',
      groups ? 'public, max-age=600, s-maxage=1800, stale-while-revalidate=86400' : 'public, max-age=60, s-maxage=120',
    )
    res.status(200).json({ flight: info?.flight ?? null, groups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
