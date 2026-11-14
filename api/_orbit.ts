/**
 * Best available orbit for the current flight's ship, for when SpaceX's live
 * vehicle tracker is off. Returned as a CCSDS OMM (Celestrak JSON), which the
 * page propagates with SGP4 to get position, altitude and speed.
 *
 * In order of preference:
 *  1. celestrak-ship: the ship itself in the public catalogue, named
 *     "STARSHIP-<flight>" (Flight 14's was STARSHIP-14, catalogued the same day).
 *  2. spacex-payload: SpaceX's own supplemental orbit for the Starlink batch
 *     the ship deployed on this flight (Celestrak SupGP "starlink-gNN-N"
 *     files). The batch flies in formation with the ship for the whole flight.
 *  3. null: the page falls back to a modelled orbit.
 */

const GP = 'https://celestrak.org/NORAD/elements/gp.php'
const SUP_INDEX = 'https://celestrak.org/NORAD/elements/supplemental/'
const SUP = 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php'

export type Omm = Record<string, string | number>
export type OrbitInfo = {
  source: 'celestrak-ship' | 'spacex-payload'
  label: string
  omm: Omm
}

/** Fetch text, retrying once: Celestrak connections occasionally reset. */
async function getText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json, text/html' } })
      if (res.ok) return await res.text()
      if (res.status === 404) return null
    } catch {
      /* retry */
    }
  }
  return null
}

async function getJson<T>(url: string): Promise<T | null> {
  const text = await getText(url)
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

function epochMs(omm: Omm): number {
  const raw = String(omm.EPOCH ?? '')
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`)
}

/** Elements fitted after liftoff and before the flight's end. */
function belongsToFlight(omm: Omm, liftoffMs: number): boolean {
  const t = epochMs(omm)
  return Number.isFinite(t) && t > liftoffMs + 5 * 60_000 && t < liftoffMs + 48 * 3600_000
}

function newest(list: Omm[]): Omm | null {
  return [...list].sort((a, b) => epochMs(b) - epochMs(a))[0] ?? null
}

let cache: { key: string; at: number; value: OrbitInfo | null } | null = null

export async function discoverOrbit(
  flight: number,
  ship: number | null,
  plannedLiftoff: string | null,
): Promise<OrbitInfo | null> {
  const liftoffMs = Date.parse(plannedLiftoff ?? '')
  if (!Number.isFinite(liftoffMs) || Date.now() < liftoffMs) return null
  const key = `${flight}/${liftoffMs}`
  // Celestrak asks clients not to re-download unchanged data often. A miss
  // (often a dropped connection) is retried after a minute.
  const ttl = cache?.value ? 10 * 60_000 : 60_000
  if (cache && cache.key === key && Date.now() - cache.at < ttl) return cache.value

  let value: OrbitInfo | null = null

  const name = `STARSHIP-${flight}`
  const catalogued = await getJson<Omm[]>(`${GP}?NAME=${encodeURIComponent(name)}&FORMAT=json`)
  const shipOmm = newest(
    (Array.isArray(catalogued) ? catalogued : []).filter(
      (o) => String(o.OBJECT_NAME).toUpperCase() === name && belongsToFlight(o, liftoffMs),
    ),
  )
  if (shipOmm) {
    value = {
      source: 'celestrak-ship',
      label: `from ${ship ? `Ship ${ship}` : 'the ship'}'s own orbit in the public satellite catalogue (${name}, via Celestrak)`,
      omm: shipOmm,
    }
  }

  if (!value) {
    let files: string[] = []
    const html = await getText(SUP_INDEX)
    if (html) {
      files = [...new Set([...html.matchAll(/sup-gp\.php\?FILE=(starlink-g[\w-]+)/gi)].map((m) => m[1]))]
    }
    const found: Omm[] = []
    for (const file of files.slice(0, 8)) {
      const list = await getJson<Omm[]>(`${SUP}?FILE=${encodeURIComponent(file)}&FORMAT=json`)
      for (const o of Array.isArray(list) ? list : []) {
        if (belongsToFlight(o, liftoffMs)) found.push({ ...o, _FILE: file })
      }
    }
    const payloadOmm = newest(found)
    if (payloadOmm) {
      value = {
        source: 'spacex-payload',
        label: `from SpaceX's published orbit for the Starlink satellites ${ship ? `Ship ${ship}` : 'the ship'} deployed, which fly alongside it (via Celestrak)`,
        omm: payloadOmm,
      }
    }
  }

  cache = { key, at: Date.now(), value }
  return value
}
