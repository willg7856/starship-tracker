import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM =
  'https://content.spacex.com/api/spacex-website/missions/starship-flight-13'

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Accept: 'application/json' },
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `SpaceX mission API returned ${upstream.status}`,
      })
      return
    }

    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
    res.status(200).send(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
