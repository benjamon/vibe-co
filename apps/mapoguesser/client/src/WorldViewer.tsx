import { useEffect, useRef } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  CustomDataSource,
  GeoJsonDataSource,
  HeadingPitchRange,
  HeightReference,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PolylineOutlineMaterialProperty,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useGameStore, type Marker, type CityInfo } from './store'
import { resolveSubMode } from './gameModes'
import { ALL_GUESSES } from './stats'

// Cesium would otherwise reach Cesium ion for default assets; blank the token
// so the only network calls are to our chosen tile provider.
Ion.defaultAccessToken = ''

// Camera distance from Earth's centre (metres). Earth's radius is ~6.4 Mm.
const INITIAL_RANGE = 25_000_000
const MIN_RANGE = 7_000_000
const MAX_RANGE = 24_000_000

// Streamed imagery LOD cap. z12 is ~9 km/pixel at the equator — plenty of
// detail for a globe view without ballooning tile fetches.
const MAX_TILE_LEVEL = 12

// --- Rendering performance knobs -------------------------------------------
// These trade visual fidelity for GPU / bandwidth savings that matter most on
// phones, so the quality-reducing ones are gated to mobile via IS_MOBILE:
// desktop renders at full quality, mobile takes the cheaper path. Each knob is
// consumed in exactly one place (see the viewer setup), so retuning — or
// flipping any of these back to a flat global value — is a one-line edit.
const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent,
  )
// Multisample anti-aliasing. 4 is crisp but a heavy fillrate tax on mobile
// GPUs, so desktop gets 4 while mobile drops to 1 (off) and leans on FXAA.
const MSAA_SAMPLES = IS_MOBILE ? 1 : 3
// FXAA: a cheap screen-space AA post-pass. Left on everywhere — it's nearly
// free, smooths the black border lines and label text, and is what carries
// edge quality on mobile where MSAA is off.
const USE_FXAA = true
// Render resolution relative to CSS pixels. Left at 1 on every device: the big
// high-DPR-phone saving already comes from useBrowserRecommendedResolution
// (default true, ignoring devicePixelRatio), and going below 1 here subsamples
// the whole framebuffer and makes thin high-contrast lines crawl / pixelate.
const RESOLUTION_SCALE = 1
// Globe screen-space error tolerance. Higher = coarser tiles, so fewer tile
// fetches and draw calls. Desktop uses Cesium's default (2); mobile relaxes
// to 4 to cut bandwidth and draw calls.
const MAX_SCREEN_SPACE_ERROR = IS_MOBILE ? 4 : 3
// Atmosphere + fog are fillrate cosmetics: on for desktop (nicer limb glow),
// off on mobile to save fill.
const SHOW_ATMOSPHERE = !IS_MOBILE
// Base-imagery brightness multiplier. 1.0 is the raw satellite tiles; 1.3
// lightens the whole globe by 30%.
const GLOBE_BRIGHTNESS = 1.15
// Base-imagery contrast multiplier. 1.0 is the raw tiles; 0.9 softens contrast
// by 10% (flatter highs/lows, gentler look behind the black border lines).
const GLOBE_CONTRAST = 0.9

// Natural Earth 50m admin-0 datasets. Borders for visible lines, polygons for
// CPU point-in-polygon hit-testing. Served via jsDelivr's GitHub mirror.
const COUNTRY_BORDERS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_boundary_lines_land.geojson'
// Coastlines: the land/water outline of every landmass and island. Borders only
// cover lines *between* countries, so island nations (Åland, Trinidad & Tobago)
// and territories (French Polynesia, …) — which border no one — get no outline
// without this. Drawn with the same style as borders.
const COASTLINE_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_coastline.geojson'
const COUNTRY_POLYGONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson'
// Populated places (50m set, ~1250 cities with pop_max + adm0cap). Drives the
// cities game modes (World Capitals + regional "largest cities") and doubles as
// the source for the flag-pin fallback (a country's capital, validated inside).
const POPULATED_PLACES_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_populated_places_simple.geojson'
// US state / province boundary lines. Fetched, filtered to the USA, and drawn as
// a hidden layer that's only shown during the North America cities mode.
const STATE_LINES_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lines.geojson'

// The 48 World Cup qualifiers, keyed by ISO 3166-1 alpha-2 (lowercase) — the
// most reliable match against Natural Earth, whose NAME spellings vary. England
// and Scotland both belong to the United Kingdom (gb) on this map, so the 48
// teams collapse to 46 unique map countries. Curaçao (cw) is below the normal
// playable-area threshold but is included anyway for this edition. Verified:
// every code below resolves to exactly one sovereign state in ne_50m (after the
// largest-area-per-ISO dedupe that drops shared-code dependent territories like
// Australia's Ashmore Is.).
const WORLD_CUP_ISO = new Set<string>([
  // Hosts
  'ca', 'mx', 'us',
  // AFC
  'au', 'ir', 'iq', 'jp', 'jo', 'qa', 'sa', 'kr',
  // CAF
  'dz', 'cv', 'cd', 'ci', 'eg', 'gh', 'ma', 'sn', 'za', 'tn',
  // Concacaf
  'cw', 'ht', 'pa',
  // CONMEBOL
  'ar', 'br', 'co', 'ec', 'py', 'uy',
  // OFC
  'nz',
  // UEFA (England + Scotland → United Kingdom / gb)
  'at', 'be', 'ba', 'hr', 'cz', 'gb', 'fr', 'de', 'nl', 'no', 'pt', 'es',
  'se', 'ch', 'tr',
])

// Reveal animation duration when the player misses twice on the same target.
const REVEAL_MS = 1200

// Multiplier on the (physically-calibrated) drag sensitivity. 1.0 tracks the
// cursor ~1:1 at screen centre; raise for a faster spin, lower for finer
// control. See surfaceRadiansPerPixel for the per-pixel calibration itself.
const DRAG_SENSITIVITY = 1.0

// Asymmetric pitch limits: 17.5° from the north pole, 30° from the south pole.
// Negative pitch sends the camera over the north (looking south); positive
// pitch sends it over the south (looking north). The north-pole gap was
// halved from 35° → 17.5° so the camera can swing further over the top of
// the globe.
const PITCH_MIN = -CesiumMath.toRadians(72.5)
const PITCH_MAX = CesiumMath.toRadians(60)

// Exponential decay rate for spin momentum (1/s). Higher = stops faster.
const FRICTION = 4.0
// Velocity below this threshold (rad/s) is treated as stopped.
const MIN_VELOCITY = 0.002
// Cap on release ("flick") angular velocity (rad/s), per axis. Without it a
// fast drag flings the globe into a wild multi-rotation spin. Total coast ≈
// cap / FRICTION radians, so 6 rad/s here ≈ a third of a turn on the hardest
// flick. Raise for a looser, spinnier feel; lower to tighten it further.
const MAX_FLICK_VELOCITY = 6.0
// Pointer travel (px) above which a press is treated as a drag, not a tap.
const TAP_THRESHOLD = 5
// Wheel deltaY → range scale factor.
const WHEEL_ZOOM_RATE = 0.0015

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

