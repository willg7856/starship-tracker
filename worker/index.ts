type Env = { ASSETS: Fetcher }

type ProxyOptions = {
  upstream: string
  cacheControl: string
  bustCache?: boolean
  errorLabel: string
}

async function proxyUpstream({
  upstream,
  cacheControl,
  bustCache = false,
  errorLabel,
}: ProxyOptions): Promise<Response> {
  try {
    const url = bustCache ? `${upstream}?t=${Date.now()}` : upstream
    const upstreamRes = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!upstreamRes.ok) {
      return Response.json(
        { error: `${errorLabel} returned ${upstreamRes.status}` },
        { status: upstreamRes.status },
      )
    }
    const body = await upstreamRes.text()
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return Response.json({ error: message }, { status: 502 })
  }
}

const VERCEL_ANALYTICS_ORIGIN = 'https://starship-tracker-kappa.vercel.app'
const FLIGHT_MISSIONS =
  'https://content.spacex.com/cms-assets/future_missions.json'
const FLIGHT_TILES =
  'https://content.spacex.com/api/spacex-website/launches-page-tiles/upcoming'
const FLIGHT_MISSION_PAGE =
  'https://content.spacex.com/api/spacex-website/missions/starship-flight-15'

/** T+ seconds of the landing in SpaceX's published flight timeline. */
async function flightLandingMissionTime(): Promise<number | null> {
  try {
    const res = await fetch(FLIGHT_MISSION_PAGE, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const page = (await res.json()) as {
      postLaunchTimeline?: { timelineEntries?: Array<{ time?: string; description?: string }> }
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

async function flightLaunchTime(): Promise<Response> {
  try {
    const [missionsRes, tilesRes] = await Promise.all([
      fetch(`${FLIGHT_MISSIONS}?t=${Date.now()}`, {
        headers: { Accept: 'application/json' },
      }),
      fetch(FLIGHT_TILES, { headers: { Accept: 'application/json' } }),
    ])
    if (!missionsRes.ok || !tilesRes.ok) {
      return Response.json(
        { error: 'SpaceX launch time is unavailable' },
        { status: 502 },
      )
    }
    const missions = (await missionsRes.json()) as Record<
      string,
      { TZeroLaunchDate?: { Seconds?: number }; TZeroPaused?: boolean | null }
    >
    const tiles = (await tilesRes.json()) as Array<{
      title?: string
      link?: string
      correlationId?: string
    }>
    const tile = tiles.find(
      (item) => item.link === 'starship-flight-15' || item.title === 'Starship Flight 15',
    )
    const timing = tile?.correlationId ? missions[tile.correlationId] : undefined
    const seconds = timing?.TZeroLaunchDate?.Seconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      return Response.json({ error: 'SpaceX has no Flight 15 T-0' }, { status: 502 })
    }
    return Response.json(
      {
        plannedLiftoff: new Date(seconds * 1000).toISOString().replace('.000Z', 'Z'),
        paused: timing?.TZeroPaused === true,
        landingMissionTime: await flightLandingMissionTime(),
      },
      {
        headers: { 'Cache-Control': 'public, max-age=15, s-maxage=15' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return Response.json({ error: message }, { status: 502 })
  }
}

async function proxyVercelInsights(request: Request): Promise<Response> {
  const incoming = new URL(request.url)
  const upstream = new URL(
    `${incoming.pathname}${incoming.search}`,
    VERCEL_ANALYTICS_ORIGIN,
  )

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('host', upstream.host)

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    // @ts-expect-error duplex is required for streaming request bodies in Workers
    init.duplex = 'half'
  }
  const upstreamRes = await fetch(upstream, init)

  const responseHeaders = new Headers(upstreamRes.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  })
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/tracker') {
      return proxyUpstream({
        upstream:
          'https://content.spacex.com/cms-assets/starship_tracker_public.json',
        cacheControl: 'public, max-age=1, s-maxage=1',
        bustCache: true,
        errorLabel: 'SpaceX tracker',
      })
    }

    if (pathname === '/api/launch-time') {
      return flightLaunchTime()
    }

    if (pathname === '/api/ship-trail') {
      return proxyUpstream({
        upstream:
          'https://data.space-notices.com/space-notices-data/trajectory/launch-starship-flight-15-ship-42-trajectory',
        cacheControl: 'public, max-age=15, s-maxage=15',
        errorLabel: 'Ship trail',
      })
    }

    if (pathname === '/api/space-notices-ship') {
      return proxyUpstream({
        upstream: 'https://data.space-notices.com/space-notices-data/ship-42',
        cacheControl: 'public, max-age=30, s-maxage=30',
        errorLabel: 'Space Notices ship-42 feed',
      })
    }

    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Keep Vercel Web Analytics working while the hostname is served by this Worker.
    if (pathname.startsWith('/_vercel/insights/')) {
      return proxyVercelInsights(request)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
