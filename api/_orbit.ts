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

export type Orbits = {
  /** Best orbit for the ship: its own catalogue entry, else the payload's. */
  best: OrbitInfo | null
  /** The Starlink batch the ship deployed (SpaceX supplemental orbit). */
  payload: (OrbitInfo & { name: string }) | null
}

let cache: { key: string; at: number; value: Orbits } | null = null

export async function discoverOrbits(
  flight: number,
  ship: number | null,
  plannedLiftoff: string | null,
): Promise<Orbits> {
  const empty: Orbits = { best: null, payload: null }
  const liftoffMs = Date.parse(plannedLiftoff ?? '')
  if (!Number.isFinite(liftoffMs) || Date.now() < liftoffMs) return empty
  const key = `${flight}/${liftoffMs}`
  // Celestrak asks clients not to re-download unchanged data often. A miss
  // (often a dropped connection) is retried after a minute.
  const ttl = cache?.value.best ? 10 * 60_000 : 60_000
  if (cache && cache.key === key && Date.now() - cache.at < ttl) return cache.value

  const name = `STARSHIP-${flight}`
  const shipLabel = ship ? `Ship ${ship}` : 'the ship'
  // All lookups at once: a cold start otherwise waits on them in turn.
  const [catalogued, supIndex] = await Promise.all([
    getJson<Omm[]>(`${GP}?NAME=${encodeURIComponent(name)}&FORMAT=json`),
    getText(SUP_INDEX),
  ])
  const shipOmm = newest(
    (Array.isArray(catalogued) ? catalogued : []).filter(
      (o) => String(o.OBJECT_NAME).toUpperCase() === name && belongsToFlight(o, liftoffMs),
    ),
  )

  const files = supIndex
    ? [...new Set([...supIndex.matchAll(/sup-gp\.php\?FILE=(starlink-g[\w-]+)/gi)].map((m) => m[1]))]
    : []
  const lists = await Promise.all(
    files
      .slice(0, 8)
      .map(async (file) => ({
        file,
        list: await getJson<Omm[]>(`${SUP}?FILE=${encodeURIComponent(file)}&FORMAT=json`),
      })),
  )
  let payloadOmm: Omm | null = null
  let payloadFile = ''
  for (const { file, list } of lists) {
    const pick = newest((Array.isArray(list) ? list : []).filter((o) => belongsToFlight(o, liftoffMs)))
    if (pick && (!payloadOmm || epochMs(pick) > epochMs(payloadOmm))) {
      payloadOmm = pick
      payloadFile = file
    }
  }
  const group = /starlink-g(\d+)-(\d+)/i.exec(payloadFile)
  const payload = payloadOmm
    ? {
        source: 'spacex-payload' as const,
        name: group ? `Starlink Group ${group[1]}-${group[2]}` : 'Starlink satellites',
        label: `from SpaceX's published orbit for the Starlink satellites ${shipLabel} deployed, which fly alongside it (via Celestrak)`,
        omm: payloadOmm,
      }
    : null

  const best: OrbitInfo | null = shipOmm
    ? {
        source: 'celestrak-ship',
        label: `from ${shipLabel}'s own orbit in the public satellite catalogue (${name}, via Celestrak)`,
        omm: shipOmm,
      }
    : payload

  const value = { best, payload }
  cache = { key, at: Date.now(), value }
  return value
}

/** Back-compat: just the best orbit for the ship. */
export async function discoverOrbit(
  flight: number,
  ship: number | null,
  plannedLiftoff: string | null,
): Promise<OrbitInfo | null> {
  return (await discoverOrbits(flight, ship, plannedLiftoff)).best
}