// Point-in-polygon helpers used for hover hit-testing. These run on the CPU
// against the raw GeoJSON; using scene.pick instead would force a full pick-
// pass render of every ground primitive on each cursor move, which lagged
// noticeably behind a fast-moving cursor.
type LatLon = [number, number]
type Ring = LatLon[]
type SubPolygon = Ring[] // [outer, ...holes]

const pointInRing = (lon: number, lat: number, ring: Ring): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-30) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

const pointInSubPolygon = (
  lon: number,
  lat: number,
  poly: SubPolygon,
): boolean => {
  if (!pointInRing(lon, lat, poly[0])) return false
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(lon, lat, poly[h])) return false
  }
  return true
}

const normalizeGeometry = (g: unknown): SubPolygon[] => {
  const geom = g as { type?: string; coordinates?: unknown }
  if (geom?.type === 'Polygon') return [geom.coordinates as SubPolygon]
  if (geom?.type === 'MultiPolygon') return geom.coordinates as SubPolygon[]
  return []
}

// Mean-of-vertices centroid over each polygon's outer ring. Cheaper than a
// proper area-weighted centroid and good enough for re-centering the camera
// on a country whose actual shape is being revealed.
const computeCentroid = (polys: SubPolygon[]): { lat: number; lon: number } => {
  let lonSum = 0
  let latSum = 0
  let count = 0
  for (const poly of polys) {
    const ring = poly[0]
    if (!ring) continue
    for (const pt of ring) {
      lonSum += pt[0]
      latSum += pt[1]
      count++
    }
  }
  return count > 0
    ? { lat: latSum / count, lon: lonSum / count }
    : { lat: 0, lon: 0 }
}

// Sum of |shoelace| areas (outer rings minus holes) in degrees². Used only as
// a relative size measure to exclude tiny island/city-state targets that are
// effectively unclickable on a globe view.
const computeArea = (polys: SubPolygon[]): number => {
  const ringArea = (ring: Ring): number => {
    let a = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
    }
    return Math.abs(a / 2)
  }
  let total = 0
  for (const poly of polys) {
    if (!poly[0]) continue
    total += ringArea(poly[0])
    for (let h = 1; h < poly.length; h++) total -= ringArea(poly[h])
  }
  return total
}

const computeBBox = (
  polys: SubPolygon[],
): [number, number, number, number] => {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      for (const pt of ring) {
        const lon = pt[0]
        const lat = pt[1]
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat]
}

