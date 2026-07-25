/**
 * Space Notices live Ship 40 trajectory feed (same source as their map layer).
 * Browser calls the same-origin proxy to avoid CORS issues.
 */

export const SPACE_NOTICES_SHIP40_URL = '/api/space-notices-ship40'

export type SpaceNoticesPoint = {
  id: number
  latitude: number
  longitude: number
}

export async function fetchSpaceNoticesShip40(
  signal?: AbortSignal,
): Promise<SpaceNoticesPoint[]> {
  const url = `${SPACE_NOTICES_SHIP40_URL}?t=${Date.now()}`
  const res = await fetch(url, {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Space Notices ship-40 feed returned ${res.status}`)
  }
  const raw = (await res.json()) as unknown
  if (!Array.isArray(raw)) {
    throw new Error('Space Notices ship-40 feed was not an array')
  }
  return raw
    .filter(
      (p): p is SpaceNoticesPoint =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as SpaceNoticesPoint).id === 'number' &&
        typeof (p as SpaceNoticesPoint).latitude === 'number' &&
        typeof (p as SpaceNoticesPoint).longitude === 'number',
    )
    .sort((a, b) => a.id - b.id)
}

/** Keep only samples newer than the baked Space Notices tip. */
export function pointsAfterId(
  points: SpaceNoticesPoint[],
  afterId: number,
): SpaceNoticesPoint[] {
  return points.filter((p) => p.id > afterId)
}
