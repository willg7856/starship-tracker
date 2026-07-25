import type { VercelRequest, VercelResponse } from '@vercel/node'

/** GO AUSTRALIS — MarineTraffic shipid 4082265 */
const MMSI = '372112000'
const UPSTREAM = `https://www.myshiptracking.com/requests/vesselonmap.php?type=json&mmsi=${MMSI}`

const META = {
  name: 'GO AUSTRALIS',
  mmsi: MMSI,
  imo: '9725756',
  callsign: '3FUE8',
  shipid: 4082265,
  marinetrafficUrl:
    'https://www.marinetraffic.com/en/ais/details/ships/shipid:4082265',
}

/**
 * Parse MyShipTracking vesselonmap payload.
 * In-coverage JSON: { LAT, LNG, ... }
 * Out-of-coverage / alternate: "lat\\tlon\\tspeed\\tageMinutes\\t"
 */
function parsePosition(body: string): {
  latitude: number
  longitude: number
  speedKn: number | null
  ageMinutes: number | null
} | null {
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
    return {
      latitude,
      longitude,
      speedKn: Number.isFinite(Number(json.SPEED)) ? Number(json.SPEED) : null,
      ageMinutes: Number.isFinite(Number(json.AGE)) ? Number(json.AGE) : null,
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
  return { latitude, longitude, speedKn, ageMinutes }
}

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const upstream = await fetch(`${UPSTREAM}&t=${Date.now()}`, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent':
          'Mozilla/5.0 (compatible; BeyondStageZeroShip40Tracker/1.0)',
        Referer: 'https://www.myshiptracking.com/',
      },
      cache: 'no-store',
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `AIS upstream returned ${upstream.status}`,
        ...META,
      })
      return
    }

    const body = await upstream.text()
    const position = parsePosition(body)
    if (!position) {
      res.status(502).json({
        error: 'Could not parse AIS position',
        ...META,
      })
      return
    }

    const receivedAt =
      position.ageMinutes != null
        ? new Date(Date.now() - position.ageMinutes * 60_000).toISOString()
        : null

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60')
    res.status(200).json({
      ...META,
      latitude: position.latitude,
      longitude: position.longitude,
      speedKn: position.speedKn,
      ageMinutes: position.ageMinutes,
      receivedAt,
      fetchedAt: new Date().toISOString(),
      source: 'AIS (MyShipTracking)',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    res.status(502).json({ error: message, ...META })
  }
}
