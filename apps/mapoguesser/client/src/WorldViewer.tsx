import { useEffect, useRef } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  GeoJsonDataSource,
  HeadingPitchRange,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  Matrix4,
  PolylineOutlineMaterialProperty,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useGameStore } from './store'

// Cesium would otherwise reach Cesium ion for default assets; blank the token
// so the only network calls are to our chosen tile provider.
Ion.defaultAccessToken = ''

// Camera distance from Earth's centre (metres). Earth's radius is ~6.4 Mm.
const INITIAL_RANGE = 25_000_000
const MIN_RANGE = 7_000_000
const MAX_RANGE = 60_000_000

// Streamed imagery LOD cap. z12 is ~9 km/pixel at the equator — plenty of
// detail for a globe view without ballooning tile fetches.
const MAX_TILE_LEVEL = 12

// Natural Earth 50m admin-0 datasets. Borders for visible lines, polygons for
// hover hit-testing + fill highlight. Served via jsDelivr's GitHub mirror.
const COUNTRY_BORDERS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_boundary_lines_land.geojson'
const COUNTRY_POLYGONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson'

// Light blue overlay applied to the country under the cursor.
const HOVER_FILL = Color.fromCssColorString('#7ec8ff').withAlpha(0.35)

// Cesium's pick pass discards alpha-0 fragments, so a fully-transparent fill
// would make polygons unpickable. Use a tiny alpha that's imperceptible over
// the satellite basemap but still writes to the pick buffer.
const NO_FILL = Color.WHITE.withAlpha(0.005)

// Fallback radians-per-pixel for drags that started off-globe (no anchor to
// pin to). Anchored drags use a true 1:1 inverse projection instead.
const FALLBACK_SENSITIVITY = 0.005

