import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchSpaceXTracker } from './_flight.js'

/** SpaceX's public vehicle tracker, passed through (see SPACEX_TRACKER_SOURCES). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { status, body } = await fetchSpaceXTracker()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', status === 200 ? 'public, max-age=1, s-maxage=2, stale-while-revalidate=5' : 'no-store')
    res.status(status).send(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
