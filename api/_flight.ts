/**
 * Work out which Starship flight to track, from SpaceX's own website data,
 * so a new flight needs no code change.
 *
 * - Flights: SpaceX launch tiles whose link is `starship-flight-N`.
 * - T-0: `future_missions.json` (live countdown), else the tile's launch
 *   date/time, which SpaceX gives in Starbase local (US Central) time.
 * - Current flight: one whose T-0 was within the last 36h (still flying or
 *   just landed), else the next upcoming one.
 * - Ship: the `shipNN` vehicle in SpaceX's live tracker, else the Ship NN in
 *   the Space Notices trajectory for that flight.
 * - Landing time and kind: the end of SpaceX's published flight timeline.
 *
 * Files starting with `_` are not Vercel routes; the Worker imports this too.
 */

const CMS = 'https://content.spacex.com'
const MISSIONS = `${CMS}/cms-assets/future_missions.json`
const UPCOMING_TILES = `${CMS}/api/spacex-website/launches-page-tiles/upcoming`
const ALL_TILES = `${CMS}/api/spacex-website/launches-page-tiles`
const MISSION_PAGE = `${CMS}/api/spacex-website/missions/`
export const SPACEX_TRACKER = `${CMS}/cms-assets/starship_tracker_public.json`
const NOTICES = 'https://data.space-notices.com/space-notices-data'

const RECENT_MS = 36 * 3600 * 1000
const FLIGHT_LINK = /^starship-flight-(\d+)$/

export type FlightInfo = {
  flight: number
  slug: string
  title: string
  ship: number | null
  plannedLiftoff: string | null
  paused: boolean
  landingMissionTime: number | null
  landingKind: 'catch' | 'splashdown' | 'landing' | null
  pad: { lat: number; lon: number } | null
  trajectoryUrl: string | null
  shipFeedUrl: string | null
  /** SpaceX's published event schedule, seconds from liftoff (negative = countdown). */
  timeline: { t: number; label: string }[]
  /** Official SpaceX webcast, when the mission page lists one. */
  webcastUrl: string | null
  /** Embeddable player for the official webcast (as spacex.com embeds it). */
  webcastEmbedUrl: string | null
}

type Webcast = { videoId?: string; streamingVideoType?: string }

/** The webcast SpaceX features: the only one, or the one marked featured. */
function featuredWebcast(webcasts: Webcast[] | undefined): Webcast | null {
  const list = (webcasts ?? []).filter((w) => /^[\w-]+$/.test(w.videoId?.trim() ?? ''))
  if (list.length <= 1) return list[0] ?? null
  return list.find((w) => (w as { isFeatured?: boolean }).isFeatured) ?? list[0]
}

/**
 * Same mapping spacex.com uses for its webcast overlay: X Live Studio
 * broadcasts embed from studio.x.com (served with frame-ancestors *).
 */
function webcastEmbedUrl(webcasts: Webcast[] | undefined): string | null {
  const w = featuredWebcast(webcasts)
  if (!w) return null
  const id = encodeURIComponent(w.videoId!.trim())
  const type = (w.streamingVideoType ?? '').toLowerCase()
  if (type === 'x-live-studio') return `https://studio.x.com/embed/broadcast/${id}`
  if (type === 'youtube') return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`
  return null
}

function webcastUrl(webcasts: Webcast[] | undefined): string | null {
  for (const w of webcasts ?? []) {
    const id = w.videoId?.trim()
    if (!id || !/^[\w-]+$/.test(id)) continue
    const type = (w.streamingVideoType ?? '').toLowerCase()
    if (type.startsWith('x')) return `https://x.com/i/broadcasts/${id}`
    if (type.includes('youtube')) return `https://www.youtube.com/watch?v=${id}`
  }
  return null
}

function timelineFrom(pre: Timeline[], post: Timeline[]): { t: number; label: string }[] {
  const events: { t: number; label: string }[] = []
  for (const [entries, sign] of [[pre, -1], [post, 1]] as const) {
    for (const e of entries) {
      const secs = parseHms(e.time)
      const label = (e.description ?? '').trim()
      if (secs == null || !label) continue
      // The countdown's T-0 line duplicates Liftoff in the flight timeline.
      if (sign < 0 && secs === 0 && post.length) continue
      events.push({ t: sign * secs, label })
    }
  }
  return events.sort((a, b) => a.t - b.t)
}

