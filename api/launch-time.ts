import type { VercelRequest, VercelResponse } from '@vercel/node'

const MISSIONS =
  'https://content.spacex.com/cms-assets/future_missions.json'
const TILES =
  'https://content.spacex.com/api/spacex-website/launches-page-tiles/upcoming'

type LaunchTile = {
  title?: string
  link?: string
  correlationId?: string
}

type MissionTiming = {
  TZeroLaunchDate?: { Seconds?: number }
  TZeroPaused?: boolean | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const planned = await readFlight14Liftoff()
    if (!planned) {
      res.status(502).json({ error: 'SpaceX has no Flight 14 T-0' })
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15')
    res.status(200).json(planned)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message })
  }
}

async function readFlight14Liftoff() {
  const [missionsRes, tilesRes] = await Promise.all([
    fetch(`${MISSIONS}?t=${Date.now()}`, { headers: { Accept: 'application/json' } }),
    fetch(TILES, { headers: { Accept: 'application/json' } }),
  ])
  if (!missionsRes.ok) throw new Error(`SpaceX timings returned ${missionsRes.status}`)
  if (!tilesRes.ok) throw new Error(`SpaceX launches returned ${tilesRes.status}`)

  const missions = (await missionsRes.json()) as Record<string, MissionTiming>
  const tiles = (await tilesRes.json()) as LaunchTile[]
  const tile = tiles.find(
    (item) => item.link === 'starship-flight-14' || item.title === 'Starship Flight 14',
  )
  const timing = tile?.correlationId ? missions[tile.correlationId] : undefined
  const seconds = timing?.TZeroLaunchDate?.Seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return {
    plannedLiftoff: new Date(seconds * 1000).toISOString().replace('.000Z', 'Z'),
    paused: timing?.TZeroPaused === true,
  }
}
