/**
 * Orbits of every active Starlink satellite (Celestrak's "starlink" group),
 * for the map's "All Starlinks" layer. Returned as plain TLE line pairs
 * (no names) to keep the ~10,000-satellite list small.
 *
 * Celestrak updates these every few hours and asks clients not to download
 * them more often than that, so the list is cached for 2 hours here and on
 * the CDN.
 */
const SOURCE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle'
const TTL_MS = 2 * 3600_000

let cache: { at: number; body: string; count: number } | null = null

/** Strip names: keep only line 1 / line 2 of each element set. */
function compact(tle: string): { body: string; count: number } {
  const lines = tle.split(/\r?\n/).map((l) => l.trimEnd())
  const out: string[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
      out.push(lines[i], lines[i + 1])
      i++
    }
  }
  return { body: out.join('\n'), count: out.length / 2 }
}

export async function starlinkTles(): Promise<{ body: string; count: number } | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(SOURCE, { headers: { Accept: 'text/plain' } })
      if (!res.ok) continue
      const { body, count } = compact(await res.text())
      if (count > 100) {
        cache = { at: Date.now(), body, count }
        return cache
      }
    } catch {
      /* retry */
    }
  }
  // Serve the previous list rather than nothing if Celestrak is unreachable.
  return cache
}
