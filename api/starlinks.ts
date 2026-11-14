import type { VercelRequest, VercelResponse } from '@vercel/node'
import { starlinkTles } from './_starlinks.js'

/** Every active Starlink satellite's orbit, as TLE line pairs (see _starlinks.ts). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const data = await starlinkTles()
    if (!data) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(502).json({ error: 'Starlink orbits unavailable' })
      return
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('X-Satellite-Count', String(data.count))
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400')
    res.status(200).send(data.body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
