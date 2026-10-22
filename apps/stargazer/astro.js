// Low-precision astronomy: good to a fraction of a degree, plenty for naked-eye
// stargazing. Angles are degrees unless noted; azimuth runs N=0, E=90.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
export const norm360 = (d) => ((d % 360) + 360) % 360;
const norm180 = (d) => { const x = norm360(d); return x > 180 ? x - 360 : x; };

export const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;
const daysJ2000 = (date) => julianDay(date) - 2451545.0;

export function localSiderealTime(date, lonDeg) {
  const d = daysJ2000(date);
  const T = d / 36525;
  const gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T;
  return norm360(gmst + lonDeg);
}

// Equatorial <-> horizontal share the same rotation, so one helper does both.
function rotate(latDeg, a, b) {
  // a = declination (or altitude), b = hour angle (or azimuth)
  const s = sin(latDeg) * sin(a) + cos(latDeg) * cos(a) * cos(b);
  const out = Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
  const y = -cos(a) * sin(b);
  const x = sin(a) * cos(latDeg) - cos(a) * cos(b) * sin(latDeg);
  return [out, norm360(Math.atan2(y, x) * DEG)];
}

export function equToHor(raDeg, decDeg, latDeg, lst) {
  const [alt, az] = rotate(latDeg, decDeg, lst - raDeg);
  return { alt, az };
}

export function horToEqu(alt, az, latDeg, lst) {
  const [dec, ha] = rotate(latDeg, alt, az);
  return { ra: norm360(lst - ha), dec };
}