export function WorldViewer() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Esri World Imagery: free, no API key required, satellite raster up to
    // ~z19. We cap at MAX_TILE_LEVEL to bound bandwidth.
    const baseLayer = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Tiles © Esri — World Imagery',
        maximumLevel: MAX_TILE_LEVEL,
      }),
      { brightness: GLOBE_BRIGHTNESS, contrast: GLOBE_CONTRAST },
    )

    const viewer = new Viewer(container, {
      baseLayer,
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      scene3DOnly: true,
      shouldAnimate: false,
      msaaSamples: MSAA_SAMPLES,
    })

    // Render-quality knobs (see the constants block up top). Centralised here
    // so each is set in exactly one spot and stays trivial to gate to mobile.
    viewer.resolutionScale = RESOLUTION_SCALE
    viewer.scene.postProcessStages.fxaa.enabled = USE_FXAA
    viewer.scene.globe.maximumScreenSpaceError = MAX_SCREEN_SPACE_ERROR
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = SHOW_ATMOSPHERE
    }
    viewer.scene.globe.showGroundAtmosphere = SHOW_ATMOSPHERE
    viewer.scene.fog.enabled = SHOW_ATMOSPHERE

    let destroyed = false

    // Clamp data-source primitives to the globe so they don't z-fight with
    // imagery. Affects the borders datasource below and the markers below.
    GeoJsonDataSource.clampToGround = true

    // Game markers (guess pins, reveal X markers) live in their own data
    // source so we can wipe them between games with one removeAll() call.
    const gameMarkers = new CustomDataSource('gameMarkers')
    viewer.dataSources.add(gameMarkers)

    // Stats highlight dots — driven by the sidebar's selected country. Lives
    // in a separate data source so picking a different row can wipe it with
    // a single removeAll() without disturbing the in-match game markers.
    const statsDots = new CustomDataSource('statsDots')
    viewer.dataSources.add(statsDots)

    // Capitals-mode overlays: the "draw circle" hint and the pin→answer line.
    // Its own data source so it can be cleared/redrawn each round independently
    // of the game markers.
    const overlays = new CustomDataSource('overlays')
    viewer.dataSources.add(overlays)

    // Flag-on-a-pole pin sprites. Composed on demand per (kind, code) because
    // flag images load asynchronously from flagcdn.com; cached so a re-render
    // of the same marker is free. The pole colour carries the meaning (green
    // correct / grey wrong / red reveal / blue the stats-screen location pin).
    type PinKind = Marker['kind'] | 'stats'
    const PIN_BG: Record<PinKind, string> = {
      correct: '#3fb84e',
      wrong: '#9aa0a6',
      reveal: '#e64545',
      stats: '#3d7bdb',
    }
    // Marker geometry. The pole is a thin vertical bar whose base touches the
    // clicked point; the flag flies off to the right from near its top.
    const POLE_W = 6 // pole thickness incl. its 1.5px outline
    const POLE_H = 48 // pole height == canvas height
    const FLAG_W = 40
    const FLAG_H = 28 // 4:3-ish to match flagcdn
    const FLAG_TOP = 2 // gap between flag top and the very top of the pole
    const PIN_W = POLE_W + FLAG_W // full canvas width
    const PIN_H = POLE_H // full canvas height
    const flagPinCache = new Map<string, Promise<string>>()

    const buildFlagPin = (
      code: string | undefined,
      kind: PinKind,
    ): Promise<string> => {
      const key = `${kind}:${code ?? '_'}`
      const cached = flagPinCache.get(key)
      if (cached) return cached
      const promise = (async () => {
        const canvas = document.createElement('canvas')
        canvas.width = PIN_W
        canvas.height = PIN_H
        const ctx = canvas.getContext('2d')
        if (!ctx) return ''

        // 1. Flag, flying right from the top of the pole. Tucked 1px behind
        //    the pole's right edge so the pole drawn next hides the seam.
        const flagX = POLE_W - 1
        let drewFlag = false
        if (code) {
          try {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve()
              img.onerror = () => reject(new Error('flag load failed'))
              img.src = `https://flagcdn.com/w160/${code}.png`
            })
            ctx.drawImage(img, flagX, FLAG_TOP, FLAG_W, FLAG_H)
            drewFlag = true
          } catch {
            // Flag fetch / CORS failure: fall back to a plain coloured flag.
          }
        }
        if (!drewFlag) {
          ctx.fillStyle = PIN_BG[kind]
          ctx.fillRect(flagX, FLAG_TOP, FLAG_W, FLAG_H)
        }
        // Thin dark border so a pale flag still reads against the globe.
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.lineWidth = 1
        ctx.strokeRect(flagX + 0.5, FLAG_TOP + 0.5, FLAG_W - 1, FLAG_H - 1)

        // 2. Pole on top, coloured by correctness with a black outline. Flat
        //    base (no bottom edge stroke) so it reads as touching the ground;
        //    rounded top as a finial.
        const inset = 0.75 // half the 1.5px stroke, kept inside the canvas
        const left = inset
        const right = POLE_W - inset
        const topR = (right - left) / 2
        ctx.beginPath()
        ctx.moveTo(left, POLE_H)
        ctx.lineTo(left, inset + topR)
        ctx.arcTo(left, inset, left + topR, inset, topR)
        ctx.arcTo(right, inset, right, inset + topR, topR)
        ctx.lineTo(right, POLE_H)
        ctx.fillStyle = PIN_BG[kind]
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#000'
        ctx.stroke()

        try {
          return canvas.toDataURL('image/png')
        } catch {
          // Canvas tainted (CORS lost) — drop the cached entry so a future
          // marker can retry, and return an empty string the caller can skip.
          flagPinCache.delete(key)
          return ''
        }
      })()
      flagPinCache.set(key, promise)
      return promise
    }

    // Country PIP/centroid index built from the raw GeoJSON. We don't render
    // the polygons (the hover highlight effect is gone), only use them for
    // hit-testing clicks and aiming the reveal animation.
    type LatLonPt = { lat: number; lon: number }
    type CountryEntry = {
      name: string
      bbox: [number, number, number, number]
      centroid: LatLonPt
      polygons: SubPolygon[]
      area: number
      // Natural Earth's manually-placed label anchor (LABEL_X/Y) — usually
      // inside the country; used as a flag-placement fallback.
      label?: LatLonPt
      // Normalised name variants, for matching this country to a capital city.
      aliases: string[]
    }
    let countryEntries: CountryEntry[] | null = null

    // Capital cities keyed by normalised country name. Loaded from CAPITALS_URL;
    // empty until then (placement just falls back to centroid/label meanwhile).
    // Carries the city name too, for the capitals game mode.
    type CapitalPt = LatLonPt & { city: string }
    const capitalByName = new Map<string, CapitalPt>()
    const normName = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '')

    // Is (lat, lon) inside any of the country's sub-polygons?
    const insideCountry = (entry: CountryEntry, lat: number, lon: number) =>
      entry.polygons.some((poly) => pointInSubPolygon(lon, lat, poly))

    // Where to plant a country's flag. The mean-of-vertices centroid lands
    // outside the borders for crescent/multi-island nations, so when that
    // happens fall back to the capital (validated inside), then the NE label
    // anchor, then the centroid as a last resort.
    const flagPointFor = (entry: CountryEntry): LatLonPt => {
      if (insideCountry(entry, entry.centroid.lat, entry.centroid.lon)) {
        return entry.centroid
      }
      for (const alias of entry.aliases) {
        const cap = capitalByName.get(alias)
        if (cap && insideCountry(entry, cap.lat, cap.lon)) return cap
      }
      if (entry.label && insideCountry(entry, entry.label.lat, entry.label.lon)) {
        return entry.label
      }
      return entry.centroid
    }

    // Every populated place from the dataset, kept raw until the country
    // polygons load so each can be joined to a country NAME (for the reveal flag
    // + the region filters). `capital` mirrors Natural Earth's adm0cap.
    type RawPlace = {
      neId: string
      city: string
      lat: number
      lon: number
      pop: number
      capital: boolean
      iso: string | null
      adm0: string
      sov0: string
      adm1: string
    }
    let rawPlaces: RawPlace[] = []
    let placesLoaded = false

    // Join every populated place to its Natural Earth country NAME (via ISO code,
    // then adm0/sov0 name) and publish the ne_id → CityInfo map that drives the
    // cities game modes. Runs once both the polygons and the places have landed.
    const publishCities = () => {
      if (!countryEntries || !placesLoaded) return
      // Normalised alias → country NAME. Country entries carry `iso:xx` plus name
      // variants as aliases; the first entry to claim an alias wins.
      const aliasToCountry = new Map<string, string>()
      for (const entry of countryEntries) {
        for (const alias of entry.aliases) {
          if (!aliasToCountry.has(alias)) aliasToCountry.set(alias, entry.name)
        }
      }
      const out: Record<string, CityInfo> = {}
      for (const p of rawPlaces) {
        let country: string | undefined
        if (p.iso) country = aliasToCountry.get(`iso:${p.iso}`)
        if (!country && p.adm0) country = aliasToCountry.get(normName(p.adm0))
        if (!country && p.sov0) country = aliasToCountry.get(normName(p.sov0))
        if (!country) continue
        out[p.neId] = {
          city: p.city,
          country,
          ...(p.adm1 ? { region: p.adm1 } : {}),
          lat: p.lat,
          lon: p.lon,
          pop: p.pop,
          capital: p.capital,
        }
      }
      useGameStore.getState().setCities(out)
    }

    fetch(POPULATED_PLACES_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('places'))))
      .then((geo: { features?: Array<Record<string, any>> }) => {
        if (destroyed || viewer.isDestroyed()) return
        const places: RawPlace[] = []
        for (const f of geo.features ?? []) {
          const p = f.properties ?? {}
          const coords = f.geometry?.coordinates
          if (!Array.isArray(coords) || coords.length < 2) continue
          const lon = Number(coords[0])
          const lat = Number(coords[1])
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
          const city = String(
            p.name ?? p.NAME ?? p.nameascii ?? p.NAMEASCII ?? '',
          )
          if (!city) continue
          const neId = String(p.ne_id ?? p.NE_ID ?? `${city}|${lat}|${lon}`)
          const pop = Number(p.pop_max ?? p.POP_MAX ?? 0) || 0
          const fcla = String(p.featurecla ?? p.FEATURECLA ?? '').toLowerCase()
          const capital =
            p.adm0cap === 1 ||
            p.ADM0CAP === 1 ||
            fcla === 'admin-0 capital' ||
            fcla === 'admin-0 capital alt'
          const isoRaw = p.iso_a2 ?? p.ISO_A2
          const iso =
            typeof isoRaw === 'string' && /^[A-Za-z]{2}$/.test(isoRaw)
              ? isoRaw.toLowerCase()
              : null
          const adm0 = String(p.adm0name ?? p.ADM0NAME ?? '')
          const sov0 = String(p.sov0name ?? p.SOV0NAME ?? '')
          const adm1 = String(p.adm1name ?? p.ADM1NAME ?? '')
          places.push({ neId, city, lat, lon, pop, capital, iso, adm0, sov0, adm1 })

          // Feed the flag-pin fallback: one capital per country, keyed by the
          // same aliases publishCities uses. First capital to claim a key wins.
          if (capital) {
            const value: CapitalPt = { lat, lon, city }
            const keys = [adm0, sov0]
            if (iso) keys.push(`iso:${iso}`)
            for (const key of keys) {
              if (!key) continue
              const n = key.startsWith('iso:') ? key : normName(key)
              if (n && !capitalByName.has(n)) capitalByName.set(n, value)
            }
          }
        }
        rawPlaces = places
        placesLoaded = true
        publishCities()
      })
      .catch(() => {
        // No places → flag placement falls back to label/centroid, and the
        // cities game modes stay unavailable (empty pool).
      })
    // Min total polygon area (deg²) for a country to be eligible as a target.
    // Excludes city-states and pinprick island nations that are effectively
    // unclickable on the globe (Vatican, Monaco, Tuvalu, Nauru, …).
    const MIN_TARGET_AREA = 0.1

    // Pulls an ISO 3166-1 alpha-2 code from a Natural Earth feature. Prefer
    // ISO_A2_EH ("Edward Hand" fix-up of disputed codes like Norway/France/
    // Kosovo); fall back to ISO_A2. The dataset uses "-99" as a sentinel for
    // missing codes, which we skip.
    const isoA2Of = (props: Record<string, unknown> | undefined): string | null => {
      if (!props) return null
      for (const key of ['ISO_A2_EH', 'ISO_A2'] as const) {
        const v = props[key]
        if (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v)) {
          return v.toLowerCase()
        }
      }
      return null
    }

    fetch(COUNTRY_POLYGONS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`)
        return r.json()
      })
      .then(
        (geo: {
          features?: Array<{
            properties?: Record<string, unknown>
            geometry?: unknown
          }>
        }) => {
          if (destroyed || viewer.isDestroyed()) return
          const list: CountryEntry[] = []
          const codes: Record<string, string> = {}
          for (const feature of geo.features ?? []) {
            const name =
              typeof feature?.properties?.NAME === 'string'
                ? (feature.properties.NAME as string)
                : null
            if (!name || !feature.geometry) continue
            const polygons = normalizeGeometry(feature.geometry)
            if (polygons.length === 0) continue
            const props = feature.properties ?? {}
            const labelX = Number(props.LABEL_X)
            const labelY = Number(props.LABEL_Y)
            const label =
              Number.isFinite(labelX) && Number.isFinite(labelY)
                ? { lat: labelY, lon: labelX }
                : undefined
            // Candidate keys to match against the capitals dataset: the ISO-A2
            // code (most reliable) plus name variants.
            const aliases = new Set<string>()
            const iso = isoA2Of(feature.properties)
            if (iso) {
              codes[name] = iso
              aliases.add(`iso:${iso}`)
            }
            for (const key of [
              'NAME',
              'ADMIN',
              'NAME_LONG',
              'SOVEREIGNT',
              'FORMAL_EN',
              'GEOUNIT',
            ]) {
              const v = props[key]
              if (typeof v === 'string') {
                const n = normName(v)
                if (n) aliases.add(n)
              }
            }
            list.push({
              name,
              polygons,
              bbox: computeBBox(polygons),
              centroid: computeCentroid(polygons),
              area: computeArea(polygons),
              label,
              aliases: [...aliases],
            })
          }
          countryEntries = list
          // Cities-mode pool: join places with countries (no-op until the places
          // have also loaded — publishCities guards on placesLoaded).
          publishCities()
          useGameStore.getState().setCountryCodes(codes)
          // Register every country (not just playable targets) so guess
          // markers, which can land on any country, always resolve to an ID.
          useGameStore.getState().registerCountries(list.map((c) => c.name))
          useGameStore
            .getState()
            .setCountries(
              list.filter((c) => c.area >= MIN_TARGET_AREA).map((c) => c.name),
            )
          // World Cup pool: match by ISO code (the dataset's NAME spellings
          // vary too much to match on). Several ISO codes are shared by a
          // sovereign state and its tiny dependent territories (e.g. AU →
          // Australia + Ashmore Is.), so keep only the largest-area entry per
          // code — that's always the country itself. Bypasses the area filter
          // so small qualifiers like Curaçao still appear.
          const wcByIso = new Map<string, CountryEntry>()
          for (const c of list) {
            const iso = codes[c.name]
            if (!iso || !WORLD_CUP_ISO.has(iso)) continue
            const prev = wcByIso.get(iso)
            if (!prev || c.area > prev.area) wcByIso.set(iso, c)
          }
          useGameStore
            .getState()
            .setWorldCupCountries([...wcByIso.values()].map((c) => c.name))
        },
      )
      .catch(() => {
        // CDN unreachable / blocked — clicks won't resolve to country names.
      })

    // Country borders + coastlines: solid pure-black lines, no halo. Same style
    // for both — borders give the political divisions, coastlines outline every
    // landmass and island (including ones that border no one).
    //
    // On mobile the lines are lifted a few km off the surface instead of being
    // ground-clamped. Ground-clamping leans on depth/classification support
    // that's unreliable on mobile GPUs (often WebGL1): when it degrades the
    // line collapses onto the surface and z-fights the globe, so zoomed out it
    // gets eaten by the world geometry (fine up close, where the frustum split
    // resolves it). A small lift keeps the near side reliably in front of the
    // surface while the opaque globe still occludes the far side. arcType
    // defaults to GEODESIC, so each lifted segment still hugs the curve.
    // Desktop ground-clamps as before (no z-fighting there, zero parallax).
    const BORDER_LIFT_METERS = 4000
    const borderEllipsoid = viewer.scene.globe.ellipsoid
    const liftToBorderHeight = (c: Cartesian3): Cartesian3 => {
      const carto = Cartographic.fromCartesian(c, borderEllipsoid)
      return Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        BORDER_LIFT_METERS,
        borderEllipsoid,
      )
    }
    const borderMat = new ColorMaterialProperty(new Color(0.0, 0.0, 0.0, 0.8))
    const loadLineLayer = (url: string): void => {
      GeoJsonDataSource.load(url, {
        stroke: Color.BLACK,
        strokeWidth: 1.5,
      })
        .then((ds) => {
          if (destroyed || viewer.isDestroyed()) return
          const time = viewer.clock.currentTime
          for (const entity of ds.entities.values) {
            const polyline = entity.polyline
            if (!polyline) continue
            polyline.material = borderMat
            polyline.width = new ConstantProperty(2.25)
            if (IS_MOBILE) {
              polyline.clampToGround = new ConstantProperty(false)
              const positions = polyline.positions?.getValue(time) as
                | Cartesian3[]
                | undefined
              if (positions) {
                polyline.positions = new ConstantProperty(
                  positions.map(liftToBorderHeight),
                )
              }
            }
          }
          viewer.dataSources.add(ds)
        })
        .catch(() => {
          // Lines are a nice-to-have; the basemap still shows coastlines.
        })
    }
    loadLineLayer(COUNTRY_BORDERS_URL)
    loadLineLayer(COASTLINE_URL)

    // US state lines: a secondary, lighter line layer drawn only during the
    // North America cities mode (sub-modes whose CitySpec sets usStateLines).
    // The dataset (~880 KB) is fetched lazily the first time such a mode is
    // entered, then toggled via the store subscription — players who never touch
    // that mode never pay for it.
    let stateLinesDS: GeoJsonDataSource | null = null
    let stateLinesRequested = false
    const stateLineMat = new ColorMaterialProperty(new Color(0.1, 0.1, 0.1, 0.5))
    // Whether the active sub-mode wants US state lines shown.
    const wantStateLines = (subMode: string): boolean =>
      resolveSubMode(subMode).cities?.usStateLines === true
    const loadStateLines = (): void => {
      if (stateLinesRequested) return
      stateLinesRequested = true
      fetch(STATE_LINES_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('states'))))
        .then((geo: { features?: Array<Record<string, any>> }) => {
          const us = {
            type: 'FeatureCollection' as const,
            features: (geo.features ?? []).filter((f) => {
              const p = f.properties ?? {}
              return (p.ADM0_A3 ?? p.adm0_a3) === 'USA'
            }),
          }
          return GeoJsonDataSource.load(us, {
            stroke: Color.BLACK,
            strokeWidth: 1,
          })
        })
        .then((ds) => {
          if (destroyed || viewer.isDestroyed()) return
          const time = viewer.clock.currentTime
          for (const entity of ds.entities.values) {
            const polyline = entity.polyline
            if (!polyline) continue
            polyline.material = stateLineMat
            polyline.width = new ConstantProperty(1.4)
            if (IS_MOBILE) {
              polyline.clampToGround = new ConstantProperty(false)
              const positions = polyline.positions?.getValue(time) as
                | Cartesian3[]
                | undefined
              if (positions) {
                polyline.positions = new ConstantProperty(
                  positions.map(liftToBorderHeight),
                )
              }
            }
          }
          // Reflect the sub-mode that may have changed while we were loading.
          ds.show = wantStateLines(useGameStore.getState().subMode)
          viewer.dataSources.add(ds)
          stateLinesDS = ds
        })
        .catch(() => {
          // Optional locating aid; the game still works without it.
        })
    }
    // Resuming straight into a state-lines mode (e.g. a shared ?sm= link).
    if (wantStateLines(useGameStore.getState().subMode)) loadStateLines()

    // Disable Cesium's built-in camera controls; we drive the camera ourselves.
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableInputs = false
    ssc.enableRotate = false
    ssc.enableTranslate = false
    ssc.enableZoom = false
    ssc.enableTilt = false
    ssc.enableLook = false

    // On a portrait (tall) viewport the globe reads as small when fully zoomed
    // out, so pull the furthest-out distance in by 40% — both the starting
    // range and the zoom-out clamp. Landscape is unchanged.
    const portrait = window.innerHeight > window.innerWidth
    const zoomScale = portrait ? 0.6 : 1
    const initialRange = INITIAL_RANGE * zoomScale
    const maxRange = MAX_RANGE * zoomScale

    let heading = 0
    let pitch = 0
    let range = initialRange

    // applyCamera writes the camera state from heading/pitch/range; updateCamera
    // additionally broadcasts heading to the store. The Newton solve below
    // calls applyCamera many times per frame, so we keep the store-write out
    // of the inner loop.
    const applyCamera = () => {
      viewer.scene.camera.lookAtTransform(
        Matrix4.IDENTITY,
        new HeadingPitchRange(heading, pitch, range),
      )
    }
    const updateCamera = () => {
      applyCamera()
      useGameStore.getState().setHeading(heading)
    }
    updateCamera()

    const canvas = viewer.scene.canvas
    canvas.style.touchAction = 'none'

    type Pointer = {
      x: number
      y: number
      startX: number
      startY: number
      moved: boolean
    }
    const pointers = new Map<number, Pointer>()
    let pinchDistance = 0

    // Last single-pointer move; used to derive release velocity for momentum.
    let velHeading = 0
    let velPitch = 0
    let lastMoveTime = 0

    let momentumRaf: number | null = null
    let momentumLastFrame = 0
    const stepMomentum = (now: number) => {
      const dt = (now - momentumLastFrame) / 1000
      momentumLastFrame = now
      heading = CesiumMath.zeroToTwoPi(heading + velHeading * dt)
      pitch = clamp(pitch + velPitch * dt, PITCH_MIN, PITCH_MAX)
      const decay = Math.exp(-FRICTION * dt)
      velHeading *= decay
      velPitch *= decay
      updateCamera()
      if (
        Math.abs(velHeading) < MIN_VELOCITY &&
        Math.abs(velPitch) < MIN_VELOCITY
      ) {
        velHeading = 0
        velPitch = 0
        momentumRaf = null
        return
      }
      momentumRaf = requestAnimationFrame(stepMomentum)
    }
    const startMomentum = () => {
      if (momentumRaf !== null) return
      momentumLastFrame = performance.now()
      momentumRaf = requestAnimationFrame(stepMomentum)
    }
    const stopMomentum = () => {
      if (momentumRaf !== null) {
        cancelAnimationFrame(momentumRaf)
        momentumRaf = null
      }
      velHeading = 0
      velPitch = 0
    }

    const computePinchDistance = (): number => {
      const it = pointers.values()
      const a = it.next().value
      const b = it.next().value
      if (!a || !b) return 0
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    const ellipsoid = viewer.scene.globe.ellipsoid

    // Raycast the ellipsoid under a client-space point. Used only to gate the
    // start of a gesture (a press must land on the globe) and to resolve taps
    // into lat/lon — dragging itself no longer raycasts.
    const pickAnchor = (clientX: number, clientY: number): Cartesian3 | null => {
      const rect = canvas.getBoundingClientRect()
      const screen = new Cartesian2(clientX - rect.left, clientY - rect.top)
      return viewer.scene.camera.pickEllipsoid(screen, ellipsoid) ?? null
    }

    // Globe-surface rotation (radians) per screen pixel at the centre of the
    // view. Derived from the camera's apparent scale there, so a drag tracks the
    // cursor ~1:1 at screen centre at any zoom. Applied per-axis — heading for
    // horizontal pixels, pitch for vertical — which keeps a horizontal drag
    // purely horizontal out to the limb, unlike the old anchored solve that
    // coupled the axes and went unstable near the edge.
    const surfaceRadiansPerPixel = (): number => {
      const Re = ellipsoid.maximumRadius
      const frustum = viewer.camera.frustum
      const fovy =
        (frustum instanceof PerspectiveFrustum ? frustum.fovy : undefined) ??
        Math.PI / 3
      const h = canvas.clientHeight || 1
      // range − Re ≈ camera-to-surface distance at the sub-camera point; floored
      // so a fully zoomed-in view can still pan.
      const dist = Math.max(range - Re, Re * 0.05)
      return (dist / Re) * ((2 * Math.tan(fovy / 2)) / h)
    }

    const lookupCountryName = (lat: number, lon: number): string | null => {
      const list = countryEntries
      if (!list) return null
      for (const c of list) {
        if (
          lon < c.bbox[0] ||
          lon > c.bbox[2] ||
          lat < c.bbox[1] ||
          lat > c.bbox[3]
        )
          continue
        for (const poly of c.polygons) {
          if (pointInSubPolygon(lon, lat, poly)) return c.name
        }
      }
      return null
    }

    // Render a marker entity for one store record. The store owns the marker
    // list (so it persists); this function is the Cesium-side projection.
    // Flag pin composition is async (image load); `gen` lets us abandon a
    // pending render if the markers array got wiped (new match) before it
    // resolved, so we don't leak stale entities into the next game.
    let renderGen = 0
    const renderMarker = (m: Marker, gen: number): void => {
      const code = m.code ?? useGameStore.getState().countryCodes[m.label]
      buildFlagPin(code, m.kind).then((image) => {
        if (gen !== renderGen || destroyed || viewer.isDestroyed()) return
        if (!image) return
        gameMarkers.entities.add({
          position: Cartesian3.fromDegrees(m.lon, m.lat),
          billboard: {
            image,
            // Pole base touches the clicked point: bottom-anchored, and shifted
            // left by half the pole width so the pole's centre (not the image's
            // left edge) lands on the lat/lon.
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.LEFT,
            pixelOffset: new Cartesian2(-POLE_W / 2, 0),
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
          label: m.label
            ? {
                text: m.label,
                font: 'bold 15px sans-serif',
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE,
                // Sit just above the flag, horizontally centred over it. The
                // flag's centre is (POLE_W/2 + FLAG_W/2) right of the pole base;
                // its top is POLE_H px above the ground anchor.
                verticalOrigin: VerticalOrigin.BOTTOM,
                horizontalOrigin: HorizontalOrigin.CENTER,
                pixelOffset: new Cartesian2(
                  POLE_W / 2 + FLAG_W / 2,
                  -(POLE_H + 2),
                ),
                heightReference: HeightReference.CLAMP_TO_GROUND,
              }
            : undefined,
        })
      })
    }

    // Cinematic camera fly to a country's centroid for the reveal animation.
    // While true, drag/zoom/click are gated off so the animation finishes
    // cleanly without conflicting with user input.
    let cinematic = false
    let revealRaf: number | null = null
    let revealHoldTimeout: number | null = null

    const flyToCountry = (name: string, onDone: (e: CountryEntry) => void) => {
      const entry = countryEntries?.find((c) => c.name === name)
      if (!entry) {
        onDone({
          name,
          bbox: [0, 0, 0, 0],
          centroid: { lat: 0, lon: 0 },
          polygons: [],
          area: 0,
          aliases: [],
        })
        return
      }

      stopMomentum()
      if (revealRaf !== null) cancelAnimationFrame(revealRaf)
      cinematic = true

      // From the HPR offset derivation: subpoint_lon = -heading - π/2,
      // subpoint_lat = -pitch. Inverting gives the camera angles needed to
      // place a (lat, lon) at the centre of the screen.
      const targetHeading = CesiumMath.zeroToTwoPi(
        -CesiumMath.toRadians(entry.centroid.lon) - Math.PI / 2,
      )
      const targetPitch = clamp(
        -CesiumMath.toRadians(entry.centroid.lat),
        PITCH_MIN,
        PITCH_MAX,
      )

      const startHeading = heading
      const startPitch = pitch
      let dh = targetHeading - startHeading
      if (dh > Math.PI) dh -= 2 * Math.PI
      else if (dh < -Math.PI) dh += 2 * Math.PI
      const dp = targetPitch - startPitch

      const startTime = performance.now()
      const step = (now: number) => {
        const t = Math.min((now - startTime) / REVEAL_MS, 1)
        const eased =
          t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        heading = CesiumMath.zeroToTwoPi(startHeading + dh * eased)
        pitch = clamp(startPitch + dp * eased, PITCH_MIN, PITCH_MAX)
        updateCamera()
        if (t < 1) {
          revealRaf = requestAnimationFrame(step)
        } else {
          revealRaf = null
          cinematic = false
          onDone(entry)
        }
      }
      revealRaf = requestAnimationFrame(step)
    }

    // Shortest signed angular delta in (-π, π], for unwrapping heading
    // velocity across the 0/2π seam.
    const angleDelta = (a: number, b: number) => {
      let d = a - b
      if (d > Math.PI) d -= 2 * Math.PI
      else if (d < -Math.PI) d += 2 * Math.PI
      return d
    }

    const emitLatLon = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const screen = new Cartesian2(clientX - rect.left, clientY - rect.top)
      const cart = viewer.scene.camera.pickEllipsoid(screen, ellipsoid)
      if (!cart) return
      const carto = Cartographic.fromCartesian(cart, ellipsoid)
      const lat = CesiumMath.toDegrees(carto.latitude)
      const lon = CesiumMath.toDegrees(carto.longitude)
      console.log(`lat: ${lat.toFixed(4)}, lon: ${lon.toFixed(4)}`)
      const name = lookupCountryName(lat, lon)
      const state = useGameStore.getState()

      // Brief input lock right after the target changes: swallow the click so a
      // release/double-tap meant for the previous target doesn't guess the new
      // one. Enforced here (input layer) rather than in the store handlers.
      if (Date.now() < state.inputLockUntil) return

      // Capitals mode: the pin can land anywhere (including open ocean), and the
      // store owns both the guess pin and the reveal marker, so route the raw
      // lat/lon straight through and skip the country-name path entirely.
      if (state.mode === 'capitals') {
        if (state.phase === 'playing' && state.target !== null) {
          state.handleCapitalGuess(lat, lon)
        }
        return
      }

      // Drop a guess pin at the click location during play. Snapshot target
      // BEFORE handleGlobeClick — that call may advance to a new target,
      // which would corrupt the right/wrong determination.
      if (state.phase === 'playing' && name !== null && state.revealTarget === null) {
        const correct = state.target === name
        state.addMarker({
          lat,
          lon,
          kind: correct ? 'correct' : 'wrong',
          label: name,
        })
      }
      useGameStore.getState().handleGlobeClick(name, lat, lon)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (cinematic) return
      stopMomentum()

      // First contact must hit the globe — clicks on empty space beyond the
      // limb don't start a gesture at all (no drag, no tap). The press point is
      // only a gate here; it never becomes a drag pivot.
      if (pointers.size === 0 && !pickAnchor(e.clientX, e.clientY)) return

      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      })
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // already captured / not capturable
      }
      if (pointers.size === 2) {
        pinchDistance = computePinchDistance()
      }
      lastMoveTime = performance.now()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (cinematic) return

      const p = pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (
        !p.moved &&
        Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_THRESHOLD
      ) {
        p.moved = true
      }

      const now = performance.now()
      const dt = Math.max(1, now - lastMoveTime) / 1000
      lastMoveTime = now

      if (pointers.size === 1) {
        const hBefore = heading
        const pBefore = pitch

        // Decoupled "turntable" drag: horizontal pixels rotate heading,
        // vertical pixels rotate pitch — never cross-coupled, so a horizontal
        // drag stays horizontal and a vertical one stays vertical everywhere
        // (including the limb). Sensitivity is the globe's apparent surface
        // scale at screen centre, so it tracks the cursor ~1:1 there.
        const s = surfaceRadiansPerPixel() * DRAG_SENSITIVITY
        heading = CesiumMath.zeroToTwoPi(heading + dx * s)
        pitch = clamp(pitch - dy * s, PITCH_MIN, PITCH_MAX)
        applyCamera()

        // Clamp the flick velocity so a fast drag can't fling the globe into a
        // runaway spin (see MAX_FLICK_VELOCITY).
        velHeading = clamp(
          angleDelta(heading, hBefore) / dt,
          -MAX_FLICK_VELOCITY,
          MAX_FLICK_VELOCITY,
        )
        velPitch = clamp(
          (pitch - pBefore) / dt,
          -MAX_FLICK_VELOCITY,
          MAX_FLICK_VELOCITY,
        )
        useGameStore.getState().setHeading(heading)
      } else if (pointers.size === 2) {
        const newDist = computePinchDistance()
        if (pinchDistance > 0 && newDist > 0) {
          range = clamp(
            (range * pinchDistance) / newDist,
            MIN_RANGE,
            maxRange,
          )
          updateCamera()
        }
        pinchDistance = newDist
        velHeading = 0
        velPitch = 0
      }
    }

    const endDrag = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      pointers.delete(e.pointerId)
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }

      if (pointers.size === 0) {
        if (!p.moved) {
          emitLatLon(p.x, p.y)
        } else if (
          Math.abs(velHeading) > MIN_VELOCITY ||
          Math.abs(velPitch) > MIN_VELOCITY
        ) {
          startMomentum()
        }
      } else if (pointers.size === 1) {
        // Coming out of pinch: don't carry pinch state into rotation. The
        // remaining finger's last position is already tracked, so the next
        // move's delta is measured from there with no jump.
        pinchDistance = 0
        velHeading = 0
        velPitch = 0
        lastMoveTime = performance.now()
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (cinematic) return
      stopMomentum()
      const factor = Math.exp(e.deltaY * WHEEL_ZOOM_RATE)
      range = clamp(range * factor, MIN_RANGE, maxRange)
      updateCamera()
    }

    // Drive markers + reveal animation off store changes.
    let prevReveal = useGameStore.getState().revealTarget
    let prevEnding = useGameStore.getState().endingTarget
    let prevMarkers = useGameStore.getState().markers
    let prevMarkerEpoch = useGameStore.getState().markerEpoch
    let prevCircle = useGameStore.getState().hintCircle
    let prevGuessLine = useGameStore.getState().guessLine
    let prevStatsSelection = useGameStore.getState().selectedStatsCountryId
    let prevStatsMode = useGameStore.getState().statsMode
    let prevGlobalGuesses = useGameStore.getState().globalGuesses
    let prevSubMode = useGameStore.getState().subMode
    let endingHoldTimeout: number | null = null

    // Reverse-lookup a country name from its local integer ID.
    const nameForId = (id: number): string | null => {
      const ids = useGameStore.getState().countryIds
      for (const k in ids) if (ids[k] === id) return k
      return null
    }

    // Add one dot at a guess location. Correct guesses draw green, misses red.
    const addStatsDot = (lat: number, lon: number, isCorrect: boolean): void => {
      statsDots.entities.add({
        position: Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 9,
          color: isCorrect
            ? Color.fromCssColorString('#3fb84e')
            : Color.fromCssColorString('#e64545'),
          outlineColor: Color.fromCssColorString('rgba(0,0,0,0.7)'),
          outlineWidth: 1.5,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          // Leave the depth test enabled (default) so the globe occludes dots
          // on its far side — otherwise back-of-globe guesses bleed through.
        },
      })
    }

    // Drop a blue flag pin on the selected country to confirm where it is —
    // alongside the guess dots, not replacing them. Async (flag image load), so
    // guarded by statsGen against a selection that changed before it resolved.
    let statsGen = 0
    const addStatsFlagPin = (name: string, gen: number): void => {
      const entry = countryEntries?.find((c) => c.name === name)
      if (!entry) return
      const pt = flagPointFor(entry)
      const code = useGameStore.getState().countryCodes[name]
      buildFlagPin(code, 'stats').then((image) => {
        if (gen !== statsGen || destroyed || viewer.isDestroyed()) return
        if (!image) return
        statsDots.entities.add({
          position: Cartesian3.fromDegrees(pt.lon, pt.lat),
          billboard: {
            image,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.LEFT,
            pixelOffset: new Cartesian2(-POLE_W / 2, 0),
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
          label: {
            text: name,
            font: 'bold 15px sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.CENTER,
            pixelOffset: new Cartesian2(POLE_W / 2 + FLAG_W / 2, -(POLE_H + 2)),
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        })
      })
    }

    // Replace the stats-highlight dot layer to match the current selection.
    // In 'mine' mode dots come from the player's local guess history (keyed by
    // the target's local ID); 'all' paints every local guess at once. In
    // 'global' mode they come from the up-to-200 server guesses loaded for the
    // selected country (global 'all' paints nothing — far too many to show).
    // A specific country (either mode) also gets a flag pin marking its location.
    const renderStatsDots = (): void => {
      statsGen++
      const gen = statsGen
      statsDots.entities.removeAll()
      const st = useGameStore.getState()
      const sel = st.selectedStatsCountryId
      if (sel === null) return

      if (typeof sel === 'number') {
        const pinName = nameForId(sel)
        if (pinName) addStatsFlagPin(pinName, gen)
      }

      if (st.statsMode === 'global') {
        const gg = st.globalGuesses
        // 'all' paints the most-recent guesses across every country; a specific
        // row paints just that country's. In both cases gg.country must match
        // what the store currently holds, so stale dots from a previous
        // selection (loaded async) aren't shown against the new one.
        if (sel === 'all') {
          if (gg.country === ALL_GUESSES) {
            for (const d of gg.dots) addStatsDot(d.lat, d.lon, d.correct)
          }
          return
        }
        const name = nameForId(sel)
        if (!name || gg.country !== name) return
        for (const d of gg.dots) addStatsDot(d.lat, d.lon, d.correct)
        return
      }

      const stats = st.stats
      const targetIds =
        sel === 'all'
          ? Object.keys(stats).map(Number)
          : stats[sel]
            ? [sel]
            : []
      for (const targetId of targetIds) {
        const entry = stats[targetId]
        if (!entry) continue
        for (const g of entry.guesses) {
          if (typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
          addStatsDot(g.lat, g.lon, g.id === targetId)
        }
      }
    }
    // Mount-time replay in case a selection already exists.
    renderStatsDots()

    // Replay any markers already in the store at mount time. This is the
    // resume path: a returning player with a saved match already has markers
    // before the viewer subscribes.
    let renderedMarkerCount = 0
    for (const m of prevMarkers) renderMarker(m, renderGen)
    renderedMarkerCount = prevMarkers.length

    const unsub = useGameStore.subscribe((state) => {
      // Show/hide the US state lines when the active sub-mode changes (only the
      // North America cities mode requests them). No-op until the layer loads;
      // its initial visibility is set from the current sub-mode at load time.
      if (state.subMode !== prevSubMode) {
        prevSubMode = state.subMode
        const want = wantStateLines(state.subMode)
        if (want) loadStateLines() // lazy: fetch the first time it's needed
        if (stateLinesDS) stateLinesDS.show = want
      }

      // A bumped epoch means the markers were fully replaced (capitals mode
      // swaps its two markers each guess) rather than appended — wipe first so
      // the previous round's pins don't linger, then the block below redraws.
      if (state.markerEpoch !== prevMarkerEpoch) {
        renderGen++
        gameMarkers.entities.removeAll()
        renderedMarkerCount = 0
        prevMarkerEpoch = state.markerEpoch
      }

      // Reconcile the Cesium data source against `markers`. A shorter array
      // (or replaced reference with fewer items) means a new match started —
      // wipe and re-render. Otherwise render any newly appended markers.
      if (state.markers !== prevMarkers) {
        if (state.markers.length < renderedMarkerCount) {
          // Bump the generation so any in-flight renderMarker promises from
          // the previous match drop their entities on resolve.
          renderGen++
          gameMarkers.entities.removeAll()
          renderedMarkerCount = 0
        }
        while (renderedMarkerCount < state.markers.length) {
          renderMarker(state.markers[renderedMarkerCount], renderGen)
          renderedMarkerCount++
        }
        prevMarkers = state.markers
      }

      // Capitals overlays: redraw the hint circle + guess line whenever either
      // changes. Both live in `overlays`, so one removeAll() clears the prior
      // round before the current one is drawn.
      if (
        state.hintCircle !== prevCircle ||
        state.guessLine !== prevGuessLine
      ) {
        overlays.entities.removeAll()
        const MI_TO_M = 1609.344
        if (state.hintCircle) {
          const c = state.hintCircle
          overlays.entities.add({
            position: Cartesian3.fromDegrees(c.lon, c.lat),
            ellipse: {
              semiMajorAxis: c.radiusMi * MI_TO_M,
              semiMinorAxis: c.radiusMi * MI_TO_M,
              material: new ColorMaterialProperty(
                Color.YELLOW.withAlpha(0.12),
              ),
              outline: true,
              outlineColor: Color.YELLOW.withAlpha(0.9),
              outlineWidth: 2,
              height: 0,
            },
          })
        }
        if (state.guessLine) {
          const g = state.guessLine
          overlays.entities.add({
            polyline: {
              positions: [
                Cartesian3.fromDegrees(g.fromLon, g.fromLat),
                Cartesian3.fromDegrees(g.toLon, g.toLat),
              ],
              width: 3.9,
              material: new PolylineOutlineMaterialProperty({
                color: Color.YELLOW,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
              }),
              clampToGround: true,
            },
          })
        }
        prevCircle = state.hintCircle
        prevGuessLine = state.guessLine
      }

      if (state.revealTarget && state.revealTarget !== prevReveal) {
        const name = state.revealTarget
        flyToCountry(name, (entry) => {
          if (entry.polygons.length > 0) {
            const pt = flagPointFor(entry)
            useGameStore.getState().addMarker({
              lat: pt.lat,
              lon: pt.lon,
              kind: 'reveal',
              label: name,
            })
          }
          // Hold the missed-target label on screen for 2.5 s after the pan
          // finishes so the player has time to register where it was; the
          // new target (or finished phase) only takes over once this clears.
          if (revealHoldTimeout !== null) clearTimeout(revealHoldTimeout)
          revealHoldTimeout = window.setTimeout(() => {
            revealHoldTimeout = null
            useGameStore.getState().clearReveal()
          }, 2500)
        })
      }
      prevReveal = state.revealTarget

      // Final correct guess: pan to the country, hold 2 s on it, then
      // transition the store into 'finished'. The pin from the click is
      // already on the globe and stays put.
      if (state.endingTarget && state.endingTarget !== prevEnding) {
        const name = state.endingTarget
        flyToCountry(name, () => {
          if (endingHoldTimeout !== null) clearTimeout(endingHoldTimeout)
          endingHoldTimeout = window.setTimeout(() => {
            endingHoldTimeout = null
            useGameStore.getState().finishGame()
          }, 2000)
        })
      }
      prevEnding = state.endingTarget

      // Stats sidebar: repaint the dot layer when the selection, the mode, or
      // the loaded global guesses change. A brand-new country selection also
      // pans the camera; mode toggles and async guess arrivals just repaint in
      // place (no fly-to).
      const selChanged = state.selectedStatsCountryId !== prevStatsSelection
      const modeChanged = state.statsMode !== prevStatsMode
      const guessesChanged = state.globalGuesses !== prevGlobalGuesses
      if (selChanged || modeChanged || guessesChanged) {
        const newId = state.selectedStatsCountryId
        prevStatsSelection = newId
        prevStatsMode = state.statsMode
        prevGlobalGuesses = state.globalGuesses
        if (selChanged && typeof newId === 'number') {
          const name = nameForId(newId)
          // Wipe the previous selection's dots before the pan so they don't sit
          // on a country we're flying away from. flyToCountry sets
          // `cinematic = true`, locking input until the animation finishes. The
          // dots are repainted on arrival (global) or on done (mine).
          statsDots.entities.removeAll()
          if (name) flyToCountry(name, () => renderStatsDots())
          else renderStatsDots()
        } else {
          renderStatsDots()
        }
      }
    })

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('wheel', onWheel)
      stopMomentum()
      if (revealRaf !== null) cancelAnimationFrame(revealRaf)
      if (revealHoldTimeout !== null) clearTimeout(revealHoldTimeout)
      if (endingHoldTimeout !== null) clearTimeout(endingHoldTimeout)
      unsub()
      destroyed = true
      viewer.destroy()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
