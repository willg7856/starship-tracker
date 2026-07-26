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

    // Keep Vercel Web Analytics working while the hostname is served by this Worker.
    if (pathname.startsWith('/_vercel/insights/')) {
      return proxyVercelInsights(request)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
