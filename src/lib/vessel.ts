export type RecoveryVessel = {
  name: string
  mmsi: string
  imo: string
  callsign: string
  shipid: number
  marinetrafficUrl: string
  latitude: number
  longitude: number
  speedKn: number | null
  ageMinutes: number | null
  receivedAt: string | null
  fetchedAt: string
  source: string
}

export const VESSEL_URL = '/api/vessel'

export async function fetchRecoveryVessel(
  signal?: AbortSignal,
): Promise<RecoveryVessel> {
  const res = await fetch(`${VESSEL_URL}?t=${Date.now()}`, {
    signal,
    cache: 'no-store',
  })
  const data = (await res.json()) as RecoveryVessel & { error?: string }
  if (!res.ok || data.error) {
    throw new Error(data.error ?? `Vessel tracker returned ${res.status}`)
  }
  if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
    throw new Error('Vessel position missing')
  }
  return data
}
