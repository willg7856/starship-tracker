import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM =
  'https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json'

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const upstream = await fetch(`${UPSTREAM}?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `SpaceX tracker returned ${upstream.status}`,
      })
      return
    }

    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10')
    res.status(200).send(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}
