/**
 * Live Starship coverage on YouTube, found automatically so the Watch
 * panel's stream picker needs no per-flight edits.
 *
 * Reads each channel's "Live" tab and keeps streams that are live now and
 * mention Starship. Flight coverage comes first (most viewers first), then
 * 24/7 pad cameras. Any failure just leaves that channel out: the page always
 * has SpaceX's own webcast.
 */

export type Stream = {
  id: string
  channel: string
  title: string
  viewers: number | null
  /** A 24/7 camera rather than flight coverage. */
  allDay: boolean
}

const CHANNELS: { handle: string; name: string }[] = [
  { handle: '@NASASpaceflight', name: 'NASASpaceflight' },
  { handle: '@EverydayAstronaut', name: 'Everyday Astronaut' },
  { handle: '@VideoFromSpace', name: 'Space.com' },
  { handle: '@TheLaunchPad', name: 'The Launch Pad' },
  { handle: '@LabPadre', name: 'LabPadre' },
]

const TTL_MS = 3 * 60_000
const PER_CHANNEL = 2
let cache: { at: number; streams: Stream[] } | null = null

function viewersFrom(text: string): number | null {
  const m = /([\d.,]+)\s*([KM]?)\s+watching/i.exec(text)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n * (m[2].toUpperCase() === 'K' ? 1e3 : m[2].toUpperCase() === 'M' ? 1e6 : 1))
}

type Lockup = { contentId?: string; metadata?: unknown }

function collectLockups(node: unknown, out: Lockup[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const v of node) collectLockups(v, out)
    return
  }
  const obj = node as Record<string, unknown>
  if (obj.lockupViewModel && typeof obj.lockupViewModel === 'object') {
    out.push(obj.lockupViewModel as Lockup)
  }
  for (const v of Object.values(obj)) collectLockups(v, out)
}

async function channelStreams(handle: string, name: string): Promise<Stream[]> {
  try {
    const res = await fetch(`https://www.youtube.com/${handle}/streams`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html)
    if (!m) return []
    const lockups: Lockup[] = []
    collectLockups(JSON.parse(m[1]), lockups)
    const found: Stream[] = []
    for (const l of lockups) {
      const id = l.contentId
      if (!id || !/^[\w-]{11}$/.test(id) || found.some((s) => s.id === id)) continue
      const meta = JSON.stringify(l.metadata ?? {})
      const title =
        (l.metadata as { lockupMetadataViewModel?: { title?: { content?: string } } })
          ?.lockupMetadataViewModel?.title?.content ?? ''
      const viewers = viewersFrom(meta)
      // Live now ("… watching"), about Starship or Starbase.
      if (viewers == null || !/starship|starbase|super heavy/i.test(title)) continue
      found.push({ id, channel: name, title, viewers, allDay: /24\/7|24-7|\blive cam|\bcam\b/i.test(title) })
    }
    // The channel's best flight stream (and its best 24/7 camera).
    const event = found.filter((s) => !s.allDay).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
    const cams = found.filter((s) => s.allDay).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
    return [...event.slice(0, PER_CHANNEL), ...cams.slice(0, 1)]
  } catch {
    return []
  }
}

export async function liveStarshipStreams(): Promise<Stream[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.streams
  const lists = await Promise.all(CHANNELS.map((c) => channelStreams(c.handle, c.name)))
  const all = lists.flat()
  const streams = [
    ...all.filter((s) => !s.allDay).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0)),
    ...all.filter((s) => s.allDay).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0)).slice(0, 2),
  ]
  // Keep the last good list if YouTube briefly fails for every channel.
  if (streams.length || !cache) cache = { at: Date.now(), streams }
  return cache.streams
}