type Tile = {
  title?: string
  link?: string
  correlationId?: string | null
  launchDate?: string | null
  launchTime?: string | null
}
type Timing = { TZeroLaunchDate?: { Seconds?: number }; TZeroPaused?: boolean | null }
type Timeline = { time?: string; description?: string }

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** The full tile list is large and only changes after a launch. */
let allTilesCache: { at: number; tiles: Tile[] } | null = null
async function allStarshipTiles(): Promise<Tile[]> {
  if (allTilesCache && Date.now() - allTilesCache.at < 10 * 60 * 1000) {
    return allTilesCache.tiles
  }
  const tiles = (await getJson<Tile[]>(ALL_TILES)) ?? []
  const starship = tiles.filter((t) => FLIGHT_LINK.test(t.link ?? ''))
  if (starship.length) allTilesCache = { at: Date.now(), tiles: starship }
  return starship
}

/** Wall-clock date + time in US Central -> epoch ms. */
function centralToMs(date: string, time: string): number | null {
  const guess = Date.parse(`${date}T${time}Z`)
  if (!Number.isFinite(guess)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return guess - (asIfUtc - guess)
}

function parseHms(value: string | undefined): number | null {
  const parts = value?.split(':').map(Number)
  if (!parts || parts.length !== 3 || !parts.every(Number.isFinite)) return null
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

async function hasTrajectory(flight: number, ship: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${NOTICES}/trajectory/launch-starship-flight-${flight}-ship-${ship}-trajectory`,
      { headers: { Accept: 'application/json' } },
    )
    return res.ok
  } catch {
    return false
  }
}

/** Probe Space Notices for the ship number on this flight's trajectory. */
const shipCache = new Map<number, { at: number; ship: number | null }>()
async function shipFromNotices(flight: number): Promise<number | null> {
  const hit = shipCache.get(flight)
  if (hit && Date.now() - hit.at < (hit.ship ? 6 * 3600_000 : 5 * 60_000)) return hit.ship
  // Ship numbers have run 27 ahead of flight numbers (Flight 14 / Ship 41,
  // Flight 15 / Ship 42). Look near that first.
  const base = flight + 27
  const candidates = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, 6, 7, 8].map((d) => base + d)
  const found = await Promise.all(
    candidates.map(async (ship) => {
      try {
        const res = await fetch(
          `${NOTICES}/trajectory/launch-starship-flight-${flight}-ship-${ship}-trajectory`,
          { headers: { Accept: 'application/json' } },
        )
        return res.ok ? ship : null
      } catch {
        return null
      }
    }),
  )
  const ship = found.find((s) => s != null) ?? null
  shipCache.set(flight, { at: Date.now(), ship })
  return ship
}

/** One live `shipNN` in SpaceX's tracker, if there is exactly one. */
async function shipFromTracker(): Promise<number | null> {
  const raw = await getJson<Record<string, { current?: unknown }>>(`${SPACEX_TRACKER}?t=${Date.now()}`)
  if (!raw || typeof raw !== 'object') return null
  const ships = Object.keys(raw)
    .map((k) => /^ship(\d+)$/i.exec(k))
    .filter((m): m is RegExpExecArray => !!m && !!raw[m[0]]?.current)
  return ships.length === 1 ? Number(ships[0][1]) : null
}

/** Where the ship sat before it first climbed above 200 m. */
async function padFromTrajectory(url: string): Promise<{ lat: number; lon: number } | null> {
  const body = await getJson<{ coordinates?: unknown[] }>(url)
  const coords = Array.isArray(body?.coordinates) ? body.coordinates : []
  let pad: { lat: number; lon: number } | null = null
  for (const c of coords) {
    if (!Array.isArray(c)) continue
    const [lon, lat, alt] = c as number[]
    if (![lon, lat, alt].every(Number.isFinite)) continue
    if (alt >= 200) break
    pad = { lat, lon }
  }
  return pad
}

let infoCache: { at: number; info: FlightInfo } | null = null

export async function discoverFlight(): Promise<FlightInfo | null> {
  if (infoCache && Date.now() - infoCache.at < 10_000) return infoCache.info

  const [missions, upcoming, past, trackerShip] = await Promise.all([
    getJson<Record<string, Timing>>(`${MISSIONS}?t=${Date.now()}`),
    getJson<Tile[]>(UPCOMING_TILES),
    allStarshipTiles(),
    shipFromTracker(),
  ])

  const byFlight = new Map<number, Tile>()
  for (const tile of [...past, ...(upcoming ?? [])]) {
    const m = FLIGHT_LINK.exec(tile.link ?? '')
    if (m) byFlight.set(Number(m[1]), { ...byFlight.get(Number(m[1])), ...tile })
  }
  if (!byFlight.size) return null

  const now = Date.now()
  const flights = [...byFlight.entries()].map(([flight, tile]) => {
    const timing = tile.correlationId ? missions?.[tile.correlationId] : undefined
    const seconds = timing?.TZeroLaunchDate?.Seconds
    let liftoffMs =
      typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null
    if (liftoffMs == null && tile.launchDate && tile.launchTime) {
      liftoffMs = centralToMs(tile.launchDate, tile.launchTime)
    }
    return { flight, tile, liftoffMs, paused: timing?.TZeroPaused === true }
  })

  const recent = flights
    .filter((f) => f.liftoffMs != null && f.liftoffMs <= now && now - f.liftoffMs < RECENT_MS)
    .sort((a, b) => b.flight - a.flight)[0]
  const upcomingFlights = new Set(
    (upcoming ?? []).map((t) => Number(FLIGHT_LINK.exec(t.link ?? '')?.[1])).filter(Number.isFinite),
  )
  const next = flights
    .filter((f) => upcomingFlights.has(f.flight))
    .sort((a, b) => a.flight - b.flight)[0]
  let pick = recent ?? next ?? [...flights].sort((a, b) => b.flight - a.flight)[0]

  // A ship live in SpaceX's tracker keeps its own flight, even if SpaceX has
  // already moved that flight off the upcoming list without a launch time.
  if (!recent && trackerShip) {
    const newest = [...flights].sort((a, b) => b.flight - a.flight).slice(0, 4)
    for (const f of newest) {
      if (f === pick) continue
      if (await hasTrajectory(f.flight, trackerShip)) {
        if (!(await hasTrajectory(pick.flight, trackerShip))) pick = f
        break
      }
    }
  }

  const slug = `starship-flight-${pick.flight}`
  const page = await getJson<{
    title?: string
    preLaunchTimeline?: { timelineEntries?: Timeline[] }
    postLaunchTimeline?: { timelineEntries?: Timeline[] }
    webcasts?: Webcast[]
  }>(MISSION_PAGE + slug)
  const ship = trackerShip ?? (await shipFromNotices(pick.flight))

  const timeline = page?.postLaunchTimeline?.timelineEntries ?? []
  const last = timeline[timeline.length - 1]
  const ending = timeline.slice(-3).map((e) => e.description ?? '').join(' ')
  const landingKind = !last
    ? null
    : /catch/i.test(ending)
      ? 'catch'
      : /splash/i.test(ending)
        ? 'splashdown'
        : 'landing'

  const trajectoryUrl = ship
    ? `${NOTICES}/trajectory/launch-starship-flight-${pick.flight}-ship-${ship}-trajectory`
    : null

  const info: FlightInfo = {
    flight: pick.flight,
    slug,
    title: page?.title || pick.tile.title || `Starship Flight ${pick.flight}`,
    ship,
    plannedLiftoff:
      pick.liftoffMs != null
        ? new Date(pick.liftoffMs).toISOString().replace('.000Z', 'Z')
        : null,
    paused: pick.paused,
    landingMissionTime: parseHms(last?.time),
    landingKind,
    pad: trajectoryUrl ? await padFromTrajectory(trajectoryUrl) : null,
    trajectoryUrl,
    shipFeedUrl: ship ? `${NOTICES}/ship-${ship}` : null,
    timeline: timelineFrom(page?.preLaunchTimeline?.timelineEntries ?? [], timeline),
    webcastUrl: webcastUrl(page?.webcasts),
    webcastEmbedUrl: webcastEmbedUrl(page?.webcasts),
  }
  infoCache = { at: Date.now(), info }
  return info
}
