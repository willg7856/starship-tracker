/**
 * Every active Starlink satellite (~10,000), for the map's "All Starlinks"
 * layer: orbits from /api/starlinks (Celestrak, cached 2 h), propagated
 * with SGP4 in the browser. Loaded only when the layer is first switched on.
 */
import * as sat from './vendor/satellite.es.js'

let satrecs = null
let loading = null

/** Parse TLE line pairs into satrecs, in batches so the page stays responsive. */
async function parse(text) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    try {
      const rec = sat.twoline2satrec(lines[i], lines[i + 1])
      if (rec && !rec.error) out.push(rec)
    } catch {
      /* skip a bad element set */
    }
    if (i % 2000 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

/** Load (once) and return how many satellites are available. */
export async function loadAllStarlinks() {
  if (satrecs) return satrecs.length
  if (!loading) {
    loading = (async () => {
      const res = await fetch('/api/starlinks')
      if (!res.ok) throw new Error(`Starlink orbits returned ${res.status}`)
      satrecs = await parse(await res.text())
      return satrecs.length
    })().catch((err) => {
      loading = null
      throw err
    })
  }
  return loading
}

/**
 * Positions of every satellite at `ms` as a flat Float32Array
 * [lat0, lon0, lat1, lon1, ...] (degrees). Satellites that fail to
 * propagate (decayed, bad elements) are left out.
 */
export function allStarlinkPositions(ms = Date.now()) {
  if (!satrecs) return new Float32Array(0)
  const date = new Date(ms)
  const gmst = sat.gstime(date)
  const out = new Float32Array(satrecs.length * 2)
  let n = 0
  for (const rec of satrecs) {
    const pv = sat.propagate(rec, date)
    const pos = pv?.position
    if (!pos || typeof pos === 'boolean') continue
    const gd = sat.eciToGeodetic(pos, gmst)
    if (!(gd.height > 150 && gd.height < 2500)) continue
    out[n++] = sat.degreesLat(gd.latitude)
    out[n++] = sat.degreesLong(gd.longitude)
  }
  return out.subarray(0, n)
}
