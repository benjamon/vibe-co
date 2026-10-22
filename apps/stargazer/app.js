import { STARS, STAR_NAMES, CONSTELLATIONS, LINES, BOUNDS } from './sky-data.js';
import { MEANING, NOTES, SHOWERS, CITIES } from './lore.js';
import {
  localSiderealTime, equToHor, horToEqu, sunPosition, moonPosition, moonPhaseName, moonHorizontal,
  planetPositions, nightEvents, findCrossings, constellationAt, compassPoint, bvToColor,
  eclipticToEquatorial, norm360,
} from './astro.js';

const $ = (id) => document.getElementById(id);
const canvas = $('sky');
const ctx = canvas.getContext('2d');
const STORE_KEY = 'stargazer:v1';
const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const HOUR = 3600000;

// ---------- static data prep ----------

const CONS = {};
for (const [id, name, ra, dec, rank] of CONSTELLATIONS) {
  if (!CONS[id]) CONS[id] = { id, name, rank, centers: [] };
  else CONS[id].name = name.split(' ')[0];
  CONS[id].centers.push({ ra, dec, label: name });
}
const CON_IDS = Object.keys(CONS).sort((a, b) => CONS[a].name.localeCompare(CONS[b].name));

const starName = new Map();
for (const [i, n] of STAR_NAMES) {
  const [ra, dec] = STARS[i];
  const crowded = [...starName.keys()].some((j) => Math.abs(STARS[j][1] - dec) < 0.5 && Math.abs(((STARS[j][0] - ra + 540) % 360) - 180) * Math.cos(dec * Math.PI / 180) < 0.5);
  if (!crowded) starName.set(i, n);
}
const starCon = new Array(STARS.length);
const brightest = {};
for (let i = 0; i < STARS.length; i++) {
  const id = constellationAt(STARS[i][0], STARS[i][1], BOUNDS);
  starCon[i] = id;
  if (id && !(id in brightest)) brightest[id] = i; // STARS is sorted by magnitude
}
const starColors = STARS.map((s) => bvToColor(s[3]));

// ---------- state ----------

const saved = loadSaved();
const params = new URLSearchParams(location.search);
const state = {
  lat: 47.61,
  lon: -122.33,
  place: 'Seattle, WA',
  tz: 'America/Los_Angeles',
  time: new Date(),
  view: 'up',
  zoom: 1,
  panX: 0,
  panY: 0,
  facing: null, // azimuth placed at the bottom of the overhead chart
  heading: null, // live compass heading when enabled
  selected: null,
  filter: 'up',
  opts: { lines: true, labels: true, stars: true, planets: true, bounds: false, grid: true, ecliptic: false, mag: 5 },
  playing: false,
  red: false,
};
Object.assign(state, saved.loc || {});
Object.assign(state.opts, saved.opts || {});
state.red = !!saved.red;
if (params.has('lat') && params.has('lon')) {
  state.lat = clamp(parseFloat(params.get('lat')) || 0, -90, 90);
  state.lon = clamp(parseFloat(params.get('lon')) || 0, -180, 180);
  state.place = params.get('place') || formatCoords(state.lat, state.lon);
  state.tz = params.get('tz') || null;
}
if (params.has('t')) {
  const t = new Date(params.get('t'));
  if (!isNaN(t)) state.time = t;
}
if (params.get('view') === 'down') state.view = 'down';
if (params.has('con') && CONS[params.get('con')]) state.selected = { type: 'con', id: params.get('con') };

let frame = null; // per-render derived data
let night = null; // cached night summary
let starScreen = new Float32Array(STARS.length * 2);
let starDrawn = new Uint8Array(STARS.length);
let bodyScreen = [];

