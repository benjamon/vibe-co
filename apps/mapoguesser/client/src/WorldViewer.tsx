import { useEffect, useRef } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
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
  PolylineOutlineMaterialProperty,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useGameStore, type Marker } from './store'

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

// Natural Earth 50m admin-0 datasets. Borders for visible lines, polygons for
// CPU point-in-polygon hit-testing. Served via jsDelivr's GitHub mirror.
const COUNTRY_BORDERS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_boundary_lines_land.geojson'
const COUNTRY_POLYGONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson'

// Reveal animation duration when the player misses twice on the same target.
const REVEAL_MS = 1200

// Fallback radians-per-pixel for drags that started off-globe (no anchor to
// pin to). Anchored drags use a true 1:1 inverse projection instead.
const FALLBACK_SENSITIVITY = 0.005

// Asymmetric pitch limits: 17.5° from the north pole, 30° from the south pole.
// Negative pitch sends the camera over the north (looking south); positive
// pitch sends it over the south (looking north). The north-pole gap was
// halved from 35° → 17.5° so the camera can swing further over the top of
// the globe.
const PITCH_MIN = -CesiumMath.toRadians(72.5)
const PITCH_MAX = CesiumMath.toRadians(60)

// Exponential decay rate for spin momentum (1/s). Higher = stops faster.
const FRICTION = 3.0
// Velocity below this threshold (rad/s) is treated as stopped.
const MIN_VELOCITY = 0.002
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
      {},
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
      msaaSamples: 4,
    })

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

    // Flag-on-coloured-tile pin sprites. Composed on demand per (kind, code)
    // because flag images load asynchronously from flagcdn.com; cached so a
    // re-render of the same marker is free. Background colour carries the
    // correctness signal now that the ✓/✗ glyph is gone.
    const PIN_BG: Record<Marker['kind'], string> = {
      correct: '#3fb84e',
      wrong: '#9aa0a6',
      reveal: '#e64545',
    }
    const PIN_W = 50
    const PIN_H = 40
    // Flag dimensions are 0.85× a 48×36 reference (4:3 to match flagcdn).
    const FLAG_W = 41
    const FLAG_H = 31
    const flagPinCache = new Map<string, Promise<string>>()

    const buildFlagPin = (
      code: string | undefined,
      kind: Marker['kind'],
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

        // Rounded-rect background using arcTo so the corners match the white
        // border below without a separate path.
        const r = 8
        ctx.fillStyle = PIN_BG[kind]
        ctx.beginPath()
        ctx.moveTo(r, 0)
        ctx.arcTo(PIN_W, 0, PIN_W, PIN_H, r)
        ctx.arcTo(PIN_W, PIN_H, 0, PIN_H, r)
        ctx.arcTo(0, PIN_H, 0, 0, r)
        ctx.arcTo(0, 0, PIN_W, 0, r)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineWidth = 1
        ctx.stroke()

        if (code) {
          try {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve()
              img.onerror = () => reject(new Error('flag load failed'))
              img.src = `https://flagcdn.com/w160/${code}.png`
            })
            const fx = (PIN_W - FLAG_W) / 2
            const fy = (PIN_H - FLAG_H) / 2
            ctx.drawImage(img, fx, fy, FLAG_W, FLAG_H)
          } catch {
            // Flag fetch / CORS failure: leave the bare coloured tile.
          }
        }

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
    type CountryEntry = {
      name: string
      bbox: [number, number, number, number]
      centroid: { lat: number; lon: number }
      polygons: SubPolygon[]
      area: number
    }
    let countryEntries: CountryEntry[] | null = null
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
            list.push({
              name,
              polygons,
              bbox: computeBBox(polygons),
              centroid: computeCentroid(polygons),
              area: computeArea(polygons),
            })
            const iso = isoA2Of(feature.properties)
            if (iso) codes[name] = iso
          }
          countryEntries = list
          useGameStore.getState().setCountryCodes(codes)
          // Register every country (not just playable targets) so guess
          // markers, which can land on any country, always resolve to an ID.
          useGameStore.getState().registerCountries(list.map((c) => c.name))
          useGameStore
            .getState()
            .setCountries(
              list.filter((c) => c.area >= MIN_TARGET_AREA).map((c) => c.name),
            )
        },
      )
      .catch(() => {
        // CDN unreachable / blocked — clicks won't resolve to country names.
      })

    // Country border lines: white core wrapped in a dark halo so the lines
    // stay readable over bright basemap features (deserts, ice, sun glare).
    const borderMat = new PolylineOutlineMaterialProperty({
      color: Color.BLACK.withAlpha(0.55),
      outlineColor: Color.WHITE.withAlpha(0.9),
      outlineWidth: 1.5,
    })
    GeoJsonDataSource.load(COUNTRY_BORDERS_URL, {
      stroke: Color.NAVY,
      strokeWidth: 5.0,
    })
      .then((ds) => {
        if (destroyed || viewer.isDestroyed()) return
        for (const entity of ds.entities.values) {
          if (entity.polyline) {
            entity.polyline.material = borderMat
            entity.polyline.width = new ConstantProperty(5.0)
          }
        }
        viewer.dataSources.add(ds)
      })
      .catch(() => {
        // Borders are a nice-to-have; basemap still shows coastlines.
      })

    // Disable Cesium's built-in camera controls; we drive the camera ourselves.
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableInputs = false
    ssc.enableRotate = false
    ssc.enableTranslate = false
    ssc.enableZoom = false
    ssc.enableTilt = false
    ssc.enableLook = false

    let heading = 0
    let pitch = 0
    let range = INITIAL_RANGE

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

    // ECEF point under the cursor at drag-start. Anchored drag tries to keep
    // this point pinned beneath the cursor at all times.
    let dragAnchor: Cartesian3 | null = null
    const ellipsoid = viewer.scene.globe.ellipsoid

    const pickAnchor = (clientX: number, clientY: number): Cartesian3 | null => {
      const rect = canvas.getBoundingClientRect()
      const screen = new Cartesian2(clientX - rect.left, clientY - rect.top)
      return viewer.scene.camera.pickEllipsoid(screen, ellipsoid) ?? null
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
      const code = useGameStore.getState().countryCodes[m.label]
      buildFlagPin(code, m.kind).then((image) => {
        if (gen !== renderGen || destroyed || viewer.isDestroyed()) return
        if (!image) return
        gameMarkers.entities.add({
          position: Cartesian3.fromDegrees(m.lon, m.lat),
          billboard: {
            image,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
          label: m.label
            ? {
                text: m.label,
                font: '16px sans-serif',
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE,
                // Pin is bottom-anchored at the lat/lon and extends PIN_H px
                // upward, horizontally centred. Centre the label against the
                // pin's mid-height (−PIN_H/2) and push it clear of the pin's
                // right edge (PIN_W/2 + small padding).
                verticalOrigin: VerticalOrigin.CENTER,
                horizontalOrigin: HorizontalOrigin.LEFT,
                pixelOffset: new Cartesian2(PIN_W / 2 + 4, -PIN_H / 2),
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

    // Reusable buffers — cartesianToCanvasCoordinates writes into its result
    // arg, so the three projections in one Newton step need separate buffers.
    const _projCur = new Cartesian2()
    const _projH = new Cartesian2()
    const _projP = new Cartesian2()

    // Solve for (heading, pitch) such that anchor projects onto target. One
    // iteration of damped Newton is usually enough for a single frame's
    // cursor delta; we run two for safety. Returns true if the projection
    // converged to within ~1px, false if the Jacobian was degenerate or the
    // anchor projects behind the camera.
    const NEWTON_EPS = 1e-3
    const NEWTON_MAX_STEP = 0.1
    // Jacobian determinant magnitude below this means the anchor sits near
    // the limb where small heading/pitch nudges barely move its projection.
    // Solving there explodes — bail to the proportional fallback instead.
    const NEWTON_MIN_DET = 1e-3
    const solveAnchor = (anchor: Cartesian3, target: Cartesian2): boolean => {
      for (let iter = 0; iter < 2; iter++) {
        applyCamera()
        const cur = viewer.scene.cartesianToCanvasCoordinates(anchor, _projCur)
        if (!cur) return false
        const errX = target.x - cur.x
        const errY = target.y - cur.y
        if (Math.abs(errX) < 0.5 && Math.abs(errY) < 0.5) return true

        const hSave = heading
        const pSave = pitch

        heading = hSave + NEWTON_EPS
        pitch = pSave
        applyCamera()
        const ph = viewer.scene.cartesianToCanvasCoordinates(anchor, _projH)

        heading = hSave
        pitch = pSave + NEWTON_EPS
        applyCamera()
        const pp = viewer.scene.cartesianToCanvasCoordinates(anchor, _projP)

        heading = hSave
        pitch = pSave

        if (!ph || !pp) {
          applyCamera()
          return false
        }

        const dxH = (ph.x - cur.x) / NEWTON_EPS
        const dyH = (ph.y - cur.y) / NEWTON_EPS
        const dxP = (pp.x - cur.x) / NEWTON_EPS
        const dyP = (pp.y - cur.y) / NEWTON_EPS

        const det = dxH * dyP - dxP * dyH
        if (Math.abs(det) < NEWTON_MIN_DET) {
          applyCamera()
          return false
        }

        const dh = clamp(
          (dyP * errX - dxP * errY) / det,
          -NEWTON_MAX_STEP,
          NEWTON_MAX_STEP,
        )
        const dp = clamp(
          (-dyH * errX + dxH * errY) / det,
          -NEWTON_MAX_STEP,
          NEWTON_MAX_STEP,
        )

        heading = CesiumMath.zeroToTwoPi(hSave + dh)
        pitch = clamp(pSave + dp, PITCH_MIN, PITCH_MAX)
      }
      // Convergence check after the iteration cap — if Newton bounced around
      // without landing close to target (off-limb cursor, ill-conditioned
      // Jacobian), report failure so the caller falls back to proportional
      // drag instead of accepting the half-converged camera state.
      applyCamera()
      const finalProj = viewer.scene.cartesianToCanvasCoordinates(
        anchor,
        _projCur,
      )
      if (!finalProj) return false
      return (
        Math.abs(finalProj.x - target.x) < 4 &&
        Math.abs(finalProj.y - target.y) < 4
      )
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
      // Drop a guess pin at the click location during play. Snapshot target
      // BEFORE handleGlobeClick — that call may advance to a new target,
      // which would corrupt the right/wrong determination.
      const state = useGameStore.getState()
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
      // limb don't start a gesture at all (no drag, no tap).
      let firstAnchor: Cartesian3 | null = null
      if (pointers.size === 0) {
        firstAnchor = pickAnchor(e.clientX, e.clientY)
        if (!firstAnchor) return
      }

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
      if (pointers.size === 1) {
        dragAnchor = firstAnchor
      } else if (pointers.size === 2) {
        pinchDistance = computePinchDistance()
        dragAnchor = null
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

        let anchored = false
        if (dragAnchor) {
          const rect = canvas.getBoundingClientRect()
          const target = new Cartesian2(
            e.clientX - rect.left,
            e.clientY - rect.top,
          )
          // If the cursor is off the globe (out past the limb, in space),
          // there's no on-ellipsoid solution — Newton diverges and snaps the
          // camera. Fall back to proportional drag in that region.
          const targetOnGlobe = viewer.scene.camera.pickEllipsoid(
            target,
            ellipsoid,
          )
          if (targetOnGlobe) {
            anchored = solveAnchor(dragAnchor, target)
          }
        }

        if (!anchored) {
          // No anchor (drag started in space) or solve failed: fall back to
          // proportional drag, keeping the original sign convention.
          const sensitivity = FALLBACK_SENSITIVITY * (range / INITIAL_RANGE)
          const dHeading = dx * sensitivity
          const dPitch = -dy * sensitivity
          heading = CesiumMath.zeroToTwoPi(heading + dHeading)
          pitch = clamp(pitch + dPitch, PITCH_MIN, PITCH_MAX)
          applyCamera()
        }

        velHeading = angleDelta(heading, hBefore) / dt
        velPitch = (pitch - pBefore) / dt
        useGameStore.getState().setHeading(heading)
      } else if (pointers.size === 2) {
        const newDist = computePinchDistance()
        if (pinchDistance > 0 && newDist > 0) {
          range = clamp(
            (range * pinchDistance) / newDist,
            MIN_RANGE,
            MAX_RANGE,
          )
          updateCamera()
        }
        pinchDistance = newDist
        velHeading = 0
        velPitch = 0
      }
    }

    // Wheel-zoom changes range, which would shift the anchor's projection.
    // Re-pick under the cursor so the next drag is still 1:1.
    const refreshAnchorIfActive = (clientX: number, clientY: number) => {
      if (pointers.size !== 1) return
      const remaining = pointers.values().next().value
      if (!remaining) return
      // Use the most recent cursor for in-flight drags, else the wheel event's.
      const x = remaining.x ?? clientX
      const y = remaining.y ?? clientY
      dragAnchor = pickAnchor(x, y)
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
        dragAnchor = null
        if (!p.moved) {
          emitLatLon(p.x, p.y)
        } else if (
          Math.abs(velHeading) > MIN_VELOCITY ||
          Math.abs(velPitch) > MIN_VELOCITY
        ) {
          startMomentum()
        }
      } else if (pointers.size === 1) {
        // Coming out of pinch: don't carry pinch state into rotation, and
        // re-anchor on the remaining finger so 1:1 drag resumes cleanly.
        pinchDistance = 0
        velHeading = 0
        velPitch = 0
        lastMoveTime = performance.now()
        const remaining = pointers.values().next().value
        dragAnchor = remaining
          ? pickAnchor(remaining.x, remaining.y)
          : null
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (cinematic) return
      stopMomentum()
      const factor = Math.exp(e.deltaY * WHEEL_ZOOM_RATE)
      range = clamp(range * factor, MIN_RANGE, MAX_RANGE)
      updateCamera()
      refreshAnchorIfActive(e.clientX, e.clientY)
    }

    // Drive markers + reveal animation off store changes.
    let prevReveal = useGameStore.getState().revealTarget
    let prevEnding = useGameStore.getState().endingTarget
    let prevMarkers = useGameStore.getState().markers
    let prevStatsSelection = useGameStore.getState().selectedStatsCountryId
    let endingHoldTimeout: number | null = null

    // Replace the stats-highlight dot layer with one dot per past guess at
    // its stored lat/lon. Correct guesses (guess.id === target id) draw
    // green; misses draw red. Entries from before lat/lon was stored just
    // get skipped — they had no position to render.
    const renderStatsDots = (countryId: number | null): void => {
      statsDots.entities.removeAll()
      if (countryId === null) return
      const entry = useGameStore.getState().stats[countryId]
      if (!entry) return
      for (const g of entry.guesses) {
        if (typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
        const isCorrect = g.id === countryId
        statsDots.entities.add({
          position: Cartesian3.fromDegrees(g.lon, g.lat),
          point: {
            pixelSize: 9,
            color: isCorrect
              ? Color.fromCssColorString('#3fb84e')
              : Color.fromCssColorString('#e64545'),
            outlineColor: Color.fromCssColorString('rgba(0,0,0,0.7)'),
            outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            // Skip Cesium's depth test so dots stay visible against the
            // globe surface at glancing angles instead of getting culled.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
    }
    // Mount-time replay: if a country was selected via persisted state
    // (it isn't today, but cheap to handle for future-proofing), draw it now.
    renderStatsDots(prevStatsSelection)

    // Replay any markers already in the store at mount time. This is the
    // resume path: a returning player with a saved match already has markers
    // before the viewer subscribes.
    let renderedMarkerCount = 0
    for (const m of prevMarkers) renderMarker(m, renderGen)
    renderedMarkerCount = prevMarkers.length

    const unsub = useGameStore.subscribe((state) => {
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

      if (state.revealTarget && state.revealTarget !== prevReveal) {
        const name = state.revealTarget
        flyToCountry(name, (entry) => {
          if (entry.polygons.length > 0) {
            useGameStore.getState().addMarker({
              lat: entry.centroid.lat,
              lon: entry.centroid.lon,
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

      // Stats sidebar row selection: pan the camera over to the picked
      // country, then redraw the dot layer once the cinematic completes.
      // null = deselect, so just clear the dots without a fly-to.
      if (state.selectedStatsCountryId !== prevStatsSelection) {
        const newId = state.selectedStatsCountryId
        prevStatsSelection = newId
        if (newId === null) {
          renderStatsDots(null)
        } else {
          // Reverse-lookup the country name from the (small, ~200-entry) map.
          let name: string | null = null
          const ids = useGameStore.getState().countryIds
          for (const k in ids) {
            if (ids[k] === newId) {
              name = k
              break
            }
          }
          // Wipe the previous selection's dots before the pan so they don't
          // sit on a country we're flying away from. flyToCountry already
          // sets `cinematic = true`, which locks pointer / wheel input until
          // the animation finishes.
          renderStatsDots(null)
          if (name) {
            flyToCountry(name, () => renderStatsDots(newId))
          } else {
            // No matching country — just paint whatever positioned guesses
            // are stored under this ID at the current camera position.
            renderStatsDots(newId)
          }
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
