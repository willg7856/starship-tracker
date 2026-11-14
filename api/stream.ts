import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverFlight, fetchSpaceXTracker } from './_flight.js'

/**
 * Live SpaceX tracker updates as Server-Sent Events.
 *
 * Instead of every viewer polling /api/tracker, each viewer holds one
 * connection open. Each server instance fetches SpaceX's tracker once every
 * couple of seconds for all of its viewers (with Fluid compute one instance
 * serves many connections) and pushes the data only when it changes. A
 * connection lasts a few minutes, then the browser reconnects on its own.
 *
 * Events: `tracker` (SpaceX's JSON, sent on connect and on every change),
 * `flight` (the /api/flight info: countdown, holds, timeline, site build;
 * on connect and on every change, checked every 20 s), `ping` (every 15 s,
 * so the page can tell a dead connection from a quiet one).
 */

const UPSTREAM_POLL_MS = 2_000
const PING_MS = 15_000
const FLIGHT_POLL_MS = 20_000
// Under the function's 300 s limit, so the server closes it cleanly.
const CONNECTION_MS = 270_000

type Viewer = (chunk: string) => void

const viewers = new Set<Viewer>()
let latest: string | null = null
// When `latest` was last confirmed current by an upstream fetch.
let checkedAt = 0
let timer: ReturnType<typeof setInterval> | null = null
let inFlight: Promise<void> | null = null
let latestFlight: string | null = null
let flightCheckedAt = 0
let flightInFlight: Promise<void> | null = null

function broadcast(chunk: string) {
  for (const send of viewers) send(chunk)
}

function trackerEvent(body: string): string {
  return `event: tracker\ndata: ${body}\n\n`
}

/** One upstream fetch for every viewer on this instance. */
function pollUpstream(): Promise<void> {
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const { status, body } = await fetchSpaceXTracker()
        if (status !== 200) return
        checkedAt = Date.now()
        // One line per SSE data field: re-serialise to drop any newlines.
        const compact = JSON.stringify(JSON.parse(body))
        if (compact === latest) return
        latest = compact
        broadcast(trackerEvent(compact))
      } catch {
        /* keep the last good data; the next poll retries */
      } finally {
        inFlight = null
      }
    })()
  }
  return inFlight
}

function flightEvent(body: string): string {
  return `event: flight\ndata: ${body}\n\n`
}

/** Flight info (holds, T-0 moves, new deploys) for every viewer. */
function pollFlight(): Promise<void> {
  if (!flightInFlight) {
    flightInFlight = (async () => {
      try {
        const info = await discoverFlight()
        if (!info) return
        flightCheckedAt = Date.now()
        const body = JSON.stringify(info)
        if (body === latestFlight) return
        latestFlight = body
        broadcast(flightEvent(body))
      } catch {
        /* keep the last good info */
      } finally {
        flightInFlight = null
      }
    })()
  }
  return flightInFlight
}

function startPolling() {
  if (timer) return
  timer = setInterval(() => {
    if (!viewers.size) {
      clearInterval(timer!)
      timer = null
      return
    }
    void pollUpstream()
    if (Date.now() - flightCheckedAt >= FLIGHT_POLL_MS) void pollFlight()
  }, UPSTREAM_POLL_MS)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  await new Promise<void>((resolve) => {
    let closed = false
    const send: Viewer = (chunk) => {
      if (!closed) res.write(chunk)
    }
    const close = () => {
      if (closed) return
      closed = true
      viewers.delete(send)
      clearInterval(ping)
      clearTimeout(limit)
      try {
        res.end()
      } catch {
        /* already gone */
      }
      resolve()
    }

    send('retry: 2000\n\n')
    viewers.add(send)
    startPolling()
    // Fresh data goes out at once; after an idle spell, fetch first.
    if (latest && Date.now() - checkedAt < 2 * UPSTREAM_POLL_MS) send(trackerEvent(latest))
    else {
      const before = latest
      // A change is broadcast to this viewer too; otherwise send what we have.
      void pollUpstream().then(() => {
        if (latest && latest === before) send(trackerEvent(latest))
      })
    }

    if (latestFlight && Date.now() - flightCheckedAt < 2 * FLIGHT_POLL_MS) send(flightEvent(latestFlight))
    else {
      const before = latestFlight
      void pollFlight().then(() => {
        if (latestFlight && latestFlight === before) send(flightEvent(latestFlight))
      })
    }

    const ping = setInterval(() => send(`event: ping\ndata: ${Date.now()}\n\n`), PING_MS)
    const limit = setTimeout(close, CONNECTION_MS)
    req.on('close', close)
  })
}
