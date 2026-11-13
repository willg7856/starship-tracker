import type { VercelRequest, VercelResponse } from '@vercel/node'

const MISSIONS =
  'https://content.spacex.com/cms-assets/future_missions.json'
const TILES =
  'https://content.spacex.com/api/spacex-website/launches-page-tiles/upcoming'
const MISSION_PAGE =
  'https://content.spacex.com/api/spacex-website/missions/starship-flight-15'

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
    const planned = await readFlightLiftoff()
    if (!planned) {
      res.status(502).json({ error: 'SpaceX has no Flight 15 T-0' })
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

async function readFlightLiftoff() {
  const [missionsRes, tilesRes] = await Promise.all([
    fetch(`${MISSIONS}?t=${Date.now()}`, { headers: { Accept: 'application/json' } }),
    fetch(TILES, { headers: { Accept: 'application/json' } }),
  ])
  if (!missionsRes.ok) throw new Error(`SpaceX timings returned ${missionsRes.status}`)
  if (!tilesRes.ok) throw new Error(`SpaceX launches returned ${tilesRes.status}`)

  const missions = (await missionsRes.json()) as Record<string, MissionTiming>
  const tiles = (await tilesRes.json()) as LaunchTile[]
  const tile = tiles.find(
    (item) => item.link === 'starship-flight-15' || item.title === 'Starship Flight 15',
  )
  const timing = tile?.correlationId ? missions[tile.correlationId] : undefined
  const seconds = timing?.TZeroLaunchDate?.Seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return {
    plannedLiftoff: new Date(seconds * 1000).toISOString().replace('.000Z', 'Z'),
    paused: timing?.TZeroPaused === true,
    landingMissionTime: await readLandingMissionTime(),
  }
}

type TimelineEntry = { time?: string; description?: string }

/** T+ seconds of the landing in SpaceX's published flight timeline. */
async function readLandingMissionTime(): Promise<number | null> {
  try {
    const res = await fetch(MISSION_PAGE, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const page = (await res.json()) as {
      postLaunchTimeline?: { timelineEntries?: TimelineEntry[] }
    }
    const entries = page.postLaunchTimeline?.timelineEntries ?? []
    const landing = [...entries]
      .reverse()
      .find((e) => /catch|splashdown|landing burn shutdown/i.test(e.description ?? ''))
    const parts = landing?.time?.split(':').map(Number)
    if (!parts || parts.length !== 3 || !parts.every(Number.isFinite)) return null
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  } catch {
    return null
  }
}