// Asymmetric pitch limits: 35° from the north pole, 30° from the south pole.
// Negative pitch sends the camera over the north (looking south); positive
// pitch sends it over the south (looking north).
const PITCH_MIN = -CesiumMath.toRadians(55)
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
    })

    let destroyed = false

    // Reusable materials for the polygon hover swap.
    const noFillMat = new ColorMaterialProperty(NO_FILL)
    const hoverMat = new ColorMaterialProperty(HOVER_FILL)

    // Clamp polygons to the globe so they render as ground classification
    // primitives, avoiding z-fight with imagery.
    GeoJsonDataSource.clampToGround = true

    // Country polygons: rendered for the hover highlight, plus a parallel
    // CPU index (bounding box + raw rings, grouped by NAME) used for fast
    // point-in-polygon hit-testing on every cursor move.
    type CountryEntry = {
      name: string
      bbox: [number, number, number, number]
      polygons: SubPolygon[]
      entities: Entity[]
    }
    let countryEntries: CountryEntry[] | null = null

    fetch(COUNTRY_POLYGONS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`)
        return r.json()
      })
      .then(async (geo: { features: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> }) => {
        if (destroyed || viewer.isDestroyed()) return
        const ds = await GeoJsonDataSource.load(geo, {
          stroke: Color.TRANSPARENT,
          fill: NO_FILL,
          strokeWidth: 0,
        })
        if (destroyed || viewer.isDestroyed()) return

        // Cesium splits MultiPolygon features into multiple entities. Group
        // them by NAME so all parts of e.g. Indonesia highlight together.
        const time = viewer.clock.currentTime
        const entitiesByName = new Map<string, Entity[]>()
        for (const entity of ds.entities.values) {
          if (!entity.polygon) continue
          entity.polygon.material = noFillMat
          entity.polygon.outline = new ConstantProperty(false)
          const nameProp = (entity.properties as Record<string, { getValue?: (t: unknown) => unknown }> | undefined)?.NAME
          const raw = typeof nameProp?.getValue === 'function' ? nameProp.getValue(time) : null
          const name = typeof raw === 'string' ? raw : null
          if (!name) continue
          const arr = entitiesByName.get(name) ?? []
          arr.push(entity)
          entitiesByName.set(name, arr)
        }

        const list: CountryEntry[] = []
        for (const feature of geo.features ?? []) {
          const name =
            typeof feature?.properties?.NAME === 'string'
              ? (feature.properties.NAME as string)
              : null
          if (!name || !feature.geometry) continue
          const polygons = normalizeGeometry(feature.geometry)
          if (polygons.length === 0) continue
          const entities = entitiesByName.get(name) ?? []
          list.push({
            name,
            polygons,
            bbox: computeBBox(polygons),
            entities,
          })
        }

        viewer.dataSources.add(ds)
        countryEntries = list
      })
      .catch(() => {
        // CDN unreachable / blocked — hover highlight will simply not appear.
      })

    // Country border lines: white core wrapped in a dark halo so the lines
    // stay readable over bright basemap features (deserts, ice, sun glare).
    const borderMat = new PolylineOutlineMaterialProperty({
      color: Color.WHITE.withAlpha(0.95),
      outlineColor: Color.BLACK.withAlpha(0.7),
      outlineWidth: 1.0,
    })
    GeoJsonDataSource.load(COUNTRY_BORDERS_URL, {
      stroke: Color.WHITE,
      strokeWidth: 1,
    })
      .then((ds) => {
        if (destroyed || viewer.isDestroyed()) return
        for (const entity of ds.entities.values) {
          if (entity.polyline) {
            entity.polyline.material = borderMat
            entity.polyline.width = new ConstantProperty(2.6)
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

    // CPU PIP: cast cursor → globe with pickEllipsoid (cheap), bbox-prefilter
    // the country list, ray-cast PIP. Runs synchronously per pointermove so
    // the highlight tracks the cursor in real time.
    let hoveredCountryName: string | null = null
    let hoveredEntities: Entity[] | null = null

    const setHovered = (name: string | null) => {
      if (name === hoveredCountryName) return
      if (hoveredEntities) {
        for (const e of hoveredEntities) {
          if (e.polygon) e.polygon.material = noFillMat
        }
      }
      const next = name && countryEntries
        ? countryEntries.find((c) => c.name === name)?.entities ?? null
        : null
      if (next) {
        for (const e of next) {
          if (e.polygon) e.polygon.material = hoverMat
        }
      }
      hoveredCountryName = name
      hoveredEntities = next
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

    const updateHover = (clientX: number, clientY: number) => {
      if (!countryEntries) return
      const rect = canvas.getBoundingClientRect()
      const pos = new Cartesian2(clientX - rect.left, clientY - rect.top)
      const cart = viewer.scene.camera.pickEllipsoid(pos, ellipsoid)
      if (!cart) {
        setHovered(null)
        return
      }
      const carto = Cartographic.fromCartesian(cart, ellipsoid)
      const lon = CesiumMath.toDegrees(carto.longitude)
      const lat = CesiumMath.toDegrees(carto.latitude)
      setHovered(lookupCountryName(lat, lon))
    }

    const clearHover = () => setHovered(null)

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
    const NEWTON_MAX_STEP = 0.5
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
        if (Math.abs(det) < 1e-6) {
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
      applyCamera()
      return true
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
      useGameStore.getState().setCountry(lookupCountryName(lat, lon))
    }

    const onPointerDown = (e: PointerEvent) => {
      stopMomentum()
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
        dragAnchor = pickAnchor(e.clientX, e.clientY)
      } else if (pointers.size === 2) {
        pinchDistance = computePinchDistance()
        dragAnchor = null
      }
      lastMoveTime = performance.now()
    }

    const onPointerMove = (e: PointerEvent) => {
      // Hover only makes sense when the user isn't dragging the globe.
      if (pointers.size === 0) updateHover(e.clientX, e.clientY)

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
          anchored = solveAnchor(dragAnchor, target)
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
      stopMomentum()
      const factor = Math.exp(e.deltaY * WHEEL_ZOOM_RATE)
      range = clamp(range * factor, MIN_RANGE, MAX_RANGE)
      updateCamera()
      refreshAnchorIfActive(e.clientX, e.clientY)
    }

    const onPointerLeave = () => {
      if (pointers.size === 0) clearHover()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      stopMomentum()
      destroyed = true
      viewer.destroy()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
