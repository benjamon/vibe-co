import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { LngLatLike } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
// Vite's dep optimizer doesn't resolve maplibre-gl's worker file correctly out
// of the box (throws "file does not exist ... maplibre-gl-worker.mjs"), so the
// worker URL has to be wired up explicitly. See apps/osm_globe's spike.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  useGameStore,
  capitalPointTierMilesFor,
  haversineMiles,
  destinationPoint,
  type Marker,
  type CityInfo,
  type MapStyleChoice,
} from './store'
import { resolveSubMode } from './gameModes'
import { usStateFlagUrl } from './usStateFlags'
import {
  styleFor,
  HIDDEN_LAYER_IDS,
  COUNTRY_LINE_LAYERS_BY_STYLE,
  STATE_BORDER_COLOR_BY_STYLE,
} from './mapStyles'

maplibregl.setWorkerUrl(workerUrl)

// --- Camera ------------------------------------------------------------
const INITIAL_ZOOM = 1.6
const MIN_ZOOM = 1.0
const MAX_ZOOM = 9
const REVEAL_MS = 1200
const BROWSE_FLY_MS = REVEAL_MS * 0.5
const DRAW_FRAME_MS = 1400
const DRAW_FRAME_PADDING_PX = 64
const DRAW_REVEAL_HOLD_MS = 10000

// Outline colour for each capitals-mode score-tier ring (see
// capitalPointTierMilesFor), innermost (best) to outermost (worst).
const CAPITAL_TIER_RING_COLORS = ['#3fb84e', '#a8d94a', '#f5c542', '#f2994a', '#e64545']
const DRAW_ROUND_COLORS = ['#FF4D4D', '#4D9DFF', '#4DDC84', '#B24DFF', '#FFA64D']

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// --- Geometry helpers ----------------------------------------------------
// Pure lat/lon math, independent of the map library — point-in-polygon hit
// testing plus the draw-mode overlap scoring all run on the CPU against the
// raw GeoJSON rather than through the renderer.
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

