import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight } from './_flight.js'

/** The Starship flight being tracked, discovered from SpaceX's website. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const info = await discoverFlight()
    if (!info) {
      res.status(502).json({ error: 'SpaceX lists no Starship flight' })
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=60')
    res.status(200).json(info)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
