import { loadLiveTrail } from './trail.js'
import { getMeta } from './path.js'
import { GPS_TO_UNIX_OFFSET, haversineKm, speedBetweenFixes } from './utils.js'

const HISTORY_KEY = 'bsz-ship41-telem-v1'
const MAX_SAMPLES = 5000

let samples = loadHistory()

function loadHistory() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(isSample)
  } catch {
    return []
  }
}

function isSample(p) {
  return (
    p &&
    Number.isFinite(p.t) &&
    Number.isFinite(p.alt) &&
    p.alt > -500 &&
    p.alt < 600_000
  )
}

function saveHistory() {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(samples))
  } catch {
    /* private mode / quota */
  }
}

/** Record one live fix. Returns true when the series grew. */
export function recordTelemetrySample(current) {
  if (!current || !Number.isFinite(current.gps_time)) return false
  if (!Number.isFinite(current.altitude)) return false
  if (current.altitude <= -500 || current.altitude >= 600_000) return false
  const last = samples[samples.length - 1]
  if (last && Math.abs(last.t - current.gps_time) < 0.5) return false
  samples.push({
    t: current.gps_time,
    alt: current.altitude,
    spd: Number.isFinite(current.speed) ? current.speed : null,
  })
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES)
  saveHistory()
  return true
}

export function telemetrySamples() {
  return samples
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function niceMax(value, floor) {
  const span = Math.max(value, floor)
  const pow = 10 ** Math.floor(Math.log10(span))
  const n = span / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

function drawChart(canvas, points, { color, formatY, yFloor, timeOrigin = null, domainStart = null }) {
  if (!points.length) return
  const parent = canvas.parentElement
  const width = Math.max(280, parent?.clientWidth || 320)
  const height = 180
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const muted = cssVar('--muted', '#5f6670')
  const line = cssVar('--line', '#d4d7d2')
  const paper = cssVar('--paper-raised', '#fbfbfa')

  ctx.fillStyle = paper
  ctx.fillRect(0, 0, width, height)

  const pad = { l: 64, r: 12, t: 12, b: 26 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b

  const values = points.map((p) => p.v)
  const maxV = niceMax(Math.max(0, ...values), yFloor)
  const t0 = domainStart ?? points[0].t
  const t1 = points[points.length - 1].t
  const span = Math.max(t1 - t0, 1)
  const origin = timeOrigin ?? t0

  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.fillStyle = muted
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 3; i++) {
    const frac = i / 3
    const y = pad.t + plotH * (1 - frac)
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(width - pad.r, y)
    ctx.stroke()
    ctx.fillText(formatY(maxV * frac), pad.l - 8, y)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xTicks = 3
  for (let i = 0; i <= xTicks; i++) {
    const frac = i / xTicks
    const x = pad.l + plotW * frac
    ctx.fillText(formatElapsed(t0 + span * frac - origin), x, height - pad.b + 8)
  }

  const xy = points.map((p) => ({
    x: pad.l + ((p.t - t0) / span) * plotW,
    y: pad.t + (1 - Math.max(0, p.v) / maxV) * plotH,
  }))

  ctx.beginPath()
  xy.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.lineTo(xy[xy.length - 1].x, pad.t + plotH)
  ctx.lineTo(xy[0].x, pad.t + plotH)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.globalAlpha = 0.12
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.beginPath()
  xy.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()

  const tip = xy[xy.length - 1]
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(tip.x, tip.y, 3.5, 0, Math.PI * 2)
  ctx.fill()
}

function liftoffGpsSeconds() {
  try {
    const ms = getMeta().actualLiftoffMs ?? getMeta().plannedLiftoffMs
    if (typeof ms !== 'number') return null
    return ms / 1000 - GPS_TO_UNIX_OFFSET
  } catch {
    return null
  }
}

/** Speed between every recorded fix, so the graph is the tracked flight not a flat zero. */
function speedSeriesKmH() {
  let trail = []
  try {
    trail = loadLiveTrail()
  } catch {
    trail = []
  }
  const points = []
  for (let i = 1; i < trail.length; i++) {
    const spd = speedBetweenFixes(trail[i - 1], trail[i])
    if (!Number.isFinite(spd)) continue
    points.push({ t: trail[i].gps_time, v: spd * 3.6 })
  }
  if (points.length) {
    const first = trail[0]
    const launch = liftoffGpsSeconds()
    let nearPad = false
    try {
      const pad = getMeta().launchPad
      nearPad =
        haversineKm(first.latitude, first.longitude, pad.lat, pad.lon) < 5
    } catch {
      nearPad = false
    }
    if (
      nearPad &&
      launch != null &&
      Math.abs(first.gps_time - launch) < 30 * 60
    ) {
      points.unshift({ t: Math.max(first.gps_time, launch), v: 0 })
    }
    return points
  }
  return samples
    .filter((p) => Number.isFinite(p.spd) && p.spd > 1)
    .map((p) => ({ t: p.t, v: p.spd * 3.6 }))
}

/** Altitude over the flight, anchored at 0 at liftoff. */
function altitudeSeries() {
  const byTime = new Map()
  for (const p of samples) {
    if (Number.isFinite(p.t) && Number.isFinite(p.alt)) byTime.set(p.t, p.alt)
  }
  try {
    for (const p of loadLiveTrail()) {
      if (Number.isFinite(p.gps_time) && Number.isFinite(p.altitude)) {
        byTime.set(p.gps_time, p.altitude)
      }
    }
  } catch {
    /* trail is optional */
  }
  const points = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, alt]) => ({ t, alt }))
  const launch = liftoffGpsSeconds()
  if (launch != null) {
    // Pad samples from before T-0 sit left of the axis. The flight line starts at 0.
    const flown = points.filter((p) => p.t >= launch - 1)
    points.length = 0
    points.push(...flown)
    const first = points[0]
    if (!first || Math.abs(first.t - launch) > 1 || first.alt !== 0) {
      points.unshift({ t: launch, alt: 0 })
    }
  } else if (points.length && points[0].alt !== 0) {
    points.unshift({ t: points[0].t, alt: 0 })
  }
  return points
}

