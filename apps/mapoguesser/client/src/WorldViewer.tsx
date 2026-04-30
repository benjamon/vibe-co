import { useEffect, useRef } from 'react'
import {
  buildModuleUrl,
  Color,
  GeoJsonDataSource,
  HeadingPitchRange,
  ImageryLayer,
  Ion,
  Matrix4,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useGameStore } from './store'

// Cesium normally hits Cesium ion for default assets/terrain. We use only the
// bundled Natural Earth basemap, so blank the token to avoid stray network calls.
Ion.defaultAccessToken = ''

const MIN_RANGE = 7_000_000 // m, just above the Earth's surface
const MAX_RANGE = 60_000_000 // m
const DEFAULT_RANGE = 25_000_000

// Pitch range: 0 = horizontal at the equator, ±π/2 = looking straight down at
// a pole. Stop just shy of the singularity so the camera doesn't tip over.
const PITCH_LIMIT = Math.PI / 2 - 0.01

const DRAG_SENSITIVITY = 0.005 // rad / pixel
const WHEEL_ZOOM_SENSITIVITY = 0.001
const FRICTION = 3 // 1/sec; higher = momentum decays faster
const STOP_THRESHOLD = 0.02 // rad/sec; below this we end the animation
const FLICK_WINDOW_MS = 120 // only carry momentum if the last move was recent

type PointerSample = { x: number; y: number; t: number }

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

export function WorldViewer() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const baseLayer = ImageryLayer.fromProviderAsync(
      TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl('Assets/Textures/NaturalEarthII'),
      ),
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

    // We drive the camera ourselves; disable Cesium's input handling.
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableInputs = false
    ssc.enableRotate = false
    ssc.enableTranslate = false
    ssc.enableZoom = false
    ssc.enableTilt = false
    ssc.enableLook = false

    // Country borders, 4px wide, clamped to the ellipsoid so the line width
    // is rendered as a ground primitive (which actually respects pixel width
    // on every browser, unlike WebGL line primitives).
    let countryDataSource: GeoJsonDataSource | undefined
    GeoJsonDataSource.load(
      `${import.meta.env.BASE_URL}assets/data/countries.geojson`,
      {
        stroke: Color.WHITE.withAlpha(0.9),
        strokeWidth: 4,
        fill: Color.TRANSPARENT,
        clampToGround: true,
      },
    )
      .then((ds) => {
        countryDataSource = ds
        viewer.dataSources.add(ds)
      })
      .catch((err) => {
        console.warn('failed to load country borders', err)
      })

    // Camera state.
    let heading = 0
    let pitch = 0
    let range = DEFAULT_RANGE
    let velHeading = 0 // rad/sec
    let velPitch = 0 // rad/sec

    const applyCamera = () => {
      pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
      range = clamp(range, MIN_RANGE, MAX_RANGE)
      viewer.scene.camera.lookAtTransform(
        Matrix4.IDENTITY,
        new HeadingPitchRange(heading, pitch, range),
      )
      useGameStore.getState().setHeading(heading)
    }

    // Pointer state.
    const pointers = new Map<number, PointerSample>()
    let pinchDist = 0
    let lastMoveTime = 0

    const cancelMomentum = () => {
      velHeading = 0
      velPitch = 0
    }

    // requestAnimationFrame loop, only running while there's momentum or an
    // active pointer worth re-rendering for.
    let rafHandle: number | null = null
    let lastFrame = 0
    const tick = (now: number) => {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60
      lastFrame = now

      if (pointers.size === 0) {
        heading += velHeading * dt
        pitch += velPitch * dt
        // Stop pitch momentum once it hits a bound.
        if (pitch >= PITCH_LIMIT && velPitch > 0) velPitch = 0
        if (pitch <= -PITCH_LIMIT && velPitch < 0) velPitch = 0
        const decay = Math.exp(-FRICTION * dt)
        velHeading *= decay
        velPitch *= decay
      }

      applyCamera()

      const stillMoving =
        Math.abs(velHeading) > STOP_THRESHOLD ||
        Math.abs(velPitch) > STOP_THRESHOLD
      if (pointers.size > 0 || stillMoving) {
        rafHandle = requestAnimationFrame(tick)
      } else {
        velHeading = 0
        velPitch = 0
        rafHandle = null
        lastFrame = 0
      }
    }
    const ensureTick = () => {
      if (rafHandle === null) {
        lastFrame = 0
        rafHandle = requestAnimationFrame(tick)
      }
    }

    applyCamera() // initial pose

    const canvas = viewer.scene.canvas
    canvas.style.touchAction = 'none'

    const onPointerDown = (e: PointerEvent) => {
      cancelMomentum()
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
      })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // pointer capture is best-effort
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const now = performance.now()
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      const dt = (now - prev.t) / 1000
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now })
      lastMoveTime = now

      if (pointers.size === 1) {
        const dh = dx * DRAG_SENSITIVITY
        const dp = dy * DRAG_SENSITIVITY
        heading += dh
        pitch += dp
        if (dt > 0) {
          velHeading = dh / dt
          velPitch = dp / dt
        }
      } else if (pointers.size >= 2) {
        cancelMomentum()
        const [a, b] = [...pointers.values()]
        const newDist = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && newDist > 0) {
          range *= pinchDist / newDist
        }
        pinchDist = newDist
      }

      applyCamera()
    }

    const endPointer = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
      if (pointers.size === 0) {
        // Drop stale velocity if the user paused before lifting so we don't
        // fling unexpectedly.
        if (performance.now() - lastMoveTime > FLICK_WINDOW_MS) {
          cancelMomentum()
        }
        ensureTick()
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelMomentum()
      range *= Math.exp(e.deltaY * WHEEL_ZOOM_SENSITIVITY)
      applyCamera()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endPointer)
    canvas.addEventListener('pointercancel', endPointer)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endPointer)
      canvas.removeEventListener('pointercancel', endPointer)
      canvas.removeEventListener('wheel', onWheel)
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
      if (countryDataSource) viewer.dataSources.remove(countryDataSource)
      viewer.destroy()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
