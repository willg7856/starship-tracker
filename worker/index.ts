import { discoverFlight, fetchSpaceXTracker } from '../api/_flight.js'
import { discoverOrbits } from '../api/_orbit.js'
import { discoverHazards } from '../api/_hazards.js'
import { starlinkTles } from '../api/_starlinks.js'

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

async function flightInfo(): Promise<Response> {
  try {
    const info = await discoverFlight()
    if (!info) {
      return Response.json({ error: 'SpaceX lists no Starship flight' }, { status: 502 })
    }
    return Response.json(info, {
      headers: { 'Cache-Control': 'public, max-age=15, s-maxage=15, stale-while-revalidate=60' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return Response.json({ error: message }, { status: 502 })
  }
}

async function flightLaunchTime(): Promise<Response> {
  try {
    const info = await discoverFlight()
    if (!info?.plannedLiftoff) {
      return Response.json({ error: 'SpaceX has no Starship T-0' }, { status: 502 })
    }
    return Response.json(
      {
        plannedLiftoff: info.plannedLiftoff,
        paused: info.paused,
        landingMissionTime: info.landingMissionTime,
        flight: info.flight,
      },
      { headers: { 'Cache-Control': 'public, max-age=15, s-maxage=15, stale-while-revalidate=60' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return Response.json({ error: message }, { status: 502 })
  }
}

async function proxyDiscovered(
  field: 'trajectoryUrl' | 'shipFeedUrl',
  cacheControl: string,
  errorLabel: string,
): Promise<Response> {
  const upstream = (await discoverFlight().catch(() => null))?.[field]
  if (!upstream) {
    return Response.json({ error: 'No ship known for this flight yet' }, { status: 404 })
  }
  return proxyUpstream({ upstream, cacheControl, bustCache: true, errorLabel })
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
      const { status, body } = await fetchSpaceXTracker()
      return new Response(body, {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': status === 200 ? 'public, max-age=1, s-maxage=2, stale-while-revalidate=5' : 'no-store',
        },
      })
    }

    if (pathname === '/api/launch-time') {
      return flightLaunchTime()
    }

    if (pathname === '/api/flight') {
      return flightInfo()
    }

    if (pathname === '/api/orbit') {
      try {
        const info = await discoverFlight()
        const { best: orbit, payload } = info
          ? await discoverOrbits(info.flight, info.ship, info.plannedLiftoff)
          : { best: null, payload: null }
        return Response.json(
          { flight: info?.flight ?? null, orbit, payload },
          {
            headers: {
              'Cache-Control': orbit
                ? 'public, max-age=300, s-maxage=900'
                : 'public, max-age=60, s-maxage=60',
            },
          },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upstream fetch failed'
        return Response.json({ error: message }, { status: 502 })
      }
    }

    if (pathname === '/api/ship-trail') {
      return proxyDiscovered('trajectoryUrl', 'public, max-age=15, s-maxage=15, stale-while-revalidate=60', 'Ship trail')
    }

    if (pathname === '/api/starlinks') {
      const data = await starlinkTles()
      if (!data) return Response.json({ error: 'Starlink orbits unavailable' }, { status: 502 })
      return new Response(data.body, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Satellite-Count': String(data.count),
          'Cache-Control': 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400',
        },
      })
    }

    if (pathname === '/api/hazards') {
      try {
        const info = await discoverFlight()
        const groups = info ? await discoverHazards(info.flight) : null
        return Response.json(
          { flight: info?.flight ?? null, groups },
          {
            headers: {
              'Cache-Control': groups
                ? 'public, max-age=600, s-maxage=1800'
                : 'public, max-age=60, s-maxage=120',
            },
          },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upstream fetch failed'
        return Response.json({ error: message }, { status: 502 })
      }
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
