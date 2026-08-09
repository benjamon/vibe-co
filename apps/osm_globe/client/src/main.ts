import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { initLayerMenu } from './layerMenu'
import { initStyleSwitcher, STYLES } from './styleSwitcher'

// Vite's dep optimizer doesn't handle maplibre-gl's worker file correctly
// out of the box (throws "file does not exist ... maplibre-gl-worker.mjs"),
// so the worker URL has to be wired up explicitly.
maplibregl.setWorkerUrl(workerUrl)

const map = new maplibregl.Map({
  container: 'map',
  // OpenFreeMap: free, keyless, self-hostable vector tiles built from
  // OpenStreetMap data. https://openfreemap.org
  style: STYLES.Liberty,
  center: [0, 20],
  zoom: 1.5,
  attributionControl: false,
  // Default handlers already give Google Maps-style controls:
  // drag to pan, scroll wheel to zoom, pinch to zoom/rotate on touch,
  // double-click to zoom in.
})

map.addControl(new maplibregl.AttributionControl({ compact: true }))
map.addControl(new maplibregl.NavigationControl(), 'top-right')
map.addControl(new maplibregl.GlobeControl(), 'top-right')

// Menu DOM/listeners only — safe to build before the style has loaded.
initLayerMenu(map)
initStyleSwitcher(map)

// Re-applied on every style load (including style switches, which replace
// the whole style and drop projection/sky/custom layers).
map.on('style.load', () => {
  map.setProjection({ type: 'globe' })

  // Atmosphere haze around the globe's edge.
  map.setSky({
    'sky-color': 'rgb(11, 11, 25)',
    'sky-horizon-blend': 0.5,
    'horizon-color': 'rgb(186, 210, 235)',
    'horizon-fog-blend': 0.5,
    'fog-color': 'rgb(186, 210, 235)',
    'fog-ground-blend': 0.5,
  })

  // None of OpenFreeMap's styles have standalone coast/lake/river-edge
  // layers — those only exist as the edge of the "water" fill polygons —
  // so stroke that same source-layer as lines, split by the water layer's
  // "class" enum (ocean/lake/pond/river/dock/swimming_pool, per
  // https://github.com/openmaptiles/openmaptiles/blob/master/layers/water/water.yaml)
  // to get separately toggleable coast/lake/river outlines. The
  // "openmaptiles" source and "water" source-layer are shared by every
  // OpenFreeMap style, but layer IDs like "boundary_3" are
  // Liberty-specific, so the insertion point falls back to the top of the
  // stack on styles that don't have it.
  const beforeId = map.getLayer('boundary_3') ? 'boundary_3' : undefined
  const waterEdge = (
    id: string,
    classFilter: unknown,
    color: string,
  ) => {
    map.addLayer(
      {
        id,
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['all', classFilter, ['!=', ['get', 'brunnel'], 'tunnel']] as maplibregl.FilterSpecification,
        paint: {
          'line-color': color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 8, 1.5],
        },
      },
      beforeId,
    )
  }

  waterEdge('coastline_stroke', ['==', ['get', 'class'], 'ocean'], 'hsl(205, 40%, 55%)')
  waterEdge(
    'lake_stroke',
    ['in', ['get', 'class'], ['literal', ['lake', 'pond']]],
    'hsl(185, 45%, 42%)',
  )
  waterEdge('river_polygon_stroke', ['==', ['get', 'class'], 'river'], 'hsl(220, 55%, 50%)')
})
