import type { VercelRequest, VercelResponse } from '@vercel/node'
import { liveStarshipStreams } from './_streams.js'

/** Live Starship streams on YouTube, for the Watch panel's stream picker. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const streams = await liveStarshipStreams()
  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=180, stale-while-revalidate=600')
  res.status(200).json({ streams })
}
