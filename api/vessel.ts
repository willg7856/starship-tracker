import type { VercelRequest, VercelResponse } from '@vercel/node'

/** GO AUSTRALIS — MarineTraffic shipid 4082265 */
const MMSI = '372112000'
const MST_UPSTREAM = `https://www.myshiptracking.com/requests/vesselonmap.php?type=json&mmsi=${MMSI}`
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
/** Wait briefly for a live AIS fix; Vercel hobby limit is typically ~10s. */
const AISSTREAM_WAIT_MS = 8_000

export const config = {
  maxDuration: 15,
}

const META = {
  name: 'GO AUSTRALIS',
  mmsi: MMSI,
  imo: '9725756',
  callsign: '3FUE8',
  shipid: 4082265,
  marinetrafficUrl:
    'https://www.marinetraffic.com/en/ais/details/ships/shipid:4082265',
}

type Position = {
  latitude: number
  longitude: number
  speedKn: number | null
  ageMinutes: number | null
  receivedAt: string | null
  source: string
}

/** Last successful AISStream fix kept in-memory for warm serverless instances. */
let lastLiveFix: Position | null = null

async function dataToText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof Buffer) return data.toString('utf8')
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text()
  if (
    data &&
    typeof data === 'object' &&
    'arrayBuffer' in data &&
    typeof (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer ===
      'function'
  ) {
    const buf = await (
      data as { arrayBuffer: () => Promise<ArrayBuffer> }
    ).arrayBuffer()
    return Buffer.from(buf).toString('utf8')
  }
  return String(data)
}

function listenAisStream(
  apiKey: string,
  waitMs: number,
): Promise<Position | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Position | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // ignore
      }
      resolve(value)
    }

    const ws = new WebSocket(AISSTREAM_URL)
    const timer = setTimeout(() => finish(null), waitMs)

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FiltersShipMMSI: [MMSI],
          FilterMessageTypes: [
            'PositionReport',
            'StandardClassBPositionReport',
          ],
        }),
      )
    })

    ws.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(await dataToText(event.data)) as {
          ErrorMessage?: unknown
          MessageType?: string
          MetaData?: {
            MMSI?: number | string
            latitude?: number
            longitude?: number
            Latitude?: number
            Longitude?: number
            time_utc?: string
          }
          Message?: {
            PositionReport?: { Sog?: number; Latitude?: number; Longitude?: number }
            StandardClassBPositionReport?: {
              Sog?: number
              Latitude?: number
              Longitude?: number
            }
          }
        }

        if (msg.ErrorMessage) {
          finish(null)
          return
        }

        const meta = msg.MetaData
        if (!meta) return
        if (String(meta.MMSI) !== MMSI) return

        const report =
          msg.Message?.PositionReport ??
          msg.Message?.StandardClassBPositionReport
        const latitude = Number(meta.latitude ?? meta.Latitude ?? report?.Latitude)
        const longitude = Number(
          meta.longitude ?? meta.Longitude ?? report?.Longitude,
        )
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

        const speedKn =
          report?.Sog != null && Number.isFinite(Number(report.Sog))
            ? Number(report.Sog)
            : null

        let receivedAt: string | null = null
        let ageMinutes: number | null = 0
        if (meta.time_utc) {
          const parsed = Date.parse(meta.time_utc.replace(/ \+0000 UTC$/, 'Z'))
          if (Number.isFinite(parsed)) {
            receivedAt = new Date(parsed).toISOString()
            ageMinutes = Math.max(0, (Date.now() - parsed) / 60_000)
          }
        }

        const fix: Position = {
          latitude,
          longitude,
          speedKn,
          ageMinutes,
          receivedAt: receivedAt ?? new Date().toISOString(),
          source: 'AIS (AISStream)',
        }
        lastLiveFix = fix
        finish(fix)
      } catch {
        // ignore malformed frames
      }
    })

    ws.addEventListener('error', () => finish(null))
  })
}

/**
 * Parse MyShipTracking vesselonmap payload.
 * In-coverage JSON: { LAT, LNG, ... }
 * Out-of-coverage / alternate: "lat\\tlon\\tspeed\\tageMinutes\\t"
 */
function parseMstPosition(body: string): Position | null {
  const trimmed = body.trim()
  if (!trimmed || /^error$/i.test(trimmed)) return null

  try {
    const json = JSON.parse(trimmed) as {
      LAT?: string | number
      LNG?: string | number
      LON?: string | number
      SPEED?: string | number
      AGE?: string | number
    }
    const latitude = Number(json.LAT)
    const longitude = Number(json.LNG ?? json.LON)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    const ageMinutes = Number.isFinite(Number(json.AGE))
      ? Number(json.AGE)
      : null
    return {
      latitude,
      longitude,
      speedKn: Number.isFinite(Number(json.SPEED)) ? Number(json.SPEED) : null,
      ageMinutes,
      receivedAt:
        ageMinutes != null
          ? new Date(Date.now() - ageMinutes * 60_000).toISOString()
          : null,
      source: 'AIS (MyShipTracking)',
    }
  } catch {
    // fall through to TSV
  }

  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const latitude = Number(parts[0])
  const longitude = Number(parts[1])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const speedKn =
    parts.length >= 3 && Number.isFinite(Number(parts[2]))
      ? Number(parts[2])
      : null
  const ageMinutes =
    parts.length >= 4 && Number.isFinite(Number(parts[3]))
      ? Number(parts[3])
      : null
  return {
    latitude,
    longitude,
    speedKn,
    ageMinutes,
    receivedAt:
      ageMinutes != null
        ? new Date(Date.now() - ageMinutes * 60_000).toISOString()
        : null,
    source: 'AIS (MyShipTracking)',
  }
}

async function fetchMstFallback(): Promise<Position | null> {
  const upstream = await fetch(`${MST_UPSTREAM}&t=${Date.now()}`, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent':
        'Mozilla/5.0 (compatible; BeyondStageZeroShip40Tracker/1.0)',
      Referer: 'https://www.myshiptracking.com/',
    },
    cache: 'no-store',
  })
  if (!upstream.ok) return null
  return parseMstPosition(await upstream.text())
}

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const apiKey = process.env.AISSTREAM_API_KEY?.trim()
    let position: Position | null = null

    if (apiKey) {
      position = await listenAisStream(apiKey, AISSTREAM_WAIT_MS)
      // Reuse a very recent in-memory live fix if the stream was quiet this request.
      if (
        !position &&
        lastLiveFix &&
        lastLiveFix.ageMinutes != null &&
        lastLiveFix.ageMinutes < 30
      ) {
        position = {
          ...lastLiveFix,
          ageMinutes:
            lastLiveFix.receivedAt != null
              ? Math.max(
                  0,
                  (Date.now() - Date.parse(lastLiveFix.receivedAt)) / 60_000,
                )
              : lastLiveFix.ageMinutes,
        }
      }
    }

    if (!position) {
      position = await fetchMstFallback()
    }

    if (!position) {
      res.status(502).json({
        error: 'No AIS position available',
        ...META,
        aisstreamConfigured: Boolean(apiKey),
      })
      return
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30')
    res.status(200).json({
      ...META,
      latitude: position.latitude,
      longitude: position.longitude,
      speedKn: position.speedKn,
      ageMinutes: position.ageMinutes,
      receivedAt: position.receivedAt,
      fetchedAt: new Date().toISOString(),
      source: position.source,
      aisstreamConfigured: Boolean(apiKey),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message, ...META })
  }
}