export function angularSeparation(ra1, dec1, ra2, dec2) {
  const c = sin(dec1) * sin(dec2) + cos(dec1) * cos(dec2) * cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

const OBLIQUITY = 23.4393;
function eclToEqu(x, y, z) {
  const ye = y * cos(OBLIQUITY) - z * sin(OBLIQUITY);
  const ze = y * sin(OBLIQUITY) + z * cos(OBLIQUITY);
  return {
    ra: norm360(Math.atan2(ye, x) * DEG),
    dec: Math.atan2(ze, Math.hypot(x, ye)) * DEG,
    dist: Math.hypot(x, y, z),
  };
}

export function eclipticToEquatorial(lonDeg, latDeg = 0) {
  return eclToEqu(cos(latDeg) * cos(lonDeg), cos(latDeg) * sin(lonDeg), sin(latDeg));
}

// JPL "Approximate Positions of the Planets" Keplerian elements (1800-2050).
// [a, e, I, L, longPeri, longNode] and their rates per Julian century.
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

function heliocentric(name, T) {
  const [el, rate] = ELEMENTS[name];
  const [a, e, I, L, peri, node] = el.map((v, i) => v + rate[i] * T);
  const w = peri - node;
  const M = norm180(L - peri);
  let E = M + (e * DEG) * sin(M);
  for (let i = 0; i < 8; i++) {
    E -= (E - (e * DEG) * sin(E) - M) / (1 - e * cos(E));
  }
  const xp = a * (cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(E);
  return [
    (cos(w) * cos(node) - sin(w) * sin(node) * cos(I)) * xp + (-sin(w) * cos(node) - cos(w) * sin(node) * cos(I)) * yp,
    (cos(w) * sin(node) + sin(w) * cos(node) * cos(I)) * xp + (-sin(w) * sin(node) + cos(w) * cos(node) * cos(I)) * yp,
    sin(w) * sin(I) * xp + cos(w) * sin(I) * yp,
  ];
}

export function sunPosition(date) {
  const T = daysJ2000(date) / 36525;
  const [x, y, z] = heliocentric('earth', T);
  const pos = eclToEqu(-x, -y, -z);
  pos.eclLon = norm360(Math.atan2(-y, -x) * DEG);
  return pos;
}

export const PLANETS = [
  { id: 'mercury', name: 'Mercury', color: '#c9b8a6', H: -0.42 },
  { id: 'venus', name: 'Venus', color: '#fff4d6', H: -4.4 },
  { id: 'mars', name: 'Mars', color: '#ff8a5c', H: -1.52 },
  { id: 'jupiter', name: 'Jupiter', color: '#ffe3b3', H: -9.4 },
  { id: 'saturn', name: 'Saturn', color: '#f2d98d', H: -8.88 },
];

export function planetPositions(date) {
  const T = daysJ2000(date) / 36525;
  const earth = heliocentric('earth', T);
  return PLANETS.map((p) => {
    const h = heliocentric(p.id, T);
    const g = [h[0] - earth[0], h[1] - earth[1], h[2] - earth[2]];
    const pos = eclToEqu(g[0], g[1], g[2]);
    const r = Math.hypot(...h);
    const delta = pos.dist;
    // Phase angle (sun-planet-earth) for a rough brightness estimate.
    const cosPhase = (r * r + delta * delta - Math.hypot(...earth) ** 2) / (2 * r * delta);
    const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * DEG;
    const mag = p.H + 5 * Math.log10(r * delta) + 0.02 * phase;
    return { ...p, ra: pos.ra, dec: pos.dec, mag, dist: delta };
  });
}

// Moon after Paul Schlyter's method with the main perturbation terms (~0.3°).
export function moonPosition(date) {
  const d = julianDay(date) - 2451543.5;
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.0549;
  const M = norm360(115.3654 + 13.0649929509 * d);
  const Ms = norm360(356.047 + 0.9856002585 * d);
  const ws = 282.9404 + 4.70935e-5 * d;

  let E = M + e * DEG * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 6; k++) E -= (E - e * DEG * sin(E) - M) / (1 - e * cos(E));
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = Math.atan2(yv, xv) * DEG;
  let r = Math.hypot(xv, yv);
  const xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i));
  const yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i));
  const zh = r * sin(v + w) * sin(i);
  let lon = Math.atan2(yh, xh) * DEG;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) * DEG;

  const Ls = Ms + ws;
  const Lm = M + w + N;
  const D = Lm - Ls;
  const F = Lm - N;
  lon += -1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms) - 0.059 * sin(2 * M - 2 * D)
    - 0.057 * sin(M - 2 * D + Ms) + 0.053 * sin(M + 2 * D) + 0.046 * sin(2 * D - Ms)
    + 0.041 * sin(M - Ms) - 0.035 * sin(D) - 0.031 * sin(M + Ms) - 0.015 * sin(2 * F - 2 * D)
    + 0.011 * sin(M - 4 * D);
  lat += -0.173 * sin(F - 2 * D) - 0.055 * sin(M - F - 2 * D) - 0.046 * sin(M + F - 2 * D)
    + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * M + F);
  r += -0.58 * cos(M - 2 * D) - 0.46 * cos(2 * D);

  const pos = eclipticToEquatorial(lon, lat);
  const sunLon = sunPosition(date).eclLon;
  const elong = norm360(lon - sunLon);
  return {
    ra: pos.ra,
    dec: pos.dec,
    distEarthRadii: r,
    illumination: (1 - cos(elong)) / 2,
    waxing: elong < 180,
    age: elong / 360 * 29.530589,
    elongation: elong,
  };
}

export function moonPhaseName(moon) {
  const e = moon.elongation;
  if (e < 10 || e > 350) return 'New Moon';
  if (e < 80) return 'Waxing Crescent';
  if (e < 100) return 'First Quarter';
  if (e < 170) return 'Waxing Gibbous';
  if (e < 190) return 'Full Moon';
  if (e < 260) return 'Waning Gibbous';
  if (e < 280) return 'Last Quarter';
  return 'Waning Crescent';
}

// Topocentric correction: the Moon is close enough that parallax is ~1°.
export function moonHorizontal(date, lat, lon) {
  const m = moonPosition(date);
  const h = equToHor(m.ra, m.dec, lat, localSiderealTime(date, lon));
  h.alt -= Math.asin(1 / m.distEarthRadii) * DEG * cos(h.alt);
  return h;
}