const pointInSubPolygon = (lon: number, lat: number, poly: SubPolygon): boolean => {
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
  return count > 0 ? { lat: latSum / count, lon: lonSum / count } : { lat: 0, lon: 0 }
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

const computeBBox = (polys: SubPolygon[]): [number, number, number, number] => {
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

// A GeoJSON ring (lon,lat pairs) approximating a geodesic circle of radius
// `radiusMi` around (lat, lon) — built from destinationPoint (store.ts),
// which already does the haversine offset math for the capitals-mode hint
// circle nudge. Used for the hint circle, score-tier rings, and the tiny-
// country landing-zone dots.
const circleRing = (lat: number, lon: number, radiusMi: number, steps = 64): LatLon[] => {
  const ring: LatLon[] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = (360 * i) / steps
    const p = destinationPoint(lat, lon, bearing, radiusMi)
    ring.push([p.lon, p.lat])
  }
  return ring
}

const emptyFC = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

// --- Data source URLs ------------------------------------------------------
const COUNTRY_POLYGONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson'
// Populated places (10m set, ~7300 cities with pop_max + adm0cap + admin-1
// capitals). Drives the cities game modes and the flag-pin fallback (a
// country's capital, validated inside).
const POPULATED_PLACES_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson'
// US state polygons — CPU point-in-polygon hit-testing for the US States
// mode. Filtered to `type === 'State'`, which drops DC and every territory,
// leaving exactly the 50 states.
const STATE_POLYGONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson'

// Countries at or below this polygon area (deg²) get an expanded click
// hitbox (see nearestTinyCountry) — small island nations and city-states are
// otherwise all but unclickable at a normal zoom level.
const TINY_HITBOX_MAX_AREA = 1.0
const TINY_HIT_PIXEL_RADIUS = 18
// A click within this many real-world miles of a tiny target counts as a hit
// outright, regardless of which polygon (if any) it actually landed in.
const GENEROUS_HIT_MILES = 10

export function WorldViewer() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const portrait = window.innerHeight > window.innerWidth
    const zoomBump = portrait ? 0.75 : 0
    const initialZoom = INITIAL_ZOOM + zoomBump
    const minZoom = MIN_ZOOM + zoomBump

    const map = new maplibregl.Map({
      container,
      style: styleFor(useGameStore.getState().mapStyle),
      center: [0, 20],
      zoom: initialZoom,
      minZoom,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      // We drive taps/clicks ourselves (see onMapClick) and disable panning
      // entirely during Draw mode's freehand tracing — leave rotation off
      // globally so a stray two-finger twist never tilts the "north up" view
      // this game assumes everywhere else.
      dragRotate: false,
      touchPitch: false,
      // A round flies the camera all over the globe (reveal pans, browsing
      // the item list, …), constantly pushing tiles out of view — widen the
      // out-of-view tile cache's zoom-level window (default 5) so revisited
      // areas are more often an instant cache hit instead of a re-fetch.
      // Complements SATELLITE_STYLE's coarse base layer, which covers the
      // still-genuinely-uncached case.
      maxTileCacheZoomLevels: 12,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }))
    map.touchZoomRotate.disableRotation()
    // Playwright introspection hook, mirroring App.tsx's window.__gameState —
    // lets e2e tests confirm a drag actually pans the map.
    ;(window as unknown as { __mapInstance?: maplibregl.Map }).__mapInstance = map

    let destroyed = false

    // --- Style setup: globe projection, sky, hidden label/road layers ------
    // Re-run on every style load — both the initial one and every subsequent
    // map.setStyle() from a mapStyle switch (see the store subscription below).
    // A style swap tears down every source/layer that isn't part of the new
    // style JSON, including all of our own game layers and their live data,
    // so this both rebuilds them and re-populates them from current state.
    const applyStyleExtras = () => {
      map.setProjection({ type: 'globe' })
      map.setSky({
        'sky-color': 'rgb(11, 11, 25)',
        'sky-horizon-blend': 0.5,
        'horizon-color': 'rgb(186, 210, 235)',
        'horizon-fog-blend': 0.5,
        'fog-color': 'rgb(186, 210, 235)',
        'fog-ground-blend': 0.5,
      })
      for (const id of HIDDEN_LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }
      addGameSourcesAndLayers()
      showCountryBorders(useGameStore.getState().mode !== 'draw')
      showStateBorders(
        wantStateLines(useGameStore.getState().browseSubModeId ?? useGameStore.getState().subMode),
      )
      redrawStrokes()
      renderCapitalsOverlay()
      resyncDrawReveal()
    }

    const setLineLayersVisible = (ids: string[], visible: boolean): void => {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
        }
      }
    }

    // Whether the active sub-mode wants the (worldwide, admin_level 3-6)
    // state-line layer shown.
    const wantStateLines = (subMode: string): boolean => {
      const sm = resolveSubMode(subMode)
      return sm.cities?.usStateLines === true || sm.family === 'states'
    }

    // Country/state border visibility, routed to whichever layer actually
    // carries borders for the active basemap: most vector styles ship their
    // own country boundary lines (id scheme varies per style — see
    // COUNTRY_LINE_LAYERS_BY_STYLE), but a raster style like satellite is
    // bare imagery with no boundaries at all, so it leans on our own
    // entry-borders overlay (see renderEntryBorders) instead. Every other
    // call site goes through this function rather than touching the
    // per-style layer map or entry-borders-country directly, so the
    // mapStyle switch is the only place that needs to know which is live.
    const showCountryBorders = (visible: boolean): void => {
      const layers = COUNTRY_LINE_LAYERS_BY_STYLE[useGameStore.getState().mapStyle]
      setLineLayersVisible(layers ?? ['entry-borders-country'], visible)
    }
    // State lines always use our own entry-borders-state overlay, on every
    // basemap — unlike country lines, no vector style's admin_level-4
    // boundary layer carries a country code to filter on, and the States
    // game is US-only (stateEntries is hard-filtered to adm0_a3 === 'USA').
    // A `within`-filter mask against a US polygon was tried instead of this,
    // clipping Liberty's/Toner's native worldwide layer down to just the US,
    // but tile geometry gets simplified more aggressively than our reference
    // polygon at low zoom, so lines near the (also-simplified) edges of that
    // polygon failed the strict "entirely within" test and vanished — only
    // showing once zoomed in enough for the tile geometry to stay safely
    // clear of the mask's boundary. entry-borders-state has no such mismatch
    // since it's built from the same single dataset end to end (see
    // renderEntryBorders) — Liberty's boundary_3 and Toner's boundary_state
    // are permanently hidden instead (see HIDDEN_LAYER_IDS).
    const showStateBorders = (visible: boolean): void => {
      setLineLayersVisible(['entry-borders-state'], visible)
      // Colorful style's fill mosaic follows this same signal — state colors
      // whenever state lines are, country colors whenever they're not (see
      // renderColorfulFill) — so every call site that decides state-line
      // visibility (including the phase-gated draw-states one) drives it too,
      // with no separate wiring needed.
      syncColorfulFill(visible)
    }
    const syncColorfulFill = (showStates: boolean): void => {
      if (useGameStore.getState().mapStyle !== 'colorful') return
      if (!map.getLayer('colorful-fill')) return
      renderColorfulFill(showStates)
    }

    // --- Our own GeoJSON sources/layers, added once the style is ready -----
    const TINY_DOTS_SRC = 'tiny-dots'
    const CAPITALS_OVERLAY_SRC = 'capitals-overlay'
    const DRAW_STROKES_SRC = 'draw-strokes'
    const DRAW_REVEAL_SRC = 'draw-reveal'
    const ENTRY_BORDERS_SRC = 'entry-borders'
    const COLORFUL_FILL_SRC = 'colorful-fill'

    const addGameSourcesAndLayers = () => {
      // Colorful style's per-region fill mosaic — a decorative basemap
      // layer, not a gameplay hint itself, but its granularity follows
      // whatever the state-line toggle is actually showing: US state colors
      // while state lines are up (States game, draw-states reveal), country
      // colors the rest of the time (see showStateBorders/syncColorfulFill,
      // which is what actually re-renders this on every mode change — this
      // initial render just covers the moment the layer is first created).
      // Visibility, unlike the data, is keyed on mapStyle alone: always on
      // for 'colorful', always off otherwise. Sits directly under
      // boundary_country (when that layer exists — every style but
      // 'colorful' hides this anyway) so the country border stays legible on
      // top of the fill.
      map.addSource(COLORFUL_FILL_SRC, { type: 'geojson', data: emptyFC() })
      const colorfulVisible = useGameStore.getState().mapStyle === 'colorful' ? 'visible' : 'none'
      const beforeCountryLine = map.getLayer('boundary_country') ? 'boundary_country' : undefined
      map.addLayer(
        {
          id: 'colorful-fill',
          type: 'fill',
          source: COLORFUL_FILL_SRC,
          layout: { visibility: colorfulVisible },
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.8 },
        },
        beforeCountryLine,
      )
      map.addLayer(
        {
          id: 'colorful-outline',
          type: 'line',
          source: COLORFUL_FILL_SRC,
          layout: { visibility: colorfulVisible },
          paint: { 'line-color': 'rgba(255, 255, 255, 0.7)', 'line-width': 1 },
        },
        beforeCountryLine,
      )
      renderColorfulFill(
        wantStateLines(useGameStore.getState().browseSubModeId ?? useGameStore.getState().subMode),
      )

      map.addSource(TINY_DOTS_SRC, { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'tiny-dots-fill',
        type: 'fill',
        source: TINY_DOTS_SRC,
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'tiny-dots-line',
        type: 'line',
        source: TINY_DOTS_SRC,
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 2 },
      })

      map.addSource(CAPITALS_OVERLAY_SRC, { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'capitals-overlay-fill',
        type: 'fill',
        source: CAPITALS_OVERLAY_SRC,
        filter: ['==', ['get', 'kind'], 'hint'],
        paint: { 'fill-color': '#ffe066', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'capitals-overlay-ring',
        type: 'line',
        source: CAPITALS_OVERLAY_SRC,
        filter: ['in', ['get', 'kind'], ['literal', ['hint', 'tier']]],
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#ffe066'],
          'line-opacity': ['case', ['==', ['get', 'kind'], 'hint'], 0.9, 0.85],
          'line-width': 2,
        },
      })
      map.addLayer({
        id: 'capitals-overlay-line',
        type: 'line',
        source: CAPITALS_OVERLAY_SRC,
        filter: ['==', ['get', 'kind'], 'guessline'],
        paint: {
          'line-color': '#ffe066',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      })

      map.addSource(DRAW_STROKES_SRC, { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'draw-strokes-line',
        type: 'line',
        source: DRAW_STROKES_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 },
      })

      map.addSource(DRAW_REVEAL_SRC, { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'draw-reveal-fill',
        type: 'fill',
        source: DRAW_REVEAL_SRC,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': [
            'match',
            ['get', 'cls'],
            'hit',
            '#3fb84e',
            'missed',
            '#9aa0a6',
            'extra',
            '#e64545',
            '#000000',
          ],
          'fill-opacity': [
            'match',
            ['get', 'cls'],
            'hit',
            0.35,
            'missed',
            0.4,
            'extra',
            0.35,
            0,
          ],
        },
      })
      map.addLayer({
        id: 'draw-reveal-outline',
        type: 'line',
        source: DRAW_REVEAL_SRC,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      })

      // Country/state borders derived from the already-loaded polygon index
      // (see renderEntryBorders). entry-borders-country is a fallback, only
      // shown on a raster style like satellite that has no boundary lines of
      // its own; entry-borders-state is used on every style, always (see
      // showStateBorders). Both hidden by default here and toggled on by
      // showCountryBorders/showStateBorders as the mode/style require.
      map.addSource(ENTRY_BORDERS_SRC, { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'entry-borders-country',
        type: 'line',
        source: ENTRY_BORDERS_SRC,
        filter: ['==', ['get', 'kind'], 'country'],
        layout: { visibility: 'none' },
        paint: { 'line-color': '#000000', 'line-opacity': 0.8, 'line-width': 1.5 },
      })
      map.addLayer({
        id: 'entry-borders-state',
        type: 'line',
        source: ENTRY_BORDERS_SRC,
        filter: ['==', ['get', 'kind'], 'state'],
        layout: { visibility: 'none' },
        paint: {
          'line-color': STATE_BORDER_COLOR_BY_STYLE[useGameStore.getState().mapStyle] ?? '#000000',
          'line-opacity': 0.8,
          'line-width': 1.5,
        },
      })

      tinyDots.show(resolveSubMode(useGameStore.getState().subMode).family === 'countries')
      if (countryEntries) renderTinyCountryDots()
      renderEntryBorders()
    }

    // Country borders (satellite fallback) and state borders (every style),
    // built from the same polygon index used for hit-testing
    // (countryEntries/stateEntries) — no extra fetch needed. Re-run whenever
    // either dataset (re)loads, and once per style load (the source is wiped
    // by every map.setStyle() call).
    const renderEntryBorders = (): void => {
      const features: Feature[] = []
      const addEntries = (entries: CountryEntry[] | null, kind: 'country' | 'state') => {
        if (!entries) return
        for (const entry of entries) {
          for (const poly of entry.polygons) {
            for (const ring of poly) {
              if (!ring || ring.length < 2) continue
              features.push({
                type: 'Feature',
                properties: { kind },
                geometry: { type: 'LineString', coordinates: [...ring, ring[0]] },
              })
            }
          }
        }
      }
      addEntries(countryEntries, 'country')
      addEntries(stateEntries, 'state')
      setSourceData(ENTRY_BORDERS_SRC, { type: 'FeatureCollection', features })
    }

    // Colorful style's per-region fill colors — spread evenly around the hue
    // wheel via the golden angle (~137.5°) rather than 360/entries.length, so
    // adjacent regions (which get adjacent hues under naive even spacing
    // only if the entry list happens to be geographically sorted, which it
    // isn't) end up visually distinct regardless of fetch order; high
    // lightness/moderate saturation keeps every hue "pastel". Colors are
    // keyed by name over an alphabetically-sorted copy so they're stable
    // across reloads/mode-switches instead of depending on fetch order.
    // Which entry list to use is the whole "split into two behaviors" of
    // this style — US states while state lines are shown (stateEntries,
    // hard-filtered to just the US — see its fetch below), every country
    // otherwise (countryEntries) — driven by showStateBorders/
    // syncColorfulFill so it flips in lockstep with the actual line layer.
    const renderColorfulFill = (showStates: boolean): void => {
      const entries = showStates ? stateEntries : countryEntries
      if (!entries) return
      const sortedNames = [...entries].map((e) => e.name).sort()
      const colorByName = new Map(
        sortedNames.map((name, i) => [name, `hsl(${(i * 137.508) % 360}, 62%, 82%)`]),
      )
      const features: Feature[] = entries.map((entry) => ({
        type: 'Feature',
        properties: { name: entry.name, color: colorByName.get(entry.name) ?? '#cccccc' },
        geometry: { type: 'MultiPolygon', coordinates: entry.polygons },
      }))
      setSourceData(COLORFUL_FILL_SRC, { type: 'FeatureCollection', features })
    }

    const setSourceData = (id: string, data: FeatureCollection): void => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      src?.setData(data)
    }

    // Tiny-dots visibility is a plain layout-visibility toggle (the data
    // itself is static once loaded), unlike the other sources which get
    // fresh setData() calls as the game state changes.
    const tinyDots = {
      show: (visible: boolean) => {
        if (!map.getLayer('tiny-dots-fill')) return
        const v = visible ? 'visible' : 'none'
        map.setLayoutProperty('tiny-dots-fill', 'visibility', v)
        map.setLayoutProperty('tiny-dots-line', 'visibility', v)
      },
    }

    // Capitals-mode overlays (hint circle, score-tier rings, guess line),
    // rebuilt from the store's current hintCircle/guessLine — called both on
    // every change to either (see the subscription below) and to re-sync
    // after a style switch wipes CAPITALS_OVERLAY_SRC.
    const renderCapitalsOverlay = (): void => {
      const state = useGameStore.getState()
      const features: Feature[] = []
      if (state.hintCircle) {
        const c = state.hintCircle
        features.push({
          type: 'Feature',
          properties: { kind: 'hint' },
          geometry: { type: 'Polygon', coordinates: [circleRing(c.lat, c.lon, c.radiusMi)] },
        })
      }
      if (state.guessLine) {
        const g = state.guessLine
        capitalPointTierMilesFor(state.subMode).forEach((mi, i) => {
          features.push({
            type: 'Feature',
            properties: { kind: 'tier', color: CAPITAL_TIER_RING_COLORS[i] },
            geometry: { type: 'Polygon', coordinates: [circleRing(g.toLat, g.toLon, mi)] },
          })
        })
        features.push({
          type: 'Feature',
          properties: { kind: 'guessline' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [g.fromLon, g.fromLat],
              [g.toLon, g.toLat],
            ],
          },
        })
      }
      setSourceData(CAPITALS_OVERLAY_SRC, { type: 'FeatureCollection', features })
    }

    // 'style.load' (not 'load') fires for the initial style AND every later
    // map.setStyle() call, so this one listener covers both.
    map.on('style.load', applyStyleExtras)

    // --- Flag-pin sprite composition (canvas, no maplibre dependency) ------
    type PinKind = Marker['kind'] | 'stats'
    const PIN_BG: Record<PinKind, string> = {
      correct: '#3fb84e',
      wrong: '#9aa0a6',
      reveal: '#e64545',
      stats: '#3d7bdb',
      guess: '#9aa0a6',
      'guess-best': '#ffd93b',
    }
    const POLE_W = 6
    const POLE_H = 48
    const FLAG_W = 40
    const FLAG_H = 28
    const FLAG_TOP = 2
    const PIN_W = POLE_W + FLAG_W
    const PIN_H = POLE_H
    // Pole and flag are separate images (rather than one composited canvas)
    // so the flag alone can be flipped/tilted with a CSS transform on hover
    // while the pole stays put.
    type FlagPinImages = { pole: string; flag: string }
    const flagPinCache = new Map<string, Promise<FlagPinImages | null>>()
    const flagCdnUrl = (code: string): string => `https://flagcdn.com/w160/${code}.png`

    const buildFlagPin = (
      imageUrl: string | undefined,
      kind: PinKind,
    ): Promise<FlagPinImages | null> => {
      const key = `${kind}:${imageUrl ?? '_'}`
      const cached = flagPinCache.get(key)
      if (cached) return cached
      const promise = (async () => {
        const poleCanvas = document.createElement('canvas')
        poleCanvas.width = POLE_W
        poleCanvas.height = POLE_H
        const poleCtx = poleCanvas.getContext('2d')
        const flagCanvas = document.createElement('canvas')
        flagCanvas.width = FLAG_W
        flagCanvas.height = FLAG_H
        const flagCtx = flagCanvas.getContext('2d')
        if (!poleCtx || !flagCtx) return null

        const inset = 0.75
        const left = inset
        const right = POLE_W - inset
        const topR = (right - left) / 2
        poleCtx.beginPath()
        poleCtx.moveTo(left, POLE_H)
        poleCtx.lineTo(left, inset + topR)
        poleCtx.arcTo(left, inset, left + topR, inset, topR)
        poleCtx.arcTo(right, inset, right, inset + topR, topR)
        poleCtx.lineTo(right, POLE_H)
        poleCtx.fillStyle = PIN_BG[kind]
        poleCtx.fill()
        poleCtx.lineWidth = 1.5
        poleCtx.strokeStyle = '#000'
        poleCtx.stroke()

        let drewFlag = false
        if (imageUrl) {
          try {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve()
              img.onerror = () => reject(new Error('flag load failed'))
              img.src = imageUrl
            })
            flagCtx.drawImage(img, 0, 0, FLAG_W, FLAG_H)
            drewFlag = true
          } catch {
            // Flag fetch / CORS failure: fall back to a plain coloured flag.
          }
        }
        if (!drewFlag) {
          flagCtx.fillStyle = PIN_BG[kind]
          flagCtx.fillRect(0, 0, FLAG_W, FLAG_H)
        }
        flagCtx.strokeStyle = 'rgba(0,0,0,0.85)'
        flagCtx.lineWidth = 1
        flagCtx.strokeRect(0.5, 0.5, FLAG_W - 1, FLAG_H - 1)

        try {
          return { pole: poleCanvas.toDataURL('image/png'), flag: flagCanvas.toDataURL('image/png') }
        } catch {
          flagPinCache.delete(key)
          return null
        }
      })()
      flagPinCache.set(key, promise)
      return promise
    }

    const LABEL_STYLE =
      'position:absolute;font:bold 15px sans-serif;color:#fff;' +
      'text-shadow:-1.5px 0 #000,1.5px 0 #000,0 -1.5px #000,0 1.5px #000,' +
      '-1.5px -1.5px #000,1.5px -1.5px #000,-1.5px 1.5px #000,1.5px 1.5px #000;' +
      'pointer-events:none;white-space:pre;text-align:center;'

    // Flag's `left` (within pinWrap) on its default side and swapped to the
    // far side of the pole, each overlapping the pole by 1px like the
    // original single-canvas art did.
    const FLAG_LEFT_DEFAULT = POLE_W - 1
    const FLAG_LEFT_SWAPPED = 1 - FLAG_W

    const makeFlagMarkerEl = (
      images: FlagPinImages,
      label?: string,
    ): {
      root: HTMLDivElement
      pinWrap: HTMLDivElement
      flagSlot: HTMLDivElement
      flagImg: HTMLImageElement
      labelEl: HTMLDivElement | null
    } => {
      const root = document.createElement('div')
      // No inline `position` here: MapLibre's own .maplibregl-marker class sets
      // position:absolute on this exact element, which also serves as the
      // positioning context the children below need. An inline `position`
      // override (even 'relative') beats that class rule, drops the marker
      // into normal block flow, and stacks every subsequent marker underneath
      // the last at full container width — the "each guess lands lower" bug.
      // pinWrap is absolutely positioned within it, so give root an explicit
      // size — otherwise it collapses to 0x0.
      root.style.width = `${PIN_W}px`
      root.style.height = `${PIN_H}px`
      // The marker sits directly over map content (and, for reveal/guess
      // pins, right where a click needs to land) — none of its layers should
      // ever intercept the pointer. Without this, mousemove/click events
      // landing on the pole/flag images never reach the map canvas at all
      // (they're DOM siblings of it, not descendants), which both ate clicks
      // on whatever the pin was covering and silently broke the hover-tilt
      // tracking below right at the one spot it needed to fire.
      root.style.pointerEvents = 'none'

      // Pole, flag and label all live inside pinWrap so the cursor-proximity
      // tilt (see the map mousemove handler below) rotates the whole pin
      // together, pivoting at the pole's base — the geo anchor point, which
      // sits at (POLE_W/2, PIN_H) in this element's own coordinates since the
      // marker's `offset` centers the pole on it.
      const pinWrap = document.createElement('div')
      pinWrap.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;' +
        `transform-origin:${POLE_W / 2}px 100%;transition:transform 120ms ease-out;`
      root.appendChild(pinWrap)

      const pole = document.createElement('img')
      pole.src = images.pole
      pole.width = POLE_W
      pole.height = POLE_H
      pole.style.cssText = 'position:absolute;left:0;top:0;display:block;'
      pinWrap.appendChild(pole)

      // flagSlot's `left` toggles between the pole's two sides on hover (see
      // below) so the flag actually dodges the cursor instead of just
      // spinning in place.
      const flagSlot = document.createElement('div')
      flagSlot.style.cssText =
        `position:absolute;left:${FLAG_LEFT_DEFAULT}px;top:${FLAG_TOP}px;` +
        `width:${FLAG_W}px;height:${FLAG_H}px;transition:left 250ms ease-in-out;`
      pinWrap.appendChild(flagSlot)

      const flagImg = document.createElement('img')
      flagImg.src = images.flag
      flagImg.width = FLAG_W
      flagImg.height = FLAG_H
      flagImg.style.cssText =
        'position:absolute;left:0;top:0;display:block;transition:transform 250ms ease-in-out;'
      flagSlot.appendChild(flagImg)

      let labelEl: HTMLDivElement | null = null
      if (label) {
        labelEl = document.createElement('div')
        labelEl.textContent = label
        labelEl.style.cssText =
          LABEL_STYLE +
          `left:${FLAG_LEFT_DEFAULT + FLAG_W / 2}px;transform:translateX(-50%);` +
          `bottom:${PIN_H + 2}px;transition:left 250ms ease-in-out;`
        pinWrap.appendChild(labelEl)
      }
      return { root, pinWrap, flagSlot, flagImg, labelEl }
    }

    // --- Real-time flag dodge/tilt on cursor proximity ---------------------
    // The whole pin (pole + flag + label) leans away from the cursor, up to
    // FLAG_MAX_TILT_DEG, like a blade of grass being brushed aside, scaling
    // continuously over the full FLAG_NEAR_RADIUS with no separate cutoff for
    // the flip. Once the cursor comes within FLAG_FLIP_RADIUS, the flag also
    // hops to whichever side of the pole is away from the cursor — that side
    // is sticky: it's only re-evaluated while the cursor is within flip
    // range, so it holds its last position as the cursor moves away rather
    // than snapping back to the default side. "Near" is a plain distance-to-
    // pole-centre check, not a hit-test against the flag's own (possibly
    // already-swapped) bounding box, so it can't flicker between states.
    // Driven imperatively off the map's own pointermove (mouse only — see
    // onFlagHoverPointerMove below), not React state, so it stays smooth at
    // pointer speed. The side-swap and its mirror both animate too (CSS
    // transitions on flagSlot's left and flagImg's transform), not just the
    // tilt.
    // Measured to the top of the flag, straight up from the pole's base (the
    // anchor point) — the pin's static, untilted layout, not wherever the
    // flag currently is once rotate()/scaleX() are applied.
    const FLAG_TOP_DY = -PIN_H + FLAG_TOP
    const FLAG_FLIP_RADIUS = 36
    const FLAG_NEAR_RADIUS = 50
    const FLAG_MAX_TILT_DEG = 18

    type FlagHoverTarget = {
      marker: maplibregl.Marker
      pinWrap: HTMLDivElement
      flagSlot: HTMLDivElement
      flagImg: HTMLImageElement
      labelEl: HTMLDivElement | null
    }
    let flagHoverTargets: FlagHoverTarget[] = []
    let hoverMousePx: { x: number; y: number } | null = null
    let hoverRaf = 0

    const updateFlagHover = (): void => {
      hoverRaf = 0
      if (destroyed) return
      for (const { marker, pinWrap, flagSlot, flagImg, labelEl } of flagHoverTargets) {
        if (!hoverMousePx) {
          pinWrap.style.transform = ''
          continue
        }
        const p = map.project(marker.getLngLat())
        const dx = hoverMousePx.x - p.x
        const dy = hoverMousePx.y - (p.y + FLAG_TOP_DY)
        const dist = Math.hypot(dx, dy)
        const tiltT = Math.max(0, Math.min(1, 1 - dist / FLAG_NEAR_RADIUS))
        const dir = dx === 0 ? 0 : dx > 0 ? -1 : 1
        pinWrap.style.transform = `rotate(${(dir * FLAG_MAX_TILT_DEG * tiltT).toFixed(2)}deg)`
        if (dist <= FLAG_FLIP_RADIUS) {
          const swapped = dx > 0
          flagSlot.style.left = `${swapped ? FLAG_LEFT_SWAPPED : FLAG_LEFT_DEFAULT}px`
          if (labelEl) {
            labelEl.style.left = `${(swapped ? FLAG_LEFT_SWAPPED : FLAG_LEFT_DEFAULT) + FLAG_W / 2}px`
          }
          // Mirror the flag horizontally so its pole-side edge still reads
          // as attached to the pole after hopping to its other side.
          flagImg.style.transform = swapped ? 'scaleX(-1)' : ''
        }
      }
    }
    const scheduleFlagHoverUpdate = (): void => {
      if (hoverRaf) return
      hoverRaf = requestAnimationFrame(updateFlagHover)
    }
    const registerFlagHoverTarget = (
      marker: maplibregl.Marker,
      pinWrap: HTMLDivElement,
      flagSlot: HTMLDivElement,
      flagImg: HTMLImageElement,
      labelEl: HTMLDivElement | null,
    ): void => {
      flagHoverTargets.push({ marker, pinWrap, flagSlot, flagImg, labelEl })
      scheduleFlagHoverUpdate()
    }
    const unregisterFlagHoverTarget = (marker: maplibregl.Marker): void => {
      flagHoverTargets = flagHoverTargets.filter((t) => t.marker !== marker)
    }
    // Pointer events (not mousemove/mouseleave) so touch input can be told
    // apart from real mouse movement: mobile browsers fire a synthetic
    // mousemove/mouseleave-less "compatibility" mouse event after a tap,
    // which used to leave a flag stuck mid-tilt/flip with no further
    // mousemove to reset it. pointerType reports 'touch'/'pen' vs 'mouse'
    // natively, with no such synthetic-event quirk to work around.
    const onFlagHoverPointerMove = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return
      const rect = map.getCanvas().getBoundingClientRect()
      hoverMousePx = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      scheduleFlagHoverUpdate()
    }
    const onFlagHoverPointerLeave = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return
      hoverMousePx = null
      scheduleFlagHoverUpdate()
    }
    map.getCanvas().addEventListener('pointermove', onFlagHoverPointerMove)
    map.getCanvas().addEventListener('pointerleave', onFlagHoverPointerLeave)
    map.on('move', scheduleFlagHoverUpdate)

    const makeDotMarkerEl = (best: boolean, label?: string): HTMLDivElement => {
      const root = document.createElement('div')
      // See makeFlagMarkerEl above: no inline `position` override — MapLibre's
      // .maplibregl-marker class already supplies position:absolute.
      root.style.cssText = `width:14px;height:14px;border-radius:50%;box-sizing:border-box;background:${
        best ? '#ffd93b' : '#9aa0a6'
      };border:2px solid rgba(0,0,0,0.8);`
      if (label) {
        const lab = document.createElement('div')
        lab.textContent = label
        lab.style.cssText = LABEL_STYLE + 'left:50%;transform:translateX(-50%);bottom:16px;'
        root.appendChild(lab)
      }
      return root
    }

    // --- Country/state polygon index (fetched once, never rendered as a
    // visible layer — used only for hit-testing clicks and aiming the reveal
    // animation, matching the old Cesium build's approach). --------------
    type LatLonPt = { lat: number; lon: number }
    type CountryEntry = {
      name: string
      bbox: [number, number, number, number]
      centroid: LatLonPt
      polygons: SubPolygon[]
      area: number
      label?: LatLonPt
      aliases: string[]
    }
    let countryEntries: CountryEntry[] | null = null
    let stateEntries: CountryEntry[] | null = null

    type CapitalPt = { lat: number; lon: number; city: string }
    const capitalByName = new Map<string, CapitalPt>()
    const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

    const insideCountry = (entry: CountryEntry, lat: number, lon: number) =>
      entry.polygons.some((poly) => pointInSubPolygon(lon, lat, poly))

    // Where to plant a country's flag/reveal marker. Mean centroid can land
    // outside the borders for crescent/multi-island nations; fall back to
    // the capital, then the label anchor, then the largest sub-polygon.
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
      if (entry.polygons.length > 1) {
        let largest: SubPolygon | null = null
        let largestArea = -1
        for (const poly of entry.polygons) {
          const a = computeArea([poly])
          if (a > largestArea) {
            largestArea = a
            largest = poly
          }
        }
        if (largest) {
          const c = computeCentroid([largest])
          if (insideCountry(entry, c.lat, c.lon)) return c
        }
      }
      return entry.centroid
    }

    type RawPlace = {
      neId: string
      city: string
      lat: number
      lon: number
      pop: number
      capital: boolean
      stateCapital: boolean
      iso: string | null
      adm0: string
      sov0: string
      adm1: string
    }
    let rawPlaces: RawPlace[] = []
    let placesLoaded = false

    const publishCities = () => {
      if (!countryEntries || !placesLoaded) return
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
          stateCapital: p.stateCapital,
        }
      }
      useGameStore.getState().setCities(out)
    }

    fetch(POPULATED_PLACES_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('places'))))
      .then((geo: { features?: Array<Record<string, any>> }) => {
        if (destroyed) return
        const places: RawPlace[] = []
        for (const f of geo.features ?? []) {
          const p = f.properties ?? {}
          const coords = f.geometry?.coordinates
          if (!Array.isArray(coords) || coords.length < 2) continue
          const lon = Number(coords[0])
          const lat = Number(coords[1])
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
          const city = String(p.name ?? p.NAME ?? p.nameascii ?? p.NAMEASCII ?? '')
          if (!city) continue
          const neId = String(p.ne_id ?? p.NE_ID ?? `${city}|${lat}|${lon}`)
          const pop = Number(p.pop_max ?? p.POP_MAX ?? 0) || 0
          const fcla = String(p.featurecla ?? p.FEATURECLA ?? '').toLowerCase()
          const capital =
            p.adm0cap === 1 ||
            p.ADM0CAP === 1 ||
            fcla === 'admin-0 capital' ||
            fcla === 'admin-0 capital alt'
          const stateCapital = fcla === 'admin-1 capital'
          const isoRaw = p.iso_a2 ?? p.ISO_A2
          const iso =
            typeof isoRaw === 'string' && /^[A-Za-z]{2}$/.test(isoRaw)
              ? isoRaw.toLowerCase()
              : null
          const adm0 = String(p.adm0name ?? p.ADM0NAME ?? '')
          const sov0 = String(p.sov0name ?? p.SOV0NAME ?? '')
          const adm1 = String(p.adm1name ?? p.ADM1NAME ?? '')
          places.push({ neId, city, lat, lon, pop, capital, stateCapital, iso, adm0, sov0, adm1 })

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

    const isoA2Of = (props: Record<string, unknown> | undefined): string | null => {
      if (!props) return null
      for (const key of ['ISO_A2_EH', 'ISO_A2'] as const) {
        const v = props[key]
        if (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v)) return v.toLowerCase()
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
          features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }>
        }) => {
          if (destroyed) return
          const list: CountryEntry[] = []
          const codes: Record<string, string> = {}
          const populations: Record<string, number> = {}
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
            const aliases = new Set<string>()
            const iso = isoA2Of(feature.properties as Record<string, unknown>)
            if (iso) {
              codes[name] = iso
              aliases.add(`iso:${iso}`)
            }
            const popEst = Number(props.POP_EST)
            if (Number.isFinite(popEst) && popEst > 0) populations[name] = popEst
            for (const key of ['NAME', 'ADMIN', 'NAME_LONG', 'SOVEREIGNT', 'FORMAL_EN', 'GEOUNIT']) {
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
          if (map.getSource(TINY_DOTS_SRC)) {
            renderTinyCountryDots()
            tinyDots.show(resolveSubMode(useGameStore.getState().subMode).family === 'countries')
          }
          if (map.getSource(ENTRY_BORDERS_SRC)) renderEntryBorders()
          syncColorfulFill(
            wantStateLines(useGameStore.getState().browseSubModeId ?? useGameStore.getState().subMode),
          )
          publishCities()
          useGameStore.getState().setCountryCodes(codes)
          useGameStore.getState().setCountryPopulations(populations)
          const names = list.map((c) => c.name)
          const areas: Record<string, number> = {}
          const centroids: Record<string, { lat: number; lon: number }> = {}
          for (const c of list) {
            areas[c.name] = c.area
            centroids[c.name] = c.centroid
          }
          useGameStore.getState().setCountries(names)
          useGameStore.getState().setCountryAreas(areas)
          useGameStore.getState().setCountryCentroids(centroids)
        },
      )
      .catch(() => {
        // CDN unreachable / blocked — clicks won't resolve to country names.
      })

    fetch(STATE_POLYGONS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`)
        return r.json()
      })
      .then(
        (geo: {
          features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }>
        }) => {
          if (destroyed) return
          const list: CountryEntry[] = []
          for (const feature of geo.features ?? []) {
            const props = feature.properties ?? {}
            const adm0 = props.adm0_a3 ?? props.ADM0_A3
            const type = props.type ?? props.TYPE
            if (adm0 !== 'USA' || type !== 'State') continue
            const name =
              typeof props.name === 'string'
                ? props.name
                : typeof props.NAME === 'string'
                  ? (props.NAME as string)
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
              aliases: [],
            })
          }
          stateEntries = list
          if (map.getSource(ENTRY_BORDERS_SRC)) renderEntryBorders()
          syncColorfulFill(
            wantStateLines(useGameStore.getState().browseSubModeId ?? useGameStore.getState().subMode),
          )
          useGameStore.getState().setStates(list.map((c) => c.name))
          const stateCentroids: Record<string, { lat: number; lon: number }> = {}
          for (const c of list) stateCentroids[c.name] = c.centroid
          useGameStore.getState().setStateCentroids(stateCentroids)
        },
      )
      .catch(() => {
        // CDN unreachable / blocked — the US States mode stays unplayable.
      })

    // --- Picking -------------------------------------------------------
    const nearestTinyCountry = (list: CountryEntry[], lat: number, lon: number): string | null => {
      const radiusDeg = (TINY_HIT_PIXEL_RADIUS * metersPerPixelAtLat(lat)) / 111_320
      const cosLat = Math.cos((lat * Math.PI) / 180)
      let bestName: string | null = null
      let bestDist = Infinity
      for (const c of list) {
        if (c.area > TINY_HITBOX_MAX_AREA) continue
        if (
          lon < c.bbox[0] - radiusDeg ||
          lon > c.bbox[2] + radiusDeg ||
          lat < c.bbox[1] - radiusDeg ||
          lat > c.bbox[3] + radiusDeg
        )
          continue
        const pt = flagPointFor(c)
        const dLat = lat - pt.lat
        const dLon = (lon - pt.lon) * cosLat
        const dist = Math.hypot(dLat, dLon)
        if (dist <= radiusDeg && dist < bestDist) {
          bestDist = dist
          bestName = c.name
        }
      }
      return bestName
    }

    // Rough metres-per-pixel at the map's current zoom/latitude — used only
    // to size the tiny-country expanded hitbox as a constant *visual* radius
    // regardless of zoom (mirrors the old surfaceRadiansPerPixel helper).
    const metersPerPixelAtLat = (lat: number): number => {
      const zoom = map.getZoom()
      return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
    }

    const generousTinyMatches = (list: CountryEntry[], lat: number, lon: number): Set<string> => {
      const matches = new Set<string>()
      for (const c of list) {
        if (c.area > TINY_HITBOX_MAX_AREA) continue
        const pt = flagPointFor(c)
        if (haversineMiles(lat, lon, pt.lat, pt.lon) <= GENEROUS_HIT_MILES) matches.add(c.name)
      }
      return matches
    }

    // Permanently-visible landing-zone circle for every tiny country — see
    // GENEROUS_HIT_MILES above.
    const renderTinyCountryDots = (): void => {
      if (!countryEntries) return
      const features: Feature[] = []
      for (const c of countryEntries) {
        if (c.area > TINY_HITBOX_MAX_AREA) continue
        const pt = flagPointFor(c)
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circleRing(pt.lat, pt.lon, GENEROUS_HIT_MILES)] },
        })
      }
      setSourceData(TINY_DOTS_SRC, { type: 'FeatureCollection', features })
    }

    const lookupCountryName = (lat: number, lon: number): string | null => {
      const list = countryEntries
      if (!list) return null
      for (const c of list) {
        if (lon < c.bbox[0] || lon > c.bbox[2] || lat < c.bbox[1] || lat > c.bbox[3]) continue
        for (const poly of c.polygons) {
          if (pointInSubPolygon(lon, lat, poly)) return c.name
        }
      }
      return nearestTinyCountry(list, lat, lon)
    }

    const lookupStateName = (lat: number, lon: number): string | null => {
      const list = stateEntries
      if (!list) return null
      for (const c of list) {
        if (lon < c.bbox[0] || lon > c.bbox[2] || lat < c.bbox[1] || lat > c.bbox[3]) continue
        for (const poly of c.polygons) {
          if (pointInSubPolygon(lon, lat, poly)) return c.name
        }
      }
      return null
    }

    // --- Markers ---------------------------------------------------------
    let renderGen = 0
    let gameMarkers: maplibregl.Marker[] = []
    let browseFlagMarker: maplibregl.Marker | null = null

    const renderMarker = (m: Marker, gen: number): void => {
      if (m.kind === 'guess' || m.kind === 'guess-best') {
        const best = m.kind === 'guess-best'
        const el = makeDotMarkerEl(best, m.label)
        const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([m.lon, m.lat])
          .addTo(map)
        gameMarkers.push(mk)
        return
      }
      const st = useGameStore.getState()
      const imageUrl =
        m.flagUrl ??
        (resolveSubMode(st.subMode).family === 'states'
          ? usStateFlagUrl(m.label)
          : (() => {
              const code = m.code ?? st.countryCodes[m.label]
              return code ? flagCdnUrl(code) : undefined
            })())
      buildFlagPin(imageUrl, m.kind).then((images) => {
        if (gen !== renderGen || destroyed || !images) return
        const label =
          m.distanceMi !== undefined
            ? `${m.label}\n${Math.round(m.distanceMi).toLocaleString()} mi`
            : m.label
        const { root, pinWrap, flagSlot, flagImg, labelEl } = makeFlagMarkerEl(images, label)
        const mk = new maplibregl.Marker({
          element: root,
          anchor: 'bottom-left',
          offset: [-POLE_W / 2, 0],
          // Fully hide the flag once the globe's curvature occludes it,
          // rather than maplibre's default faint 0.2 "still visible through
          // the globe" look.
          opacityWhenCovered: '0',
        })
          .setLngLat([m.lon, m.lat])
          .addTo(map)
        gameMarkers.push(mk)
        registerFlagHoverTarget(mk, pinWrap, flagSlot, flagImg, labelEl)
      })
    }

    const clearGameMarkers = (): void => {
      for (const mk of gameMarkers) {
        mk.remove()
        unregisterFlagHoverTarget(mk)
      }
      gameMarkers = []
    }

    let browseGen = 0
    const renderBrowseFlag = (): void => {
      browseGen++
      const gen = browseGen
      if (browseFlagMarker) unregisterFlagHoverTarget(browseFlagMarker)
      browseFlagMarker?.remove()
      browseFlagMarker = null
      const st = useGameStore.getState()
      const bt = st.browseTarget
      if (!bt) return

      const place = (
        lat: number,
        lon: number,
        label: string,
        code: string | undefined,
        flagUrl: string | undefined,
      ) => {
        buildFlagPin(flagUrl ?? (code ? flagCdnUrl(code) : undefined), 'stats').then((images) => {
          if (gen !== browseGen || destroyed || !images) return
          const { root, pinWrap, flagSlot, flagImg, labelEl } = makeFlagMarkerEl(images, label)
          browseFlagMarker = new maplibregl.Marker({
            element: root,
            anchor: 'bottom-left',
            offset: [-POLE_W / 2, 0],
            // Fully hide the flag once the globe's curvature occludes it,
            // rather than maplibre's default faint 0.2 "still visible
            // through the globe" look.
            opacityWhenCovered: '0',
          })
            .setLngLat([lon, lat])
            .addTo(map)
          registerFlagHoverTarget(browseFlagMarker, pinWrap, flagSlot, flagImg, labelEl)
        })
      }

      if (bt.family === 'cities') {
        const city = st.cities[bt.item]
        if (!city) return
        place(city.lat, city.lon, city.city, st.countryCodes[city.country], undefined)
        return
      }
      const entries = bt.family === 'states' ? stateEntries : countryEntries
      const entry = entries?.find((c) => c.name === bt.item)
      if (!entry) return
      const pt = flagPointFor(entry)
      if (bt.family === 'states') {
        place(pt.lat, pt.lon, bt.item, undefined, usStateFlagUrl(bt.item))
      } else {
        place(pt.lat, pt.lon, bt.item, st.countryCodes[bt.item], undefined)
      }
    }

    // --- Cinematic camera pans -------------------------------------------
    let cinematic = false

    const flyTo = (
      lat: number,
      lon: number,
      onDone: () => void,
      durationMs: number = REVEAL_MS,
    ): void => {
      cinematic = true
      map.flyTo({ center: [lon, lat] as LngLatLike, duration: durationMs, essential: true })
      map.once('moveend', () => {
        cinematic = false
        onDone()
      })
    }

    const flyToCountry = (
      name: string,
      onDone: (e: CountryEntry) => void,
      entries: CountryEntry[] | null,
      durationMs: number = REVEAL_MS,
    ) => {
      const entry = entries?.find((c) => c.name === name)
      if (!entry) {
        onDone({ name, bbox: [0, 0, 0, 0], centroid: { lat: 0, lon: 0 }, polygons: [], area: 0, aliases: [] })
        return
      }
      flyTo(entry.centroid.lat, entry.centroid.lon, () => onDone(entry), durationMs)
    }

    // --- Click-to-guess (classic + capitals) ------------------------------
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (cinematic) return
      const dst = useGameStore.getState()
      if (dst.mode === 'draw' && dst.phase === 'playing') return

      const lat = e.lngLat.lat
      const lon = e.lngLat.lng
      const state = useGameStore.getState()
      const family = resolveSubMode(state.subMode).family
      const name = family === 'states' ? lookupStateName(lat, lon) : lookupCountryName(lat, lon)

      if (Date.now() < state.inputLockUntil) return

      if (state.mode === 'capitals') {
        if (state.phase === 'playing' && state.target !== null) {
          const byState = resolveSubMode(state.subMode).cities?.usStateLines === true
          const guessedState = byState ? lookupStateName(lat, lon) : null
          state.handleCapitalGuess(lat, lon, name, guessedState)
        }
        return
      }

      let resolvedName = name
      if (
        family === 'countries' &&
        state.phase === 'playing' &&
        state.target !== null &&
        resolvedName !== state.target &&
        countryEntries &&
        generousTinyMatches(countryEntries, lat, lon).has(state.target)
      ) {
        resolvedName = state.target
      }

      if (state.phase === 'playing' && resolvedName !== null && state.revealTarget === null) {
        const correct = state.target === resolvedName
        let distanceMi: number | undefined
        if (!correct && state.target && family === 'countries') {
          const targetEntry = countryEntries?.find((c) => c.name === state.target)
          if (targetEntry) {
            distanceMi = haversineMiles(lat, lon, targetEntry.centroid.lat, targetEntry.centroid.lon)
          }
        }
        state.addMarker({ lat, lon, kind: correct ? 'correct' : 'wrong', label: resolvedName, distanceMi })
      }
      useGameStore.getState().handleGlobeClick(resolvedName, lat, lon)
    }
    map.on('click', onMapClick)

    // --- Draw mode: freehand tracing ---------------------------------------
    type DrawPoint = { lat: number; lon: number }
    type DrawFillCell = { west: number; south: number; east: number; north: number }
    type DrawFillCells = { hit: DrawFillCell[]; missed: DrawFillCell[]; extra: DrawFillCell[] }
    const DRAW_GRID_RESOLUTION = 80
    const DRAW_FILL_RESOLUTION = 60
    const DRAW_MIN_POINT_PX = 4
    const DRAW_SCORE_MAX_POINTS = 500

    const drawEntriesFor = (subModeId: string): CountryEntry[] | null =>
      resolveSubMode(subModeId).family === 'draw-states' ? stateEntries : countryEntries

    const pointInDrawnLoop = (lon: number, lat: number, loop: DrawPoint[]): boolean => {
      let inside = false
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const xi = loop[i].lon
        const yi = loop[i].lat
        const xj = loop[j].lon
        const yj = loop[j].lat
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-30) + xi) {
          inside = !inside
        }
      }
      return inside
    }
    const pointInAnyShape = (lon: number, lat: number, shapes: DrawPoint[][]): boolean =>
      shapes.some((shape) => pointInDrawnLoop(lon, lat, shape))
    const decimateForScoring = (loop: DrawPoint[]): DrawPoint[] =>
      loop.length > DRAW_SCORE_MAX_POINTS
        ? loop.filter((_, i) => i % Math.ceil(loop.length / DRAW_SCORE_MAX_POINTS) === 0)
        : loop
    const unionBBox = (entry: CountryEntry, shapes: DrawPoint[][]): [number, number, number, number] => {
      const [tMinLon, tMinLat, tMaxLon, tMaxLat] = entry.bbox
      let dMinLon = Infinity
      let dMaxLon = -Infinity
      let dMinLat = Infinity
      let dMaxLat = -Infinity
      for (const shape of shapes) {
        for (const p of shape) {
          if (p.lon < dMinLon) dMinLon = p.lon
          if (p.lon > dMaxLon) dMaxLon = p.lon
          if (p.lat < dMinLat) dMinLat = p.lat
          if (p.lat > dMaxLat) dMaxLat = p.lat
        }
      }
      return [Math.min(tMinLon, dMinLon), Math.min(tMinLat, dMinLat), Math.max(tMaxLon, dMaxLon), Math.max(tMaxLat, dMaxLat)]
    }
    const computeOverlapPercent = (entry: CountryEntry, rawShapes: DrawPoint[][]): number => {
      const shapes = rawShapes.map(decimateForScoring)
      const [lon0, lat0, lon1, lat1] = unionBBox(entry, shapes)
      const lonStep = (lon1 - lon0) / DRAW_GRID_RESOLUTION
      const latStep = (lat1 - lat0) / DRAW_GRID_RESOLUTION
      if (lonStep <= 0 || latStep <= 0) return 0
      let targetCount = 0
      let intersectCount = 0
      let extraCount = 0
      for (let i = 0; i < DRAW_GRID_RESOLUTION; i++) {
        const lon = lon0 + (i + 0.5) * lonStep
        for (let j = 0; j < DRAW_GRID_RESOLUTION; j++) {
          const lat = lat0 + (j + 0.5) * latStep
          const inDrawn = pointInAnyShape(lon, lat, shapes)
          if (insideCountry(entry, lat, lon)) {
            targetCount++
            if (inDrawn) intersectCount++
          } else if (inDrawn) {
            extraCount++
          }
        }
      }
      if (targetCount === 0) return 0
      const hitPercent = (intersectCount / targetCount) * 100
      const overDrawPercent = (extraCount / targetCount) * 100
      return Math.round((hitPercent * 100) / (100 + overDrawPercent))
    }
    const computeDrawFillCells = (entry: CountryEntry, rawShapes: DrawPoint[][]): DrawFillCells => {
      const shapes = rawShapes.map(decimateForScoring)
      const [lon0, lat0, lon1, lat1] = unionBBox(entry, shapes)
      const lonStep = (lon1 - lon0) / DRAW_FILL_RESOLUTION
      const latStep = (lat1 - lat0) / DRAW_FILL_RESOLUTION
      if (lonStep <= 0 || latStep <= 0) return { hit: [], missed: [], extra: [] }
      const hit: DrawFillCell[] = []
      const missed: DrawFillCell[] = []
      const extra: DrawFillCell[] = []
      for (let i = 0; i < DRAW_FILL_RESOLUTION; i++) {
        const west = lon0 + i * lonStep
        const east = west + lonStep
        const lon = west + lonStep / 2
        for (let j = 0; j < DRAW_FILL_RESOLUTION; j++) {
          const south = lat0 + j * latStep
          const north = south + latStep
          const lat = south + latStep / 2
          const inTarget = insideCountry(entry, lat, lon)
          const inDrawn = pointInAnyShape(lon, lat, shapes)
          if (inTarget && inDrawn) hit.push({ west, south, east, north })
          else if (inTarget && !inDrawn) missed.push({ west, south, east, north })
          else if (inDrawn && !inTarget) extra.push({ west, south, east, north })
        }
      }
      return { hit, missed, extra }
    }

    let drawPoints: DrawPoint[] = []
    let shapes: DrawPoint[][] = []
    let drawPointerId: number | null = null
    let lastDrawPx: { x: number; y: number } | null = null
    let allRoundFillCells: DrawFillCells[] = []

    const currentRoundColor = (): string =>
      DRAW_ROUND_COLORS[useGameStore.getState().targetIndex % DRAW_ROUND_COLORS.length]

    const redrawStrokes = (): void => {
      const features: Feature[] = shapes.map((shape) => ({
        type: 'Feature',
        properties: { color: currentRoundColor() },
        geometry: { type: 'LineString', coordinates: [...shape.map((p) => [p.lon, p.lat]), [shape[0].lon, shape[0].lat]] },
      }))
      if (drawPoints.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { color: currentRoundColor() },
          geometry: { type: 'LineString', coordinates: drawPoints.map((p) => [p.lon, p.lat]) },
        })
      }
      setSourceData(DRAW_STROKES_SRC, { type: 'FeatureCollection', features })
    }

    const renderDrawReveal = (targetName: string, fillCells: DrawFillCells): void => {
      const subModeId = useGameStore.getState().subMode
      const entry = drawEntriesFor(subModeId)?.find((c) => c.name === targetName)
      const features: Feature[] = []
      if (entry) {
        for (const poly of entry.polygons) {
          const ring = poly[0]
          if (!ring || ring.length < 2) continue
          features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [...ring, ring[0]] },
          })
        }
      }
      const addCells = (cells: DrawFillCell[], cls: string) => {
        for (const cell of cells) {
          features.push({
            type: 'Feature',
            properties: { cls },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [cell.west, cell.south],
                  [cell.east, cell.south],
                  [cell.east, cell.north],
                  [cell.west, cell.north],
                  [cell.west, cell.south],
                ],
              ],
            },
          })
        }
      }
      addCells(fillCells.hit, 'hit')
      addCells(fillCells.missed, 'missed')
      addCells(fillCells.extra, 'extra')
      setSourceData(DRAW_REVEAL_SRC, { type: 'FeatureCollection', features })
    }

    // Re-populate DRAW_REVEAL_SRC after a style switch, if the player is
    // mid-reveal-hold at the time (its data would otherwise vanish along with
    // the rest of the wiped style).
    const resyncDrawReveal = (): void => {
      const state = useGameStore.getState()
      if (state.mode !== 'draw' || state.drawRevealIndex === null) return
      const revealTarget = state.targets[state.drawRevealIndex]
      if (revealTarget) {
        renderDrawReveal(
          revealTarget,
          allRoundFillCells[state.drawRevealIndex] ?? { hit: [], missed: [], extra: [] },
        )
      }
    }

    const startDrawMatch = (entries: CountryEntry[]): void => {
      if (entries.length === 0) return
      let minLon = Infinity
      let minLat = Infinity
      let maxLon = -Infinity
      let maxLat = -Infinity
      for (const e of entries) {
        minLon = Math.min(minLon, e.bbox[0])
        minLat = Math.min(minLat, e.bbox[1])
        maxLon = Math.max(maxLon, e.bbox[2])
        maxLat = Math.max(maxLat, e.bbox[3])
      }
      cinematic = true
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: DRAW_FRAME_PADDING_PX, duration: DRAW_FRAME_MS, essential: true },
      )
      map.once('moveend', () => {
        cinematic = false
      })
    }

    const sampleLatLon = (clientX: number, clientY: number): DrawPoint | null => {
      const rect = map.getCanvas().getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
      const ll = map.unproject([clientX - rect.left, clientY - rect.top])
      return { lat: ll.lat, lon: ll.lng }
    }

    const beginStroke = (clientX: number, clientY: number): void => {
      const p = sampleLatLon(clientX, clientY)
      if (!p) return
      drawPoints = [p]
      lastDrawPx = { x: clientX, y: clientY }
      redrawStrokes()
    }
    const extendStroke = (clientX: number, clientY: number): void => {
      if (lastDrawPx && Math.hypot(clientX - lastDrawPx.x, clientY - lastDrawPx.y) < DRAW_MIN_POINT_PX) return
      const p = sampleLatLon(clientX, clientY)
      if (!p) return
      drawPoints.push(p)
      lastDrawPx = { x: clientX, y: clientY }
      redrawStrokes()
    }
    const finishStroke = (): void => {
      lastDrawPx = null
      if (drawPoints.length < 3) {
        drawPoints = []
        redrawStrokes()
        return
      }
      shapes.push(drawPoints)
      drawPoints = []
      redrawStrokes()
      useGameStore.getState().setDrawShapeCount(shapes.length)
    }
    const cancelStroke = (): void => {
      lastDrawPx = null
      drawPoints = []
      redrawStrokes()
    }
    const undoLastShape = (): void => {
      if (shapes.length === 0) return
      shapes.pop()
      redrawStrokes()
      useGameStore.getState().setDrawShapeCount(shapes.length)
    }
    const submitShapes = (): void => {
      if (shapes.length === 0) return
      const st = useGameStore.getState()
      const roundIdx = st.targetIndex
      const entry = st.target ? drawEntriesFor(st.subMode)?.find((c) => c.name === st.target) : null
      const percent = entry ? computeOverlapPercent(entry, shapes) : 0
      allRoundFillCells[roundIdx] = entry ? computeDrawFillCells(entry, shapes) : { hit: [], missed: [], extra: [] }
      st.submitDrawGuess(percent)
    }

    // Native pan/zoom/pinch are disabled for as long as Draw mode owns
    // pointer input, so the freehand stroke capture below never fights the
    // map's own gestures. Re-enabled the instant the player leaves the
    // active-play state (post-match reveal browsing is still pannable).
    const setNativeHandlersEnabled = (enabled: boolean): void => {
      if (enabled) {
        map.dragPan.enable()
        map.scrollZoom.enable()
        map.touchZoomRotate.enable()
        map.touchZoomRotate.disableRotation()
        map.doubleClickZoom.enable()
      } else {
        map.dragPan.disable()
        map.scrollZoom.disable()
        map.touchZoomRotate.disable()
        map.doubleClickZoom.disable()
      }
    }
    let drawingActive = false
    const canvas = map.getCanvas()

    const onPointerDown = (e: PointerEvent) => {
      if (cinematic || !drawingActive) return
      const dst = useGameStore.getState()
      if (dst.drawRevealIndex !== null || drawPointerId !== null) return
      drawPointerId = e.pointerId
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // already captured / not capturable
      }
      beginStroke(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== drawPointerId) return
      extendStroke(e.clientX, e.clientY)
    }
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== drawPointerId) return
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
      drawPointerId = null
      if (e.type === 'pointercancel') cancelStroke()
      else finishStroke()
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)

    // --- Store-driven render loop -------------------------------------
    let prevReveal = useGameStore.getState().revealTarget
    let prevEnding = useGameStore.getState().endingTarget
    let prevMarkers = useGameStore.getState().markers
    let prevMarkerEpoch = useGameStore.getState().markerEpoch
    let prevCircle = useGameStore.getState().hintCircle
    let prevGuessLine = useGameStore.getState().guessLine
    let prevSubMode = useGameStore.getState().subMode
    let prevBrowseSubModeId = useGameStore.getState().browseSubModeId
    let prevBrowseTarget = useGameStore.getState().browseTarget
    let prevMode = useGameStore.getState().mode
    let prevPhase = useGameStore.getState().phase
    let prevMapStyle = useGameStore.getState().mapStyle
    let prevDrawMatchSeed: string | null = null
    let prevDrawTarget = useGameStore.getState().target
    let prevDrawRevealIndex = useGameStore.getState().drawRevealIndex
    let prevDrawSubmitNonce = useGameStore.getState().drawSubmitNonce
    let prevDrawUndoNonce = useGameStore.getState().drawUndoNonce
    let revealHoldTimeout: number | null = null
    let endingHoldTimeout: number | null = null
    let drawHoldTimeout: number | null = null

    let renderedMarkerCount = 0
    for (const m of prevMarkers) renderMarker(m, renderGen)
    renderedMarkerCount = prevMarkers.length

    const updateDrawingActive = (mode: string, phase: string) => {
      const active = mode === 'draw' && phase === 'playing'
      if (active === drawingActive) return
      drawingActive = active
      setNativeHandlersEnabled(!active)
    }
    updateDrawingActive(prevMode, prevPhase)

    const unsub = useGameStore.subscribe((state) => {
      if (state.mode !== prevMode) {
        prevMode = state.mode
        showCountryBorders(state.mode !== 'draw')
      }
      updateDrawingActive(state.mode, state.phase)

      if (state.phase !== prevPhase) {
        prevPhase = state.phase
        if (state.mode === 'draw') {
          const isDrawStates = resolveSubMode(state.subMode).family === 'draw-states'
          const showFinishedLines = state.phase === 'finished'
          if (isDrawStates) showStateBorders(showFinishedLines)
          else showCountryBorders(showFinishedLines)
        }
      }

      if (state.subMode !== prevSubMode || state.browseSubModeId !== prevBrowseSubModeId) {
        prevSubMode = state.subMode
        prevBrowseSubModeId = state.browseSubModeId
        const want = wantStateLines(state.browseSubModeId ?? state.subMode)
        showStateBorders(want)
        tinyDots.show(resolveSubMode(state.browseSubModeId ?? state.subMode).family === 'countries')
      }

      if (state.mapStyle !== prevMapStyle) {
        prevMapStyle = state.mapStyle
        map.setStyle(styleFor(state.mapStyle))
      }

      if (state.markerEpoch !== prevMarkerEpoch) {
        renderGen++
        clearGameMarkers()
        renderedMarkerCount = 0
        prevMarkerEpoch = state.markerEpoch
      }

      if (state.markers !== prevMarkers) {
        if (state.markers.length < renderedMarkerCount) {
          renderGen++
          clearGameMarkers()
          renderedMarkerCount = 0
        }
        while (renderedMarkerCount < state.markers.length) {
          renderMarker(state.markers[renderedMarkerCount], renderGen)
          renderedMarkerCount++
        }
        prevMarkers = state.markers
      }

      if (state.hintCircle !== prevCircle || state.guessLine !== prevGuessLine) {
        renderCapitalsOverlay()
        prevCircle = state.hintCircle
        prevGuessLine = state.guessLine
      }

      if (state.revealTarget && state.revealTarget !== prevReveal) {
        const name = state.revealTarget
        const entries = resolveSubMode(state.subMode).family === 'states' ? stateEntries : countryEntries
        flyToCountry(
          name,
          (entry) => {
            if (entry.polygons.length > 0) {
              const pt = flagPointFor(entry)
              useGameStore.getState().addMarker({ lat: pt.lat, lon: pt.lon, kind: 'reveal', label: name })
            }
            if (revealHoldTimeout !== null) clearTimeout(revealHoldTimeout)
            revealHoldTimeout = window.setTimeout(() => {
              revealHoldTimeout = null
              useGameStore.getState().clearReveal()
            }, 2500)
          },
          entries,
        )
      }
      prevReveal = state.revealTarget

      if (state.endingTarget && state.endingTarget !== prevEnding) {
        const name = state.endingTarget
        const entries = resolveSubMode(state.subMode).family === 'states' ? stateEntries : countryEntries
        flyToCountry(
          name,
          () => {
            if (endingHoldTimeout !== null) clearTimeout(endingHoldTimeout)
            endingHoldTimeout = window.setTimeout(() => {
              endingHoldTimeout = null
              useGameStore.getState().finishGame()
            }, 2000)
          },
          entries,
        )
      }
      prevEnding = state.endingTarget

      if (state.browseTarget !== prevBrowseTarget) {
        const bt = state.browseTarget
        prevBrowseTarget = bt
        if (bt) {
          renderBrowseFlag()
          if (bt.family === 'cities') {
            const city = state.cities[bt.item]
            if (city) flyTo(city.lat, city.lon, () => {}, BROWSE_FLY_MS)
          } else {
            const entries = bt.family === 'states' ? stateEntries : countryEntries
            const entry = entries?.find((c) => c.name === bt.item)
            if (entry) flyTo(entry.centroid.lat, entry.centroid.lon, () => {}, BROWSE_FLY_MS)
          }
        } else {
          if (browseFlagMarker) unregisterFlagHoverTarget(browseFlagMarker)
          browseFlagMarker?.remove()
          browseFlagMarker = null
        }
      }

      if (state.mode === 'draw' && state.seed !== prevDrawMatchSeed) {
        prevDrawMatchSeed = state.seed
        prevDrawTarget = state.target
        prevDrawRevealIndex = state.drawRevealIndex
        if (drawHoldTimeout !== null) {
          clearTimeout(drawHoldTimeout)
          drawHoldTimeout = null
        }
        drawPoints = []
        shapes = []
        allRoundFillCells = []
        redrawStrokes()
        setSourceData(DRAW_REVEAL_SRC, emptyFC())
        if (state.phase === 'playing' && state.drawRevealIndex === null) {
          const pool = drawEntriesFor(state.subMode)
          const entries = state.targets
            .map((name) => pool?.find((c) => c.name === name))
            .filter((e): e is CountryEntry => !!e)
          if (entries.length > 0) startDrawMatch(entries)
        }
      } else if (state.mode === 'draw') {
        if (state.target !== prevDrawTarget) {
          prevDrawTarget = state.target
          if (state.drawRevealIndex === null && state.phase === 'playing') {
            drawPoints = []
            shapes = []
            redrawStrokes()
          }
        }
        if (state.drawRevealIndex !== prevDrawRevealIndex) {
          prevDrawRevealIndex = state.drawRevealIndex
          setSourceData(DRAW_REVEAL_SRC, emptyFC())
          if (drawHoldTimeout !== null) {
            clearTimeout(drawHoldTimeout)
            drawHoldTimeout = null
          }
          if (state.drawRevealIndex !== null) {
            const revealTarget = state.targets[state.drawRevealIndex]
            if (revealTarget) {
              renderDrawReveal(
                revealTarget,
                allRoundFillCells[state.drawRevealIndex] ?? { hit: [], missed: [], extra: [] },
              )
            }
            drawHoldTimeout = window.setTimeout(() => {
              drawHoldTimeout = null
              useGameStore.getState().advanceDrawRound()
            }, DRAW_REVEAL_HOLD_MS)
          }
        }
      } else {
        prevDrawMatchSeed = null
        prevDrawTarget = state.target
        prevDrawRevealIndex = state.drawRevealIndex
      }

      if (state.mode !== 'draw' && (shapes.length > 0 || drawPoints.length > 0)) {
        drawPoints = []
        shapes = []
        allRoundFillCells = []
        redrawStrokes()
        setSourceData(DRAW_REVEAL_SRC, emptyFC())
        if (drawHoldTimeout !== null) {
          clearTimeout(drawHoldTimeout)
          drawHoldTimeout = null
        }
      }

      if (state.drawSubmitNonce !== prevDrawSubmitNonce) {
        prevDrawSubmitNonce = state.drawSubmitNonce
        submitShapes()
      }
      if (state.drawUndoNonce !== prevDrawUndoNonce) {
        prevDrawUndoNonce = state.drawUndoNonce
        undoLastShape()
      }
    })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      map.off('click', onMapClick)
      map.getCanvas().removeEventListener('pointermove', onFlagHoverPointerMove)
      map.getCanvas().removeEventListener('pointerleave', onFlagHoverPointerLeave)
      map.off('move', scheduleFlagHoverUpdate)
      if (hoverRaf) cancelAnimationFrame(hoverRaf)
      if (revealHoldTimeout !== null) clearTimeout(revealHoldTimeout)
      if (endingHoldTimeout !== null) clearTimeout(endingHoldTimeout)
      if (drawHoldTimeout !== null) clearTimeout(drawHoldTimeout)
      unsub()
      destroyed = true
      map.remove()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
