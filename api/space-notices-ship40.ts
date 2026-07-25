import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM =
  'https://data.space-notices.com/space-notices-data/ship-40'

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Space Notices ship-40 feed returned ${upstream.status}`,
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
