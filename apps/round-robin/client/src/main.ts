import './style.css'
import { buildSchedule, maxCourts, type Match, type Round } from './schedule'
import { Room, newRoomCode, normalizeCode, type RoomState, type Status } from './sync'

const app = document.getElementById('app')!

declare global {
  interface Window {
    __gameState?: unknown
  }
}

// ---------- storage helpers (best-effort; private windows may throw) ----------
const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k) } catch { return null }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v) } catch { /* ignore */ }
  },
}
const hostKey = (code: string) => `rr-host:${code}`
const stateKey = (code: string) => `rr-state:${code}`

function isHost(code: string): boolean {
  return store.get(hostKey(code)) !== null
}
function saveLocal(s: RoomState) {
  store.set(stateKey(s.code), JSON.stringify(s))
}
function loadLocal(code: string): RoomState | null {
  try {
    const raw = store.get(stateKey(code))
    return raw ? (JSON.parse(raw) as RoomState) : null
  } catch {
    return null
  }
}

// ---------- tiny utils ----------
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function parsePlayers(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/[\n,]+/)) {
    const name = line.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

let toastTimer = 0
function toast(msg: string) {
  let el = document.querySelector<HTMLDivElement>('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1600)
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${label} copied`)
  } catch {
    prompt(`Copy ${label.toLowerCase()}:`, text)
  }
}

function roomUrl(code: string, withKey?: string): string {
  const u = new URL(location.href)
  u.hash = `#/r/${code}${withKey ? `?k=${withKey}` : ''}`
  return u.toString()
}

// ---------- routing ----------
let room: Room | null = null

function route() {
  room?.close()
  room = null
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]+)(?:\?k=([A-Za-z0-9]+))?/)
  if (m) {
    const code = normalizeCode(m[1])
    if (m[2]) {
      // Host link opened on another device: take over control, then drop the key from the URL.
      store.set(hostKey(code), m[2])
      history.replaceState(null, '', `#/r/${code}`)
    }
    renderRoom(code)
  } else {
    renderHome()
  }
}
window.addEventListener('hashchange', route)

// ---------- home ----------
function renderHome() {
  window.__gameState = { view: 'home' }
  app.innerHTML = `
    <h1>🏓 Doubles Round Robin</h1>
    <p class="lede">Everyone partners with everyone exactly once. Share the room code so players can follow along live.</p>

    <section class="card">
      <h2>Join a room</h2>
      <form id="join" class="row" autocomplete="off">
        <input id="code" class="code-input" placeholder="CODE" maxlength="8" aria-label="Room code" style="margin:0" />
        <button class="primary" style="flex:0 0 auto">Join</button>
      </form>
    </section>

    <section class="card">
      <h2>Create a round robin</h2>
      <form id="create" autocomplete="off">
        <label for="title">Event name <span class="hint">(optional)</span></label>
        <input id="title" placeholder="Saturday Pickleball" maxlength="60" />
        <label for="players">Players <span class="hint">— one per line</span></label>
        <textarea id="players" placeholder="Alex&#10;Blair&#10;Casey&#10;Devon&#10;…"></textarea>
        <label for="courts">Courts</label>
        <input id="courts" type="number" min="1" max="20" value="2" inputmode="numeric" />
        <div class="preview" id="preview"></div>
        <div class="error" id="err"></div>
        <button class="primary full">Create room</button>
      </form>
    </section>
  `

  const join = app.querySelector<HTMLFormElement>('#join')!
  const codeInput = app.querySelector<HTMLInputElement>('#code')!
  join.addEventListener('submit', (e) => {
    e.preventDefault()
    const code = normalizeCode(codeInput.value)
    if (code.length >= 4) location.hash = `#/r/${code}`
    else codeInput.focus()
  })

  const form = app.querySelector<HTMLFormElement>('#create')!
  const playersEl = app.querySelector<HTMLTextAreaElement>('#players')!
  const courtsEl = app.querySelector<HTMLInputElement>('#courts')!
  const preview = app.querySelector<HTMLDivElement>('#preview')!
  const err = app.querySelector<HTMLDivElement>('#err')!

  const updatePreview = () => {
    const n = parsePlayers(playersEl.value).length
    const courts = Math.max(1, Math.min(Number(courtsEl.value) || 1, maxCourts(n)))
    if (n < 4) {
      preview.textContent = n ? `${n} player${n === 1 ? '' : 's'} — need at least 4.` : ''
      return
    }
    const pairs = (n * (n - 1)) / 2
    const min = Math.ceil(pairs / (2 * courts))
    preview.textContent = `${n} players · ${pairs} partnerships · about ${min} rounds on ${courts} court${courts === 1 ? '' : 's'}`
  }
  playersEl.addEventListener('input', updatePreview)
  courtsEl.addEventListener('input', updatePreview)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const players = parsePlayers(playersEl.value)
    if (players.length < 4) {
      err.textContent = 'Add at least 4 players.'
      return
    }
    if (players.length > 40) {
      err.textContent = 'Max 40 players.'
      return
    }
    const courts = Math.max(1, Math.min(Number(courtsEl.value) || 1, maxCourts(players.length)))
    const code = newRoomCode()
    const state: RoomState = {
      v: 1,
      code,
      title: app.querySelector<HTMLInputElement>('#title')!.value.trim() || 'Round Robin',
      players,
      courts,
      rounds: buildSchedule(players.length, courts),
      current: 0,
      rev: Date.now(),
    }
    store.set(hostKey(code), newRoomCode(16))
    saveLocal(state)
    location.hash = `#/r/${code}`
  })
}

