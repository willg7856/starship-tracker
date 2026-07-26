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

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/tracker') {
      return proxyUpstream({
        upstream:
          'https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json',
        cacheControl: 'public, max-age=10, s-maxage=10',
        bustCache: true,
        errorLabel: 'SpaceX tracker',
      })
    }

    if (pathname === '/api/space-notices-ship40') {
      return proxyUpstream({
        upstream: 'https://data.space-notices.com/space-notices-data/ship-40',
        cacheControl: 'public, max-age=30, s-maxage=30',
        errorLabel: 'Space Notices ship-40 feed',
      })
    }

    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