// Scan a time window for altitude crossings of a body. altFn(date) -> degrees.
export function findCrossings(altFn, start, hours, threshold, stepMin = 6) {
  const out = [];
  const step = stepMin * 60000;
  let t0 = start.getTime();
  let a0 = altFn(new Date(t0)) - threshold;
  const end = t0 + hours * 3600000;
  for (let t1 = t0 + step; t1 <= end; t1 += step) {
    const a1 = altFn(new Date(t1)) - threshold;
    if ((a0 < 0) !== (a1 < 0)) {
      let lo = t0, hi = t1, alo = a0;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        const am = altFn(new Date(mid)) - threshold;
        if ((am < 0) === (alo < 0)) { lo = mid; alo = am; } else hi = mid;
      }
      out.push({ time: new Date((lo + hi) / 2), rising: a1 > a0 });
    }
    t0 = t1; a0 = a1;
  }
  return out;
}

export const sunAltitude = (date, lat, lon) => {
  const s = sunPosition(date);
  return equToHor(s.ra, s.dec, lat, localSiderealTime(date, lon)).alt;
};

// Night summary for the evening starting on `noon` (local noon) through next noon.
export function nightEvents(noon, lat, lon) {
  const sunAlt = (d) => sunAltitude(d, lat, lon);
  const first = (arr, rising) => (arr.find((c) => c.rising === rising) || {}).time || null;
  const ev = {};
  for (const [key, thr] of [['sun', -0.833], ['civil', -6], ['nautical', -12], ['astro', -18]]) {
    const c = findCrossings(sunAlt, noon, 24, thr);
    const set = first(c, false);
    ev[key + 'Set'] = set;
    // The morning event must follow the evening one.
    ev[key + 'Rise'] = set ? (c.find((x) => x.rising && x.time > set) || {}).time || null : first(c, true);
  }
  const moonAlt = (d) => moonHorizontal(d, lat, lon).alt + 0.5;
  const mc = findCrossings(moonAlt, noon, 24, 0, 10);
  ev.moonRise = first(mc, true);
  ev.moonSet = first(mc, false);
  ev.midnightSunAlt = sunAlt(new Date(noon.getTime() + 12 * 3600000));
  ev.noonSunAlt = sunAlt(noon);
  return ev;
}

// Point-in-constellation lookup using the IAU boundary polygons.
export function constellationAt(ra, dec, bounds) {
  for (const id in bounds) {
    for (const poly of bounds[id]) {
      if (insidePolygon(ra, dec, poly)) return id;
    }
  }
  return null;
}

function insidePolygon(ra, dec, poly) {
  // Cast a ray due north along the point's meridian and count edge crossings.
  // Polygons wrapping the north pole invert the count.
  let crossings = 0;
  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ra1, d1] = poly[i];
    const [ra2, d2] = poly[(i + 1) % poly.length];
    const x1 = norm180(ra1 - ra);
    const dx = norm180(ra2 - ra1);
    const x2 = x1 + dx;
    winding += dx;
    if ((x1 <= 0 && x2 > 0) || (x2 <= 0 && x1 > 0)) {
      const t = -x1 / (x2 - x1);
      if (d1 + t * (d2 - d1) > dec) crossings++;
    }
  }
  const enclosesPole = Math.abs(winding) > 180;
  const north = enclosesPole && poly.reduce((s, p) => s + p[1], 0) > 0;
  return (crossings % 2 === 1) !== north;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassPoint = (az) => COMPASS[Math.round(norm360(az) / 22.5) % 16];

export function bvToColor(bv) {
  // Rough black-body tint: blue-white hot stars to orange-red cool ones.
  const t = Math.max(-0.4, Math.min(2, bv));
  let r, g, b;
  if (t < 0) { r = 170 + t * 100; g = 191 + t * 60; b = 255; }
  else if (t < 0.4) { r = 170 + t * 212; g = 191 + t * 160; b = 255 - t * 40; }
  else if (t < 1.2) { r = 255; g = 255 - (t - 0.4) * 95; b = 239 - (t - 0.4) * 190; }
  else { r = 255; g = 179 - (t - 1.2) * 60; b = 87 - (t - 1.2) * 40; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