// ---------- room ----------
function matchHtml(m: Match, i: number, names: string[]): string {
  const team = (ti: number) => {
    const t = m.teams[ti]
    const fill = m.fillIn?.includes(ti) ? `<span class="fill">(fill-in)</span>` : ''
    return `<div class="team">${esc(names[t[0]])} &amp; ${esc(names[t[1]])}${fill}</div>`
  }
  return `
    <div class="match">
      <div class="court">Court<b>${i + 1}</b></div>
      ${team(0)}
      <div class="vs">VS</div>
      ${team(1)}
    </div>`
}

function roundHtml(r: Round, names: string[]): string {
  const sit = r.sittingOut.length
    ? `<div class="sitting">Sitting out: <b>${r.sittingOut.map((p) => esc(names[p])).join(', ')}</b></div>`
    : ''
  return r.matches.map((m, i) => matchHtml(m, i, names)).join('') + sit
}

function compactRound(r: Round, names: string[]): string {
  const n = (p: number) => esc(names[p])
  return r.matches
    .map((m) => `${n(m.teams[0][0])} &amp; ${n(m.teams[0][1])} <span class="muted">vs</span> ${n(m.teams[1][0])} &amp; ${n(m.teams[1][1])}`)
    .join('<br>')
}

function renderRoom(code: string) {
  const host = isHost(code)
  let status: Status = 'connecting'
  let state: RoomState | null = host ? loadLocal(code) : null
  let scheduleOpen = false

  const draw = () => {
    window.__gameState = { view: 'room', host, status, code, current: state?.current, rounds: state?.rounds.length }

    if (!state) {
      app.innerHTML = `
        ${topbar()}
        <div class="card center">
          <p><b>Looking for room <span class="code">${esc(code)}</span>…</b></p>
          <p class="muted">${status === 'live'
            ? 'Connected. If nothing shows up in a few seconds, double-check the code.'
            : 'Connecting…'}</p>
        </div>`
      return
    }

    const s = state
    const total = s.rounds.length
    const finished = s.current >= total
    const cur = s.rounds[s.current]
    const next = s.rounds[s.current + 1]

    const nowCard = finished
      ? `<section class="card done now">
           <div class="emoji">🎉</div>
           <h1>All ${total} rounds done</h1>
           <p class="muted">Everyone has partnered with everyone.</p>
         </section>`
      : `<section class="card now" aria-live="polite">
           <div class="round-head">
             <div class="big">Round ${s.current + 1} <span class="of">of ${total}</span></div>
             <span class="pill">NOW</span>
           </div>
           ${roundHtml(cur, s.players)}
         </section>`

    const nextCard = !finished
      ? `<section class="card">
           <h2>${next ? `Up next · Round ${s.current + 2}` : 'Up next'}</h2>
           ${next ? roundHtml(next, s.players) : '<p class="muted" style="margin:0">That’s the last round.</p>'}
         </section>`
      : ''

    const schedule = `
      <section class="card">
        <details class="schedule" ${scheduleOpen ? 'open' : ''}>
          <summary>Full schedule <span class="muted">${s.players.length} players · ${s.courts} court${s.courts === 1 ? '' : 's'}</span></summary>
          <div style="margin-top:12px">
            ${s.rounds
              .map(
                (r, i) => `
              <div class="sched-round ${i < s.current ? 'past' : ''} ${i === s.current ? 'cur' : ''} ${host ? 'host' : ''}" data-round="${i}">
                <div class="lbl"><span>Round ${i + 1}</span>${r.sittingOut.length ? `<span>Out: ${r.sittingOut.map((p) => esc(s.players[p])).join(', ')}</span>` : ''}</div>
                ${compactRound(r, s.players)}
              </div>`,
              )
              .join('')}
          </div>
          ${host ? '<p class="muted" style="font-size:.85rem;margin:10px 0 0">Tap a round to jump to it.</p>' : ''}
        </details>
      </section>`

    const hostTools = host
      ? `<section class="card">
           <h2>Host</h2>
           <p class="muted" style="margin:0 0 10px;font-size:.9rem">You control this room. Anyone with the code can watch. To control it from another device, open the host link there.</p>
           <div class="row">
             <button id="copyHost">Copy host link</button>
             <button id="newRoom">New round robin</button>
           </div>
         </section>`
      : ''

    const controls = host
      ? `<div class="controls"><div class="inner">
           <button id="prev" ${s.current <= 0 ? 'disabled' : ''}>◀ Back</button>
           <button id="next" class="primary" ${finished ? 'disabled' : ''}>${s.current + 1 >= total ? 'Finish' : 'Next round ▶'}</button>
         </div></div>`
      : ''

    app.innerHTML = `
      ${topbar()}
      <h1>${esc(s.title)}</h1>
      <div class="codebox">
        Room code <span class="code">${esc(s.code)}</span>
        <button class="link" id="copyLink">Copy viewer link</button>
      </div>
      ${nowCard}
      ${nextCard}
      ${schedule}
      ${hostTools}
      ${controls}
    `

    app.querySelector('#copyLink')?.addEventListener('click', () => copy(roomUrl(s.code), 'Viewer link'))
    app.querySelector('details.schedule')?.addEventListener('toggle', (e) => {
      scheduleOpen = (e.target as HTMLDetailsElement).open
    })
    if (host) {
      app.querySelector('#prev')?.addEventListener('click', () => go(s.current - 1))
      app.querySelector('#next')?.addEventListener('click', () => go(s.current + 1))
      app.querySelector('#copyHost')?.addEventListener('click', () =>
        copy(roomUrl(s.code, store.get(hostKey(s.code))!), 'Host link'),
      )
      app.querySelector('#newRoom')?.addEventListener('click', () => {
        location.hash = '#/'
      })
      app.querySelectorAll<HTMLElement>('.sched-round').forEach((el) =>
        el.addEventListener('click', () => go(Number(el.dataset.round))),
      )
    }
  }

  const topbar = () => `
    <div class="topbar">
      <a href="#/">← Home</a>
      <span class="status ${status}"><span class="dot"></span>${status === 'live' ? 'Live' : 'Connecting…'}</span>
    </div>`

  const go = (idx: number) => {
    if (!state) return
    const clamped = Math.max(0, Math.min(idx, state.rounds.length))
    if (clamped === state.current) return
    state = { ...state, current: clamped }
    room!.publish(state)
    saveLocal(state)
    draw()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  room = new Room(
    code,
    (s) => {
      state = s
      if (host) saveLocal(s)
      draw()
    },
    (st) => {
      status = st
      draw()
    },
  )
  if (host && state) room.seed(state)

  if (host) {
    document.onkeydown = (e) => {
      if (!state || (e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'ArrowRight') go(state.current + 1)
      if (e.key === 'ArrowLeft') go(state.current - 1)
    }
  } else {
    document.onkeydown = null
  }

  draw()
}

route()
