import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM =
  'https://data.space-notices.com/space-notices-data/trajectory/launch-starship-flight-14-ship-41-trajectory'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Ship trail returned ${upstream.status}`,
      })
      return
    }
    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15')
    res.status(200).send(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
