import { useEffect, useRef } from 'react'
import {
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  OpenStreetMapImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useGameStore } from './store'

// Camera distance from Earth's centre (metres). The Earth's radius is ~6.4 Mm,
// so 25 Mm leaves the globe comfortably framed.
const RANGE = 25_000_000

// Radians of horizontal rotation per pixel of pointer movement.
const SENSITIVITY = 0.005

export function WorldViewer() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const baseLayer = new ImageryLayer(
      new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      }),
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
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    })

    // Disable Cesium's built-in camera controls; we drive the camera ourselves
    // so that the only allowed motion is heading rotation around the poles.
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableInputs = false
    ssc.enableRotate = false
    ssc.enableTranslate = false
    ssc.enableZoom = false
    ssc.enableTilt = false
    ssc.enableLook = false

    // Heading is rotation about the Earth-fixed Z axis (the polar axis), so
    // varying it spins the globe horizontally while keeping the poles fixed
    // vertically on screen.
    let heading = 0
    const updateCamera = () => {
      viewer.scene.camera.lookAtTransform(
        Matrix4.IDENTITY,
        new HeadingPitchRange(heading, 0, RANGE),
      )
      viewer.scene.requestRender()
      useGameStore.getState().setHeading(heading)
    }
    updateCamera()

    const canvas = viewer.scene.canvas
    canvas.style.touchAction = 'none'

    let activePointer: number | null = null
    let lastX = 0

    const onPointerDown = (e: PointerEvent) => {
      if (activePointer !== null) return
      activePointer = e.pointerId
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      heading = CesiumMath.zeroToTwoPi(heading - dx * SENSITIVITY)
      updateCamera()
    }
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return
      activePointer = null
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // pointer was already released
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      viewer.destroy()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
