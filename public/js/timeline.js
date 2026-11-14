/**
 * SpaceX's published countdown and flight timeline, synced to the mission
 * clock. Events are seconds from liftoff (negative = countdown) from
 * /api/flight. SpaceX marks every time as approximate.
 */

let events = []
let listEl = null
let nextEl = null
let lastCurrent = null
let lastNextText = null
let userScrolledAt = 0

/** Drop the explanatory "(…)" tail so labels fit in the header line. */
function shortLabel(label) {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function formatEventTime(t) {
  const sign = t < 0 ? 'T-' : 'T+'
  const total = Math.abs(Math.round(t))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatCountdown(seconds) {
  const total = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function setupTimeline(timeline) {
  events = Array.isArray(timeline)
    ? timeline.filter((e) => Number.isFinite(e?.t) && typeof e.label === 'string' && e.label)
    : []
  const section = document.querySelector('.timeline')
  listEl = document.querySelector('.timeline-list')
  nextEl = document.querySelector('.next-event')
  if (!section || !listEl || !events.length) return
  listEl.innerHTML = events
    .map(
      (e, i) => `
        <li data-index="${i}" data-state="upcoming">
          <span class="tl-time">${formatEventTime(e.t)}</span>
          <span class="tl-label">${escapeHtml(e.label)}</span>
        </li>`,
    )
    .join('')
  section.hidden = false
  listEl.addEventListener('scroll', () => {
    if (!listEl._autoScrolling) userScrolledAt = Date.now()
  })
  // Layout changes (Fullscreen, resizing) move the list: re-centre the
  // current event.
  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (lastCurrent != null) scrollListTo(Math.max(0, lastCurrent))
    }, 150)
  })
}

/** Scroll the list (not the page) so the current event sits near the top. */
function scrollListTo(index) {
  if (!listEl || Date.now() - userScrolledAt < 20_000) return
  const item = listEl.children[index]
  if (!item) return
  // Measure on screen: offsetTop depends on the surrounding layout.
  const itemTop = item.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop
  const target = Math.max(0, itemTop - listEl.clientHeight / 3)
  listEl._autoScrolling = true
  listEl.scrollTo({ top: target, behavior: 'smooth' })
  setTimeout(() => {
    listEl._autoScrolling = false
  }, 800)
}

/**
 * @param {number|null} missionSeconds seconds from liftoff (negative before)
 * @param {{ holding: boolean, stopped: boolean, launched: boolean }} flags
 */
export function renderTimeline(missionSeconds, { holding, stopped, launched }) {
  if (!events.length || !listEl) return
  const known = Number.isFinite(missionSeconds)
  // Before liftoff only countdown events can be done; a hold freezes at T-0.
  const now = stopped
    ? Infinity
    : known
      ? launched
        ? missionSeconds
        : Math.min(missionSeconds, -0.001)
      : -Infinity

  let current = -1
  for (let i = 0; i < events.length; i++) {
    if (events[i].t <= now) current = i
  }
  const next = current + 1 < events.length ? current + 1 : -1

  if (current !== lastCurrent) {
    for (const li of listEl.children) {
      const i = Number(li.dataset.index)
      li.dataset.state =
        i < current ? 'done' : i === current ? 'current' : i === next ? 'next' : 'upcoming'
    }
    scrollListTo(Math.max(0, current))
    lastCurrent = current
  }

  if (!nextEl) return
  let text = ''
  if (!stopped && known && next >= 0) {
    const e = events[next]
    const label = escapeHtml(shortLabel(e.label))
    text =
      holding && e.t >= 0
        ? `Next · <strong>${label}</strong> · holding for liftoff`
        : `Next · <strong>${label}</strong> in ${formatCountdown(e.t - now)}`
  }
  if (text !== lastNextText) {
    nextEl.innerHTML = text
    nextEl.hidden = !text
    lastNextText = text
  }
}
