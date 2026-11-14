/**
 * Hazard areas (NOTAMs, navigational warnings, LNMs, TFRs) for a Starship
 * flight, read from its Space Notices page, so new flights need no
 * hand-built data file.
 *
 * The page is found through the Space Notices sitemap
 * (/entry/launch-starship-...-flight-<N>). Its notices are embedded in the
 * Next.js data stream; each has an id, category, reason, cancelled flag and
 * `areas` as rings of [lon, lat].
 *
 * Returned grouped for display: launch, re-entry (the planned return), and
 * contingency (backup return areas, when the flight also has a catch/primary
 * return group). Overlaps are merged in the browser.
 */

const SITEMAP = 'https://space-notices.com/sitemap.xml'
const ENTRY_BASE = 'https://space-notices.com/entry/'

export type HazardGroup = {
  id: 'hazard-launch' | 'hazard-reentry' | 'hazard-contingency'
  name: string
  /** Rings of [lat, lon]. */
  rings: number[][][]
}

type Notice = {
  id?: string
  category?: string
  reason?: string
  name?: string
  cancelled?: boolean
  areas?: number[][][]
}

async function getText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (starship-tracker)' } })
      if (res.ok) return await res.text()
      if (res.status === 404) return null
    } catch {
      /* retry */
    }
  }
  return null
}

let sitemapCache: { at: number; xml: string } | null = null
async function entryUrl(flight: number): Promise<string | null> {
  if (!sitemapCache || Date.now() - sitemapCache.at > 6 * 3600_000) {
    const xml = await getText(SITEMAP)
    if (xml) sitemapCache = { at: Date.now(), xml }
  }
  const xml = sitemapCache?.xml ?? ''
  const re = new RegExp(`/entry/(launch-starship[\\w-]*?-flight-${flight})(?=[<"/?])`, 'i')
  const m = re.exec(xml)
  return m ? ENTRY_BASE + m[1] : null
}

/** The Next.js flight-data chunks on the page, joined and unescaped. */
function payloadOf(html: string): string {
  const out: string[] = []
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      /* skip a malformed chunk */
    }
  }
  return out.join('')
}

/** Every notice object in the payload, by its id. */
function noticesIn(payload: string): Notice[] {
  const seen = new Map<string, Notice>()
  const re = /\{"id":"(?:notam|nav-warning|lnm|bnm|tfr)-/g
  let m: RegExpExecArray | null
  while ((m = re.exec(payload))) {
    // Find the matching closing brace, skipping strings.
    let depth = 0
    let inStr = false
    let end = -1
    for (let i = m.index; i < payload.length; i++) {
      const c = payload[i]
      if (inStr) {
        if (c === '\\') i++
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        end = i + 1
        break
      }
    }
    if (end < 0) continue
    try {
      const n = JSON.parse(payload.slice(m.index, end)) as Notice
      if (n.id) seen.set(n.id, n)
    } catch {
      /* skip */
    }
  }
  return [...seen.values()]
}

/** Mentions of other flight numbers ("FLIGHT 14", "FLT-14", "FT14"). */
function namesOtherFlight(text: string, flight: number): boolean {
  for (const m of text.matchAll(/\b(?:FLIGHT|FLT|FT)[\s-]?(\d{1,3})\b/gi)) {
    if (Number(m[1]) !== flight) return true
  }
  return false
}

const cache = new Map<number, { at: number; value: HazardGroup[] | null }>()

export async function discoverHazards(flight: number): Promise<HazardGroup[] | null> {
  const hit = cache.get(flight)
  if (hit && Date.now() - hit.at < (hit.value ? 30 * 60_000 : 2 * 60_000)) return hit.value

  let value: HazardGroup[] | null = null
  const url = await entryUrl(flight)
  const html = url ? await getText(url) : null
  if (html) {
    const notices = noticesIn(payloadOf(html)).filter((n) => {
      const text = `${n.reason ?? ''} ${n.name ?? ''}`
      return !n.cancelled && Array.isArray(n.areas) && n.areas.length && !namesOtherFlight(text, flight)
    })
    const hasCatchGroup = notices.some((n) => /catch/i.test(n.category ?? ''))
    const groups: Record<HazardGroup['id'], number[][][]> = {
      'hazard-launch': [],
      'hazard-reentry': [],
      'hazard-contingency': [],
    }
    for (const n of notices) {
      const cat = n.category ?? ''
      const id: HazardGroup['id'] = /^launch$/i.test(cat)
        ? 'hazard-launch'
        : !hasCatchGroup || /catch/i.test(cat)
          ? 'hazard-reentry'
          : 'hazard-contingency'
      for (const ring of n.areas ?? []) {
        const pts = ring
          .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => [p[1], p[0]])
        if (pts.length >= 3) groups[id].push(pts)
      }
    }
    const names: Record<HazardGroup['id'], string> = {
      'hazard-launch': `Flight ${flight} launch / ascent hazard areas`,
      'hazard-reentry': `Flight ${flight} re-entry hazard areas`,
      'hazard-contingency': `Flight ${flight} contingency re-entry areas`,
    }
    value = (Object.keys(groups) as HazardGroup['id'][])
      .filter((id) => groups[id].length)
      .map((id) => ({ id, name: names[id], rings: groups[id] }))
    if (!value.length) value = null
  }
  cache.set(flight, { at: Date.now(), value })
  return value
}