export function drawTelemetryCharts() {
  const altCanvas = document.querySelector('[data-chart="altitude"]')
  const spdCanvas = document.querySelector('[data-chart="speed"]')
  const speedPoints = speedSeriesKmH()
  const altPoints = altitudeSeries()
  if (
    !altCanvas ||
    !spdCanvas ||
    (altPoints.length === 0 && speedPoints.length === 0)
  ) {
    return
  }

  const altColor = cssVar('--ignition', '#e24a12')
  const spdColor = cssVar('--signal', '#0f7a5a')
  const maxAlt = Math.max(0, ...altPoints.map((p) => p.alt))
  // Starbase pad elevation is ~90 m MSL. Until the ship has clearly left, plot 0 m.
  const stillOnPad = altPoints.length > 0 && maxAlt < 500
  const altInKm = !stillOnPad && maxAlt >= 2000
  const caption = altCanvas.closest('figure')?.querySelector('figcaption')
  if (caption) {
    caption.innerHTML = stillOnPad ? 'Altitude <span>0 m</span>' : 'Altitude'
  }
  altCanvas.setAttribute(
    'aria-label',
    stillOnPad ? 'Altitude over time, starting at 0 m' : 'Altitude over time, starting at 0',
  )

  const liftoffGps = liftoffGpsSeconds()
  drawChart(
    altCanvas,
    altPoints.map((p) => ({
      t: p.t,
      v: stillOnPad ? 0 : altInKm ? p.alt / 1000 : p.alt,
    })),
    {
      color: altColor,
      yFloor: stillOnPad ? 1 : altInKm ? 1 : 100,
      formatY: (v) => {
        if (stillOnPad) return v < 0.5 ? '0 m' : '1 m'
        if (altInKm) return `${Math.round(v)} km`
        return `${Math.round(v)} m`
      },
      timeOrigin: liftoffGps,
      domainStart: liftoffGps,
    },
  )

  const firstSpeed = speedPoints[0]
  const coversFlight =
    liftoffGps != null &&
    firstSpeed &&
    firstSpeed.t - liftoffGps < 20 * 60
  drawChart(
    spdCanvas,
    speedPoints,
    {
      color: spdColor,
      yFloor: 10,
      formatY: (v) => `${Math.round(v).toLocaleString('en-US')}`,
      timeOrigin: liftoffGps,
      domainStart: coversFlight ? liftoffGps : null,
    },
  )
}
