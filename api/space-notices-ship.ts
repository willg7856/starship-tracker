import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight } from './_flight.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const upstreamUrl = (await discoverFlight())?.shipFeedUrl
    if (!upstreamUrl) {
      res.status(404).json({ error: 'No ship known for this flight yet' })
      return
    }
    const upstream = await fetch(`${upstreamUrl}?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Space Notices ship feed returned ${upstream.status}`,
      })
      return
    }
    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30')
    res.status(200).send(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