// ---------- helpers ----------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      loc: { lat: state.lat, lon: state.lon, place: state.place, tz: state.tz },
      opts: state.opts,
      red: state.red,
    }));
  } catch { /* storage unavailable */ }
}
const fmtTime = (d) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: state.tz || DEVICE_TZ }) : '—');
const fmtDur = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
function formatCoords(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const pad = (n) => String(n).padStart(2, '0');
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
if (!state.tz || !validTz(state.tz)) state.tz = null;

// Wall-clock helpers in the observing site's time zone (not the browser's).
const partFmts = {};
function wall(d, tz = state.tz || DEVICE_TZ) {
  partFmts[tz] ||= new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const x of partFmts[tz].formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function fromWall(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (t) => { const w = wall(new Date(t)); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(t / 60000) * 60000; };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}
const localDateStr = (d) => { const w = wall(d); return `${w.y}-${pad(w.m)}-${pad(w.d)}`; };
const localTimeStr = (d) => { const w = wall(d); return `${pad(w.h)}:${pad(w.mi)}`; };

// The "night" containing a time runs from local noon to the next local noon.
function nightStart(t) {
  const w = wall(t);
  let n = fromWall(w.y, w.m, w.d, 12, 0);
  if (t < n) {
    const prev = new Date(Date.UTC(w.y, w.m - 1, w.d - 1));
    n = fromWall(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 12, 0);
  }
  return n;
}

// Look up the site's IANA time zone so all times read as local to that place.
let tzSeq = 0;
async function resolveTz() {
  const my = ++tzSeq;
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&timezone=auto&forecast_days=1`);
    const data = await res.json();
    if (my !== tzSeq || !data.timezone || !validTz(data.timezone)) return;
    state.tz = data.timezone;
    night = null;
    lastTonightKey = '';
    persist();
    syncControls();
    requestRender();
  } catch { /* offline: keep the device time zone */ }
}

function fists(alt) {
  const f = Math.round(Math.abs(alt) / 10 * 2) / 2;
  if (f < 0.5) return 'right at the horizon';
  return `about ${f === 1 ? 'one fist' : `${f} fists`} (at arm’s length)`;
}

function hor(ra, dec) { return equToHor(ra, dec, state.lat, frame.lst); }

// ---------- per-frame derived data ----------

function computeFrame() {
  const t = state.time;
  const lst = localSiderealTime(t, state.lon);
  const sun = sunPosition(t);
  const moon = moonPosition(t);
  frame = { lst, t };
  frame.sunHor = hor(sun.ra, sun.dec);
  frame.sun = sun;
  frame.moon = moon;
  frame.moonHor = moonHorizontal(t, state.lat, state.lon);
  frame.planets = planetPositions(t).map((p) => ({ ...p, hor: hor(p.ra, p.dec) }));

  frame.cons = CON_IDS.map((id) => {
    const c = CONS[id];
    const centers = c.centers.map((cc) => ({ ...cc, hor: hor(cc.ra, cc.dec) }));
    const main = centers.reduce((a, b) => (b.hor.alt > a.hor.alt ? b : a));
    let up = 0, total = 0;
    for (const seg of LINES[id] || []) {
      for (const [ra, dec] of seg) { total++; if (hor(ra, dec).alt > 0) up++; }
    }
    const frac = total ? up / total : main.hor.alt > 0 ? 1 : 0;
    return { id, name: c.name, rank: c.rank, centers, main, frac };
  });
  frame.consById = Object.fromEntries(frame.cons.map((c) => [c.id, c]));
}

function ensureNight() {
  const start = nightStart(state.time);
  const key = `${start.getTime()}|${state.lat}|${state.lon}|${state.tz}`;
  if (night && night.key === key) return night;
  const ev = nightEvents(start, state.lat, state.lon);
  // Darkness window: astronomical if available, else the best twilight we get.
  let darkFrom = ev.astroSet, darkTo = ev.astroRise, quality = 'astronomical darkness';
  if (!darkFrom || !darkTo) { darkFrom = ev.nauticalSet; darkTo = ev.nauticalRise; quality = 'nautical twilight only'; }
  if (!darkFrom || !darkTo) { darkFrom = ev.civilSet; darkTo = ev.civilRise; quality = 'civil twilight only'; }
  if (!darkFrom || !darkTo) {
    if (ev.midnightSunAlt < -18) { darkFrom = start; darkTo = new Date(start.getTime() + 24 * HOUR); quality = 'polar night'; }
    else if (ev.midnightSunAlt < -0.833) { darkFrom = new Date(start.getTime() + 9 * HOUR); darkTo = new Date(start.getTime() + 15 * HOUR); quality = 'twilight all night'; }
    else { darkFrom = null; darkTo = null; quality = 'midnight sun — no darkness'; }
  }
  // Moon-free darkness
  let moonFree = 0, mfStart = null, mfEnd = null, bestRun = 0, runStart = null;
  if (darkFrom && darkTo) {
    const step = 10 * 60000;
    for (let t = darkFrom.getTime(); t <= darkTo.getTime(); t += step) {
      const down = moonHorizontal(new Date(t), state.lat, state.lon).alt < 0;
      if (down) {
        moonFree += step;
        if (runStart === null) runStart = t;
        if (t - runStart + step > bestRun) { bestRun = t - runStart + step; mfStart = runStart; mfEnd = t + step; }
      } else runStart = null;
    }
  }
  // Best time for each constellation: highest centroid during darkness.
  const bestCon = {};
  const winFrom = darkFrom || start, winTo = darkTo || new Date(start.getTime() + 24 * HOUR);
  const samples = [];
  for (let t = winFrom.getTime(); t <= winTo.getTime(); t += 20 * 60000) samples.push(new Date(t));
  const lsts = samples.map((d) => localSiderealTime(d, state.lon));
  for (const id of CON_IDS) {
    let best = { alt: -90, time: null };
    for (const cc of CONS[id].centers) {
      lsts.forEach((lst, i) => {
        const a = equToHor(cc.ra, cc.dec, state.lat, lst).alt;
        if (a > best.alt) best = { alt: a, time: samples[i] };
      });
    }
    bestCon[id] = best;
  }
  night = { key, start, ev, darkFrom, darkTo, quality, moonFree, mfStart: mfStart && new Date(mfStart), mfEnd: mfEnd && new Date(Math.min(mfEnd, darkTo)), bestCon };
  updateSliderTrack();
  return night;
}

// ---------- projection ----------

const view = { cx: 0, cy: 0, R: 0, dpr: 1, size: 0 };

function rotation() {
  if (state.heading !== null) return state.view === 'up' ? state.heading + 180 : state.heading;
  const f = state.facing ?? (state.lat >= 0 ? 180 : 0);
  return state.view === 'up' ? f + 180 : f;
}

function project(alt, az) {
  const dist = state.view === 'up' ? 90 - alt : 90 + alt;
  const r = (dist / 90) * view.R * state.zoom;
  const a = (az - rotation()) * Math.PI / 180;
  const sx = state.view === 'up' ? -Math.sin(a) : Math.sin(a);
  return [view.cx + state.panX + sx * r, view.cy + state.panY - Math.cos(a) * r, dist];
}

function unproject(x, y) {
  const dx = x - view.cx - state.panX, dy = y - view.cy - state.panY;
  const dist = Math.hypot(dx, dy) / (view.R * state.zoom) * 90;
  const a = state.view === 'up' ? Math.atan2(-dx, -dy) : Math.atan2(dx, -dy);
  const az = norm360(a * 180 / Math.PI + rotation());
  const alt = state.view === 'up' ? 90 - dist : dist - 90;
  return { alt, az, dist };
}

// ---------- drawing ----------

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  view.dpr = window.devicePixelRatio || 1;
  view.size = rect.width;
  canvas.width = Math.round(rect.width * view.dpr);
  canvas.height = Math.round(rect.width * view.dpr);
  view.cx = rect.width / 2;
  view.cy = rect.width / 2;
  view.R = rect.width / 2 - 26;
  requestRender();
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function skyColors(sunAlt) {
  if (state.view === 'down') return ['#0d0b1f', '#060512'];
  if (sunAlt > 0) return ['#3d6fb6', '#8fb6e6'];
  if (sunAlt > -6) return ['#1d2c5a', '#5a5f8f'];
  if (sunAlt > -12) return ['#0f1638', '#272c58'];
  if (sunAlt > -18) return ['#0a0e26', '#151937'];
  return ['#04050f', '#0b0d22'];
}

function limitingMag() {
  let lim = state.opts.mag;
  const s = frame.sunHor.alt;
  if (state.view === 'up') {
    if (s > 0) lim = Math.min(lim, 0.5);
    else if (s > -6) lim = Math.min(lim, 2);
    else if (s > -12) lim = Math.min(lim, 3.5);
    else if (s > -18) lim = Math.min(lim, 4.5);
    // A bright Moon washes out faint stars.
    if (frame.moonHor.alt > 0) lim -= frame.moon.illumination * 0.8;
  }
  return lim;
}

function render() {
  if (!view.size) return;
  computeFrame();
  ensureNight();
  const { dpr } = view;
  const W = view.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, W);

  const ox = view.cx + state.panX, oy = view.cy + state.panY;
  const horizonR = view.R * state.zoom;
  const scale = view.R / 300;

  // Sky disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.R + 24, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, W, W);
  const [c1, c2] = skyColors(frame.sunHor.alt);
  const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, horizonR);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.beginPath();
  ctx.arc(ox, oy, horizonR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.clip();

  if (state.opts.grid) drawGrid(ox, oy, horizonR, scale);
  if (state.opts.bounds) drawBounds();
  if (state.opts.ecliptic) drawEcliptic();
  if (state.opts.lines) drawLines(scale);
  drawStars(scale);
  drawShowers(scale);
  if (state.opts.planets) drawBodies(scale);
  if (state.opts.labels) drawConLabels(scale);
  drawSelection(scale);
  ctx.restore();

  drawRim(ox, oy, horizonR, scale);
  canvas.style.touchAction = state.zoom > 1 ? 'none' : 'pan-y';
  updateBanner();
  updatePanels();
}

function drawGrid(ox, oy, R, scale) {
  ctx.strokeStyle = 'rgba(160,170,255,0.12)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(160,170,255,0.35)';
  ctx.font = `${10 * Math.max(1, scale * 0.9)}px system-ui`;
  for (const alt of [30, 60]) {
    const r = R * (90 - alt) / 90;
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.stroke();
    const label = state.view === 'up' ? `${alt}°` : `−${alt}°`;
    ctx.fillText(label, ox + 3, oy - r - 3);
  }
  for (let az = 0; az < 360; az += 45) {
    const [x, y] = project(state.view === 'up' ? 0 : 0, az);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}

function strokePath(points) {
  // points: [[ra, dec], ...] -> polyline, skipping segments far beyond the horizon
  ctx.beginPath();
  let pen = false;
  for (const [ra, dec] of points) {
    const h = hor(ra, dec);
    const [x, y, dist] = project(h.alt, h.az);
    if (dist > 150) { pen = false; continue; }
    if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
}

function drawBounds() {
  ctx.strokeStyle = 'rgba(120,140,220,0.22)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 0.8;
  for (const id in BOUNDS) for (const poly of BOUNDS[id]) strokePath([...poly, poly[0]]);
  ctx.setLineDash([]);
}

function drawEcliptic() {
  const pts = [];
  for (let lon = 0; lon <= 360; lon += 3) {
    const e = eclipticToEquatorial(lon);
    pts.push([e.ra, e.dec]);
  }
  ctx.strokeStyle = 'rgba(255,200,90,0.35)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1;
  strokePath(pts);
  ctx.setLineDash([]);
}

function drawLines(scale) {
  const sel = state.selected?.type === 'con' ? state.selected.id : null;
  for (const id in LINES) {
    const isSel = id === sel;
    ctx.strokeStyle = isSel ? 'rgba(255,215,0,0.95)' : 'rgba(120,170,255,0.38)';
    ctx.lineWidth = (isSel ? 2.2 : 1) * Math.max(1, scale * 0.8);
    for (const seg of LINES[id]) strokePath(seg);
  }
}

function drawStars(scale) {
  const lim = limitingMag();
  const zoomBoost = Math.sqrt(state.zoom);
  const extraMag = Math.log2(state.zoom) * 0.6; // zooming reveals fainter stars
  const showNames = state.opts.stars;
  starDrawn.fill(0);
  ctx.font = `${11 * Math.max(1, scale * 0.85)}px system-ui`;
  for (let i = 0; i < STARS.length; i++) {
    const [ra, dec, mag] = STARS[i];
    const h = hor(ra, dec);
    if (state.view === 'up' ? h.alt < -1 : h.alt > 1) continue;
    let m = mag;
    if (state.view === 'up' && h.alt < 15) m += (15 - Math.max(0, h.alt)) * 0.06; // extinction
    const effLim = lim + extraMag;
    if (m > effLim) continue;
    const [x, y] = project(h.alt, h.az);
    if (x < -10 || y < -10 || x > view.size + 10 || y > view.size + 10) continue;
    const r = Math.max(0.5, (effLim + 1.6 - m) * 0.55) * scale * zoomBoost * 0.9;
    starScreen[i * 2] = x;
    starScreen[i * 2 + 1] = y;
    starDrawn[i] = 1;
    const alpha = clamp((effLim + 0.6 - m) / 1.6, 0.25, 1);
    ctx.globalAlpha = alpha;
    if (mag < 1.5) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, starColors[i]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = starColors[i];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const nameCut = 1.6 + Math.log2(state.zoom) * 1.1;
    if (showNames && starName.has(i) && mag < nameCut) {
      ctx.fillStyle = 'rgba(230,232,255,0.75)';
      ctx.fillText(starName.get(i), x + r + 3, y + 3);
    }
  }
}

function drawConLabels(scale) {
  ctx.textAlign = 'center';
  const sel = state.selected?.type === 'con' ? state.selected.id : null;
  for (const c of frame.cons) {
    if (c.rank > 2 && state.zoom < 1.6 && c.id !== sel) continue;
    for (const cc of c.centers) {
      if (state.view === 'up' ? cc.hor.alt < -2 : cc.hor.alt > 2) continue;
      const [x, y] = project(cc.hor.alt, cc.hor.az);
      const big = c.rank === 1;
      ctx.font = `${c.id === sel ? 600 : 400} ${(big ? 12 : 10.5) * Math.max(1, scale * 0.85)}px system-ui`;
      ctx.fillStyle = c.id === sel ? '#ffd700' : big ? 'rgba(150,190,255,0.85)' : 'rgba(150,190,255,0.6)';
      ctx.fillText(cc.label.toUpperCase(), x, y);
    }
  }
  ctx.textAlign = 'left';
}

function drawShowers(scale) {
  const active = activeShowers(state.time).filter((s) => s.active);
  for (const s of active) {
    const h = hor(s.ra, s.dec);
    if (state.view === 'up' ? h.alt < 0 : h.alt > 0) continue;
    const [x, y] = project(h.alt, h.az);
    ctx.strokeStyle = 'rgba(255,140,200,0.8)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 5 * scale, y + Math.sin(a) * 5 * scale);
      ctx.lineTo(x + Math.cos(a) * 12 * scale, y + Math.sin(a) * 12 * scale);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,160,210,0.9)';
    ctx.font = `${10.5 * Math.max(1, scale * 0.85)}px system-ui`;
    ctx.fillText(s.name, x + 14 * scale, y - 6 * scale);
  }
}

function drawMoonShape(c, x, y, r, illum, angle) {
  // angle: direction (radians, canvas coords) from the Moon toward the Sun.
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fillStyle = '#2a2b38';
  c.fill();
  c.beginPath();
  c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const rx = Math.abs(r * (1 - 2 * illum));
  if (illum < 0.5) c.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  else c.ellipse(0, 0, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  c.fillStyle = '#f4f1e1';
  c.fill();
  c.restore();
}

function drawBodies(scale) {
  bodyScreen = [];
  const vis = (alt) => (state.view === 'up' ? alt > -1 : alt < 1);
  ctx.font = `600 ${11 * Math.max(1, scale * 0.85)}px system-ui`;
  for (const p of frame.planets) {
    if (!vis(p.hor.alt)) continue;
    const [x, y] = project(p.hor.alt, p.hor.az);
    const r = clamp(3.2 - p.mag * 0.55, 2.2, 5.5) * scale * Math.sqrt(state.zoom) * 0.9;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.color;
    ctx.fillText(p.name, x + r + 4, y - r);
    bodyScreen.push({ type: 'planet', id: p.id, x, y, r: r + 6 });
  }
  const sunXY = project(frame.sunHor.alt, frame.sunHor.az);
  if (vis(frame.moonHor.alt)) {
    const [x, y] = project(frame.moonHor.alt, frame.moonHor.az);
    const r = 9 * scale * Math.sqrt(state.zoom);
    drawMoonShape(ctx, x, y, r, frame.moon.illumination, Math.atan2(sunXY[1] - y, sunXY[0] - x));
    ctx.fillStyle = '#f4f1e1';
    ctx.fillText('Moon', x + r + 4, y - r * 0.6);
    bodyScreen.push({ type: 'moon', id: 'moon', x, y, r: r + 4 });
  }
  if (vis(frame.sunHor.alt)) {
    const [x, y] = sunXY;
    const r = 10 * scale * Math.sqrt(state.zoom);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.4, '#ffd34d');
    g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.fillText('Sun', x + r + 4, y - r);
    bodyScreen.push({ type: 'sun', id: 'sun', x, y, r: r + 4 });
  }
}

function drawSelection(scale) {
  const s = state.selected;
  if (!s) return;
  let pos = null;
  if (s.type === 'star') pos = hor(STARS[s.idx][0], STARS[s.idx][1]);
  if (s.type === 'planet') pos = frame.planets.find((p) => p.id === s.id)?.hor;
  if (s.type === 'moon') pos = frame.moonHor;
  if (s.type === 'sun') pos = frame.sunHor;
  if (!pos) return;
  const [x, y] = project(pos.alt, pos.az);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRim(ox, oy, R, scale) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.R + 24, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = state.view === 'up' ? 'rgba(120,200,140,0.55)' : 'rgba(200,140,90,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, R, 0, Math.PI * 2);
  ctx.stroke();
  // Compass labels sit just outside the horizon ring.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  for (const [txt, az] of labels) {
    const a = (az - rotation()) * Math.PI / 180;
    const sx = state.view === 'up' ? -Math.sin(a) : Math.sin(a);
    const rr = R + 13;
    const x = ox + sx * rr, y = oy - Math.cos(a) * rr;
    ctx.font = `${txt.length === 1 ? 700 : 400} ${(txt.length === 1 ? 14 : 10) * Math.max(1, scale * 0.8)}px system-ui`;
    ctx.fillStyle = txt === 'N' ? '#ff7a7a' : txt.length === 1 ? '#e8e9f5' : '#8f90aa';
    ctx.fillText(txt, x, y);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function updateBanner() {
  const b = $('sky-banner');
  const s = frame.sunHor.alt;
  if (state.view === 'up' && s > -6) {
    b.hidden = false;
    b.innerHTML = s > 0
      ? 'The Sun is up, so only the brightest objects show.<br><b>Tap “Tonight”</b> to jump to darkness.'
      : 'Twilight — only bright stars are out yet.';
  } else if (state.view === 'down' && !state._downHintSeen) {
    b.hidden = false;
    b.innerHTML = 'X-ray view through the Earth: these stars are below your horizon right now,<br>seen as if the ground were transparent.';
    clearTimeout(updateBanner.t);
    updateBanner.t = setTimeout(() => { state._downHintSeen = true; requestRender(); }, 4500);
  } else b.hidden = true;
}

// ---------- side panels ----------

function updatePanels() {
  renderTonight();
  renderZenith();
  renderConList();
  renderPlanets();
  renderShowers();
  renderSelection();
  window.__stargazer = {
    lat: state.lat, lon: state.lon, time: state.time.toISOString(), view: state.view,
    visible: frame.cons.filter((c) => c.frac >= 0.5).map((c) => c.id),
    zenith: constellationAt(frame.lst, state.lat, BOUNDS),
    nadir: constellationAt(norm360(frame.lst + 180), -state.lat, BOUNDS),
    selected: state.selected,
  };
}

let lastTonightKey = '';
function renderTonight() {
  const n = night;
  const key = n.key;
  if (key === lastTonightKey) return;
  lastTonightKey = key;
  const ev = n.ev;
  const midnight = new Date(n.start.getTime() + 12 * HOUR);
  const moonMid = moonPosition(midnight);
  const darkLen = n.darkFrom && n.darkTo ? n.darkTo - n.darkFrom : 0;
  let verdict;
  if (!darkLen) verdict = '☀️ No real darkness tonight at this latitude. Only the Moon, planets and the brightest stars.';
  else if (n.moonFree > darkLen * 0.8) verdict = `✨ Excellent: ${fmtDur(n.moonFree)} of moonless darkness. Great for the Milky Way and faint constellations.`;
  else if (n.moonFree > HOUR) verdict = `👍 Moon-free dark sky from ${fmtTime(n.mfStart)} to ${fmtTime(n.mfEnd)} (${fmtDur(n.mfEnd - n.mfStart)}). Plan faint-object viewing then.`;
  else verdict = `🌕 The ${Math.round(moonMid.illumination * 100)}%-lit Moon is up most of the dark hours. Bright constellations and planets only.`;
  $('tonight').innerHTML = `
    <div class="stat"><span>Sunset</span><b>${fmtTime(ev.sunSet)}</b></div>
    <div class="stat"><span>Sunrise</span><b>${fmtTime(ev.sunRise)}</b></div>
    <div class="stat"><span>Fully dark</span><b>${n.darkFrom ? `${fmtTime(n.darkFrom)} – ${fmtTime(n.darkTo)}` : '—'}</b></div>
    <div class="stat"><span>Darkness</span><b class="small">${n.quality}</b></div>
    <div class="moon-row"><canvas id="moon-icon" width="88" height="88"></canvas>
      <div><b>${moonPhaseName(moonMid)}</b> &middot; ${Math.round(moonMid.illumination * 100)}% lit<br>
      <span class="muted small">Moonrise ${fmtTime(ev.moonRise)} &middot; Moonset ${fmtTime(ev.moonSet)}</span></div></div>
    <div class="verdict">${verdict}</div>`;
  const mc = $('moon-icon').getContext('2d');
  // Northern observers see the lit side on the right while waxing.
  const sunSide = (moonMid.waxing ? 0 : Math.PI) + (state.lat < 0 ? Math.PI : 0);
  drawMoonShape(mc, 44, 44, 38, moonMid.illumination, sunSide);
}

function conButton(id) {
  if (!id) return '—';
  return `<button type="button" class="linkish" data-con="${id}">${escapeHtml(CONS[id].name)}</button> <span class="muted small">${escapeHtml(MEANING[id] || '')}</span>`;
}

function renderZenith() {
  const zen = constellationAt(frame.lst, state.lat, BOUNDS);
  const nad = constellationAt(norm360(frame.lst + 180), -state.lat, BOUNDS);
  const poleAlt = Math.abs(state.lat);
  const pole = state.lat >= 0
    ? `Polaris sits ${poleAlt.toFixed(0)}° up due north — ${fists(poleAlt)}.`
    : `The south celestial pole is ${poleAlt.toFixed(0)}° up due south (no bright pole star; use the Southern Cross).`;
  const anti = formatCoords(-state.lat, state.lon > 0 ? state.lon - 180 : state.lon + 180);
  $('zenith').innerHTML = `
    <div class="row"><span>Overhead</span><div>${conButton(zen)}</div></div>
    <div class="row"><span>Beneath your feet</span><div>${conButton(nad)}</div></div>
    <div class="row"><span>Antipode</span><div class="small">${anti} &mdash; it’s overhead for anyone standing there.</div></div>
    <div class="row"><span>Find north</span><div class="small">${pole}</div></div>`;
}

function conRowHtml(c, extra) {
  const h = c.main.hor;
  const sel = state.selected?.type === 'con' && state.selected.id === c.id ? ' selected' : '';
  return `<li data-con="${c.id}" class="${sel}"><span class="nm">${escapeHtml(c.name)}</span>
    <span class="where">${extra ?? `${compassPoint(h.az)} ${Math.round(h.alt)}°<small>${Math.round(c.frac * 100)}% up<span class="bar"><i style="width:${Math.round(c.frac * 100)}%"></i></span></small>`}</span>
    <span class="mn">${escapeHtml(MEANING[c.id] || '')}</span></li>`;
}

function renderConList() {
  const q = $('con-search').value.trim().toLowerCase();
  let list = frame.cons;
  let html;
  if (q) {
    list = list.filter((c) => c.name.toLowerCase().includes(q) || (MEANING[c.id] || '').toLowerCase().includes(q) || c.id.toLowerCase() === q);
    html = list.map((c) => conRowHtml(c)).join('');
  } else if (state.filter === 'up') {
    list = list.filter((c) => c.frac >= 0.5 && c.main.hor.alt > 0).sort((a, b) => b.main.hor.alt - a.main.hor.alt);
    html = list.map((c) => conRowHtml(c)).join('');
  } else if (state.filter === 'down') {
    list = list.filter((c) => c.frac < 0.5).sort((a, b) => a.main.hor.alt - b.main.hor.alt);
    html = list.map((c) => conRowHtml(c, `${compassPoint(c.main.hor.az)} ${Math.round(c.main.hor.alt)}°<small>below horizon</small>`)).join('');
  } else {
    list = list.filter((c) => night.bestCon[c.id].alt > 25).sort((a, b) => night.bestCon[b.id].alt - night.bestCon[a.id].alt);
    html = list.map((c) => {
      const b = night.bestCon[c.id];
      return conRowHtml(c, `${fmtTime(b.time)}<small>peaks ${Math.round(b.alt)}° up</small>`);
    }).join('');
  }
  $('con-list').innerHTML = html || '<li class="empty">Nothing matches.</li>';
}

function riseSet(raDecFn, fromTime) {
  const altFn = (d) => {
    const { ra, dec } = raDecFn(d);
    return equToHor(ra, dec, state.lat, localSiderealTime(d, state.lon)).alt;
  };
  const c = findCrossings(altFn, fromTime, 24, 0, 10);
  return { rise: c.find((x) => x.rising)?.time, set: c.find((x) => !x.rising)?.time };
}

function renderPlanets() {
  const rows = [];
  const moonRow = { name: 'Moon', id: 'moon', type: 'moon', color: '#f4f1e1', hor: frame.moonHor, mag: -12.7, ra: frame.moon.ra, dec: frame.moon.dec };
  for (const p of [moonRow, ...frame.planets.map((x) => ({ ...x, type: 'planet' }))]) {
    const up = p.hor.alt > 0;
    const darkEnough = frame.sunHor.alt < -6;
    const con = constellationAt(p.ra, p.dec, BOUNDS);
    let status;
    if (up) status = `<span class="up">${compassPoint(p.hor.az)} ${Math.round(p.hor.alt)}°</span>${darkEnough ? '' : ' <span class="muted small">(sky bright)</span>'}`;
    else status = '<span class="muted">below horizon</span>';
    rows.push(`<li data-type="${p.type}" data-id="${p.id}"><span><i class="dot" style="background:${p.color}"></i>${p.name}
      <span class="muted small">in ${con ? escapeHtml(CONS[con].name) : '?'}${p.type === 'planet' ? ` &middot; mag ${p.mag.toFixed(1)}` : ''}</span></span><span>${status}</span></li>`);
  }
  $('planet-list').innerHTML = rows.join('');
}

function showerDates(s, ref) {
  // Build Date objects for the shower season nearest to `ref`.
  const y = wall(ref).y;
  const mk = (yr, [m, d]) => fromWall(yr, m, d, 0, 0);
  for (const yr of [y - 1, y, y + 1]) {
    let start = mk(yr, s.start), end = mk(yr, s.end), peak = mk(yr, s.peak);
    if (end < start) end = mk(yr + 1, s.end);
    if (peak < start) peak = mk(yr + 1, s.peak);
    const endOfDay = new Date(end.getTime() + 24 * HOUR);
    if (ref >= start && ref < endOfDay) return { start, end, peak, active: true };
  }
  let peak = mk(y, s.peak);
  if (peak < ref) peak = mk(y + 1, s.peak);
  return { peak, active: false };
}

function activeShowers(t) {
  return SHOWERS.map((s) => ({ ...s, ...showerDates(s, t) }));
}

function renderShowers() {
  const t = state.time;
  const all = activeShowers(t);
  const active = all.filter((s) => s.active);
  const upcoming = all.filter((s) => !s.active).sort((a, b) => a.peak - b.peak).slice(0, 2);
  const dayMs = 24 * HOUR;
  const row = (s) => {
    const days = Math.round((s.peak - nightStart(t)) / dayMs);
    const h = hor(s.ra, s.dec);
    const when = days === 0 ? '<span class="peak">peaks tonight!</span>'
      : days > 0 ? `peaks in ${days} day${days === 1 ? '' : 's'}` : `peaked ${-days} day${days === -1 ? '' : 's'} ago`;
    const radiant = s.active ? ` &middot; radiant ${h.alt > 0 ? `${compassPoint(h.az)} ${Math.round(h.alt)}°` : 'below horizon'}` : '';
    return `<li><span>${s.active ? '☄️ ' : ''}<b>${s.name}</b><br><span class="muted small">up to ${s.zhr}/hr${radiant}</span></span>
      <span class="small" style="text-align:right">${when}<br><span class="muted">${s.peak.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: state.tz || DEVICE_TZ })}</span></span></li>`;
  };
  $('shower-list').innerHTML = (active.length ? active.map(row).join('') : '<li class="muted small">No major shower active tonight.</li>')
    + (upcoming.length ? `<li class="muted small" style="margin-top:.3rem">Coming up</li>${upcoming.map(row).join('')}` : '');
}

function bestMonth(ra) {
  // Date when this RA crosses the meridian at 9pm local solar time.
  const days = ((ra / 15 + 3) / 24) * 365.25;
  const d = new Date(2001, 8, 21);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString([], { month: 'long' });
}

function directionText(h, label) {
  if (h.alt >= 0) {
    if (h.alt > 75) return `Look nearly <b>straight up</b> — ${label} is ${Math.round(h.alt)}° high.`;
    return `Face <b>${compassPoint(h.az)}</b> (${Math.round(h.az)}°) and look <b>${Math.round(h.alt)}° up</b> — ${fists(h.alt)} above the horizon.`;
  }
  return `It’s <b>below the horizon</b>, ${Math.round(-h.alt)}° beneath your feet toward the <b>${compassPoint(h.az)}</b>.`;
}

let lastSelKey = '';
function renderSelection() {
  const el = $('selection');
  const s = state.selected;
  if (!s) { el.hidden = true; lastSelKey = ''; return; }
  const key = `${JSON.stringify(s)}|${frame.t.getTime()}|${state.lat}|${state.lon}`;
  if (key === lastSelKey) return;
  lastSelKey = key;
  el.hidden = false;
  let html = '<button type="button" class="close" data-close aria-label="Close">&times;</button>';
  if (s.type === 'con') {
    const c = frame.consById[s.id];
    const cc = c.main;
    const rs = riseSet(() => cc, state.time);
    const b = brightest[s.id];
    const bName = b !== undefined ? `${starName.get(b) || 'unnamed'} (mag ${STARS[b][2].toFixed(1)})` : '—';
    const latMin = Math.max(-90, cc.dec - 90), latMax = Math.min(90, cc.dec + 90);
    const latStr = (v) => `${Math.abs(Math.round(v))}°${v >= 0 ? 'N' : 'S'}`;
    const best = night.bestCon[s.id];
    let rsText;
    if (!rs.rise && !rs.set) rsText = cc.hor.alt > 0 ? 'Never sets from here (circumpolar)' : 'Never rises from here';
    else rsText = `${rs.rise ? `Rises ${fmtTime(rs.rise)}` : ''}${rs.rise && rs.set ? ' · ' : ''}${rs.set ? `Sets ${fmtTime(rs.set)}` : ''}`;
    html += `<h3>${escapeHtml(c.name)}</h3><p class="sub">${escapeHtml(MEANING[s.id] || '')}</p>
      <div class="find">${directionText(cc.hor, escapeHtml(c.name))}</div>
      ${NOTES[s.id] ? `<p>${escapeHtml(NOTES[s.id])}</p>` : ''}
      <dl class="facts">
        <dt>Right now</dt><dd>${Math.round(c.frac * 100)}% of its stars above the horizon</dd>
        <dt>Rise / set</dt><dd>${rsText}</dd>
        <dt>Best tonight</dt><dd>${best.alt > 0 ? `${fmtTime(best.time)}, ${Math.round(best.alt)}° up` : 'Not visible during darkness'}</dd>
        <dt>Brightest star</dt><dd>${escapeHtml(bName)}</dd>
        <dt>Best season</dt><dd>${bestMonth(cc.ra)} evenings</dd>
        <dt>Visible from</dt><dd>${latStr(latMax)} to ${latStr(latMin)}</dd>
      </dl>`;
  } else if (s.type === 'star') {
    const [ra, dec, mag, bv] = STARS[s.idx];
    const h = hor(ra, dec);
    const con = starCon[s.idx];
    const color = bv < 0 ? 'blue-white' : bv < 0.3 ? 'white' : bv < 0.6 ? 'yellow-white' : bv < 1.0 ? 'yellow' : bv < 1.4 ? 'orange' : 'red-orange';
    const name = starName.get(s.idx) || `A ${color} star`;
    html += `<h3>${escapeHtml(name)}</h3><p class="sub">${con ? `in ${escapeHtml(CONS[con].name)}` : ''} &middot; magnitude ${mag.toFixed(1)} &middot; ${color}</p>
      <div class="find">${directionText(h, escapeHtml(name))}</div>
      ${con ? `<p><button type="button" class="linkish" data-con="${con}">Show ${escapeHtml(CONS[con].name)} →</button></p>` : ''}`;
  } else {
    let body, name, extra = '';
    if (s.type === 'moon') {
      name = 'The Moon';
      body = { ra: frame.moon.ra, dec: frame.moon.dec, hor: frame.moonHor };
      extra = `${moonPhaseName(frame.moon)}, ${Math.round(frame.moon.illumination * 100)}% illuminated, ${frame.moon.age.toFixed(1)} days old.`;
    } else if (s.type === 'sun') {
      name = 'The Sun';
      body = { ra: frame.sun.ra, dec: frame.sun.dec, hor: frame.sunHor };
      extra = 'Never look directly at the Sun.';
    } else {
      const p = frame.planets.find((x) => x.id === s.id);
      name = p.name;
      body = p;
      extra = `Magnitude ${p.mag.toFixed(1)}, ${p.dist.toFixed(2)} AU (${(p.dist * 8.317).toFixed(1)} light-minutes) away. Planets shine steadily while stars twinkle.`;
    }
    const posFn = s.type === 'moon' ? (d) => moonPosition(d) : s.type === 'sun' ? (d) => sunPosition(d) : (d) => planetPositions(d).find((x) => x.id === s.id);
    const rs = riseSet(posFn, state.time);
    const con = constellationAt(body.ra, body.dec, BOUNDS);
    html += `<h3>${name}</h3><p class="sub">${con ? `in ${escapeHtml(CONS[con].name)}` : ''}</p>
      <div class="find">${directionText(body.hor, name)}</div>
      <p>${extra}</p>
      <dl class="facts"><dt>Next rise</dt><dd>${fmtTime(rs.rise)}</dd><dt>Next set</dt><dd>${fmtTime(rs.set)}</dd></dl>`;
  }
  el.innerHTML = html;
}

// ---------- controls ----------

function syncControls() {
  $('date-input').value = localDateStr(state.time);
  $('time-input').value = localTimeStr(state.time);
  const start = nightStart(state.time);
  $('time-slider').value = Math.round((state.time - start) / 60000);
  $('coords').textContent = `${formatCoords(state.lat, state.lon)} · ${(state.tz || DEVICE_TZ).replace(/_/g, ' ')}`;
  if (document.activeElement !== $('place-input')) $('place-input').value = state.place;
  document.querySelectorAll('.view-toggle button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === state.filter)));
  for (const k of ['lines', 'labels', 'stars', 'planets', 'bounds', 'grid', 'ecliptic']) $(`opt-${k}`).checked = state.opts[k];
  $('opt-mag').value = String(state.opts.mag);
  $('red-btn').setAttribute('aria-pressed', String(state.red));
  $('red-overlay').hidden = !state.red;
  document.body.classList.toggle('red', state.red);
  $('play-btn').setAttribute('aria-pressed', String(state.playing));
  $('play-btn').innerHTML = state.playing ? '&#10073;&#10073;' : '&#9654;';
  $('compass-btn').setAttribute('aria-pressed', String(state.heading !== null));
}

function updateSliderTrack() {
  if (!night) return;
  const stops = [];
  for (let i = 0; i <= 48; i++) {
    const t = new Date(night.start.getTime() + i * 30 * 60000);
    const s = sunAltAt(t);
    const col = s > 0 ? '#5a86c8' : s > -6 ? '#3b3f7a' : s > -12 ? '#22264f' : s > -18 ? '#151836' : '#07081a';
    stops.push(`${col} ${(i / 48 * 100).toFixed(1)}%`);
  }
  $('time-slider').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
}
function sunAltAt(t) {
  const s = sunPosition(t);
  return equToHor(s.ra, s.dec, state.lat, localSiderealTime(t, state.lon)).alt;
}

function setTime(t, { keepPlaying = false } = {}) {
  state.time = t;
  if (!keepPlaying && state.playing) state.playing = false;
  syncControls();
  requestRender();
}

function setLocation(lat, lon, place, tz = null) {
  state.lat = clamp(lat, -90, 90);
  state.lon = clamp(lon, -180, 180);
  state.place = place || formatCoords(lat, lon);
  state.tz = tz && validTz(tz) ? tz : null;
  night = null;
  if (!state.tz) resolveTz();
  state.facing = null;
  persist();
  syncControls();
  requestRender();
}

function select(sel, { switchView = true } = {}) {
  state.selected = sel;
  if (sel && switchView) {
    let alt = null;
    if (sel.type === 'con') alt = frame.consById[sel.id].main.hor.alt;
    if (alt !== null) {
      const want = alt >= 0 ? 'up' : 'down';
      if (want !== state.view) { state.view = want; state.panX = state.panY = 0; state.zoom = 1; syncControls(); }
    }
  }
  lastSelKey = '';
  requestRender();
  if (sel && window.innerWidth <= 920) $('selection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function bindControls() {
  $('date-input').addEventListener('change', (e) => {
    const [y, m, d] = e.target.value.split('-').map(Number);
    if (!y) return;
    const w = wall(state.time);
    setTime(fromWall(y, m, d, w.h, w.mi));
  });
  $('time-input').addEventListener('change', (e) => {
    const [h, m] = e.target.value.split(':').map(Number);
    if (isNaN(h)) return;
    const w = wall(state.time);
    setTime(fromWall(w.y, w.m, w.d, h, m));
  });
  $('time-slider').addEventListener('input', (e) => {
    const start = nightStart(state.time);
    setTime(new Date(start.getTime() + Number(e.target.value) * 60000));
  });
  $('now-btn').addEventListener('click', () => setTime(new Date()));
  $('tonight-btn').addEventListener('click', () => {
    const n = ensureNight();
    if (n.mfStart && n.mfEnd - n.mfStart > HOUR) setTime(new Date((n.mfStart.getTime() + n.mfEnd.getTime()) / 2));
    else if (n.darkFrom) setTime(new Date(Math.max(n.darkFrom.getTime() + HOUR, Math.min(n.darkTo.getTime(), n.darkFrom.getTime() + 2 * HOUR))));
    else setTime(new Date(n.start.getTime() + 12 * HOUR));
  });
  $('back-btn').addEventListener('click', () => setTime(new Date(state.time.getTime() - HOUR)));
  $('fwd-btn').addEventListener('click', () => setTime(new Date(state.time.getTime() + HOUR)));
  $('play-btn').addEventListener('click', () => {
    state.playing = !state.playing;
    syncControls();
    if (state.playing) play();
  });

  document.querySelectorAll('.view-toggle button').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    state.zoom = 1; state.panX = 0; state.panY = 0;
    syncControls();
    requestRender();
  }));
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $('con-search').value = '';
    syncControls();
    renderConList();
  }));
  $('con-search').addEventListener('input', () => renderConList());

  for (const k of ['lines', 'labels', 'stars', 'planets', 'bounds', 'grid', 'ecliptic']) {
    $(`opt-${k}`).addEventListener('change', (e) => { state.opts[k] = e.target.checked; persist(); requestRender(); });
  }
  $('opt-mag').addEventListener('change', (e) => { state.opts.mag = Number(e.target.value); persist(); requestRender(); });
  $('red-btn').addEventListener('click', () => { state.red = !state.red; persist(); syncControls(); });

  // Delegated clicks for constellation links/rows, planets, selection close.
  document.addEventListener('click', (e) => {
    const conEl = e.target.closest('[data-con]');
    if (conEl) { select({ type: 'con', id: conEl.dataset.con }); return; }
    const pl = e.target.closest('#planet-list li');
    if (pl) { select({ type: pl.dataset.type, id: pl.dataset.id }); return; }
    if (e.target.closest('[data-close]')) select(null);
  });

  $('zoom-in').addEventListener('click', () => zoomAt(view.cx, view.cy, 1.5));
  $('zoom-out').addEventListener('click', () => zoomAt(view.cx, view.cy, 1 / 1.5));
  $('zoom-reset').addEventListener('click', () => {
    state.zoom = 1; state.panX = 0; state.panY = 0; state.facing = null;
    requestRender();
  });
  $('compass-btn').addEventListener('click', toggleCompass);
  $('share-btn').addEventListener('click', share);

  bindPlaceSearch();
  $('locate-btn').addEventListener('click', () => locate(true));
}

function play() {
  let last = performance.now();
  const step = (now) => {
    if (!state.playing) return;
    const dt = Math.min(100, now - last);
    last = now;
    setTime(new Date(state.time.getTime() + dt * 3600), { keepPlaying: true }); // 1 hour per second
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- chart interaction ----------

function zoomAt(x, y, factor) {
  const z = clamp(state.zoom * factor, 1, 10);
  const f = z / state.zoom;
  state.panX = (state.panX + view.cx - x) * f - view.cx + x;
  state.panY = (state.panY + view.cy - y) * f - view.cy + y;
  state.zoom = z;
  clampPan();
  requestRender();
}

function clampPan() {
  const max = view.R * (state.zoom - 1) + 20;
  state.panX = clamp(state.panX, -max, max);
  state.panY = clamp(state.panY, -max, max);
  if (state.zoom === 1) { state.panX = 0; state.panY = 0; }
}

function hitTest(x, y) {
  for (const b of bodyScreen) if (Math.hypot(b.x - x, b.y - y) < b.r) return { type: b.type, id: b.id };
  let best = -1, bestScore = 14;
  for (let i = 0; i < STARS.length; i++) {
    if (!starDrawn[i]) continue;
    const d = Math.hypot(starScreen[i * 2] - x, starScreen[i * 2 + 1] - y);
    if (d > 14) continue;
    const score = d - (5 - STARS[i][2]) * 0.8;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best >= 0) return { type: 'star', idx: best };
  const p = unproject(x, y);
  if (p.dist > 92) return null;
  const eq = horToEqu(p.alt, p.az, state.lat, frame.lst);
  const id = constellationAt(eq.ra, eq.dec, BOUNDS);
  return id ? { type: 'con', id } : null;
}

function labelFor(hit) {
  if (!hit) return '';
  if (hit.type === 'star') {
    const n = starName.get(hit.idx);
    const con = starCon[hit.idx];
    return `${n ? `<b>${escapeHtml(n)}</b>` : 'Star'} &middot; mag ${STARS[hit.idx][2].toFixed(1)}${con ? ` &middot; ${escapeHtml(CONS[con].name)}` : ''}`;
  }
  if (hit.type === 'con') return `<b>${escapeHtml(CONS[hit.id].name)}</b> &middot; ${escapeHtml(MEANING[hit.id] || '')}`;
  if (hit.type === 'planet') return `<b>${frame.planets.find((p) => p.id === hit.id).name}</b>`;
  return `<b>${hit.type === 'moon' ? 'Moon' : 'Sun'}</b>`;
}

function bindChart() {
  const pointers = new Map();
  let dragStart = null, pinch = null, moved = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    moved = false;
    if (pointers.size === 1) {
      const [x, y] = pos(e);
      dragStart = { x, y, panX: state.panX, panY: state.panY };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: state.zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const tip = $('tooltip');
        const html = labelFor(hitTest(x, y));
        tip.hidden = !html;
        if (html) { tip.innerHTML = html; tip.style.left = `${x}px`; tip.style.top = `${y}px`; }
      }
      return;
    }
    pointers.set(e.pointerId, [x, y]);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(pinch.mx, pinch.my, (pinch.zoom * d / pinch.d) / state.zoom);
      moved = true;
    } else if (dragStart) {
      const dx = x - dragStart.x, dy = y - dragStart.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved && state.zoom > 1) {
        state.panX = dragStart.panX + dx;
        state.panY = dragStart.panY + dy;
        clampPan();
        canvas.classList.add('dragging');
        requestRender();
      }
    }
  });
  const end = (e) => {
    const wasTap = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) dragStart = null;
    if (wasTap && e.type === 'pointerup') {
      const [x, y] = pos(e);
      select(hitTest(x, y), { switchView: false });
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { $('tooltip').hidden = true; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const [x, y] = pos(e); zoomAt(x, y, 2); });
}

// ---------- compass ----------

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha !== null) h = 360 - e.alpha;
  if (h === null) return;
  const screenAngle = (screen.orientation && screen.orientation.angle) || 0;
  state.heading = norm360(h + screenAngle);
  requestRender();
}

async function toggleCompass() {
  if (state.heading !== null || toggleCompass.on) {
    toggleCompass.on = false;
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    window.removeEventListener('deviceorientation', onOrientation);
    state.heading = null;
    syncControls();
    requestRender();
    return;
  }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('denied');
    }
  } catch {
    alert('Compass access was not granted.');
    return;
  }
  toggleCompass.on = true;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  else window.addEventListener('deviceorientation', onOrientation);
  setTimeout(() => {
    if (toggleCompass.on && state.heading === null) {
      // No compass data: fall back to cycling the facing direction manually.
      toggleCompass.on = false;
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
      const cur = state.facing ?? (state.lat >= 0 ? 180 : 0);
      state.facing = norm360(cur + 90);
      flash(`No compass on this device — now facing ${compassPoint(state.facing)}. Tap again to turn.`);
      requestRender();
    }
    syncControls();
  }, 1200);
  syncControls();
}

function flash(msg) {
  const b = $('sky-banner');
  b.hidden = false;
  b.textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => requestRender(), 2500);
}

// ---------- location ----------

function locate(userInitiated) {
  if (!navigator.geolocation) { if (userInitiated) flash('Geolocation is not available.'); return; }
  $('locate-btn').disabled = true;
  navigator.geolocation.getCurrentPosition((p) => {
    $('locate-btn').disabled = false;
    setLocation(Math.round(p.coords.latitude * 100) / 100, Math.round(p.coords.longitude * 100) / 100, 'My location', DEVICE_TZ);
  }, () => {
    $('locate-btn').disabled = false;
    if (userInitiated) flash('Could not get your location — search for a city instead.');
  }, { timeout: 10000, maximumAge: 3600000 });
}

function bindPlaceSearch() {
  const input = $('place-input');
  const list = $('place-results');
  let timer = null, results = [], active = -1, seq = 0;
  const show = () => {
    list.innerHTML = results.map((r, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">${escapeHtml(r.name)} <small>${escapeHtml(r.region || '')}</small></li>`).join('');
    list.hidden = !results.length;
  };
  const choose = (r) => {
    setLocation(r.lat, r.lon, r.region ? `${r.name}, ${r.region}` : r.name, r.tz);
    results = []; show();
    input.blur();
  };
  input.addEventListener('focus', () => { input.select(); });
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    const local = CITIES.filter(([n]) => n.toLowerCase().includes(q.toLowerCase())).map(([n, lat, lon]) => ({ name: n, lat, lon }));
    results = q ? local.slice(0, 4) : CITIES.map(([n, lat, lon]) => ({ name: n, lat, lon }));
    active = -1;
    show();
    if (q.length < 2) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
        const data = await res.json();
        if (my !== seq) return;
        const remote = (data.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country_code].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, tz: r.timezone }));
        results = [...local.slice(0, 2), ...remote];
        show();
      } catch { /* offline: keep local matches */ }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const m = input.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { setLocation(parseFloat(m[1]), parseFloat(m[2])); results = []; show(); input.blur(); return; }
      if (results.length) choose(results[Math.max(0, active)]);
    } else if (e.key === 'Escape') { results = []; show(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { results = []; show(); input.value = state.place; }, 200));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); choose(results[Number(li.dataset.i)]); }
  });
}

async function share() {
  const u = new URL(location.href.split('?')[0]);
  u.searchParams.set('lat', state.lat.toFixed(2));
  u.searchParams.set('lon', state.lon.toFixed(2));
  u.searchParams.set('place', state.place);
  u.searchParams.set('t', state.time.toISOString());
  if (state.tz) u.searchParams.set('tz', state.tz);
  if (state.view === 'down') u.searchParams.set('view', 'down');
  if (state.selected?.type === 'con') u.searchParams.set('con', state.selected.id);
  try {
    await navigator.clipboard.writeText(u.toString());
    flash('Link copied!');
  } catch {
    prompt('Copy this link:', u.toString());
  }
}

// ---------- boot ----------

bindControls();
bindChart();
syncControls();
new ResizeObserver(resize).observe(canvas.parentElement);
resize();
setInterval(() => {
  // Keep "now" live when the user hasn't scrubbed away from the present.
  if (!state.playing && Math.abs(Date.now() - state.time.getTime()) < 5 * 60000) setTime(new Date(), { keepPlaying: true });
}, 60000);
if (!state.tz) resolveTz();
if (!saved.loc && !params.has('lat')) locate(false);
