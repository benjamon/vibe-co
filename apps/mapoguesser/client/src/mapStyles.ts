import type { StyleSpecification } from 'maplibre-gl'
import type { MapStyleChoice } from './store'

// OpenFreeMap: free, keyless vector tiles built from OpenStreetMap data.
// https://openfreemap.org — Liberty is its general-purpose style. Matches the
// stack spiked in apps/osm_globe.
const OSM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Esri World Imagery: free, keyless satellite raster, up to ~z19 — the same
// source the old Cesium build used. No labels or boundary lines come with it
// (see the entry-borders overlay below, which supplies borders when this
// style is active).
const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
// MapLibre's tile-substitution (showing a coarser/finer tile while the exact
// one loads) only searches the *currently in-view* tile set, not tiles that
// scrolled out of view earlier — so panning/zooming to anywhere not in the
// last frame or two shows bare black until the fetch completes. The fix is
// the standard one for raster basemaps: a second, coarse copy of the same
// imagery capped at SATELLITE_BASE_MAXZOOM, rendered underneath the detail
// layer. MapLibre auto-upscales a raster source past its `maxzoom`, so this
// covers every zoom level with a blurry-but-present fallback; capped this
// low it's only a few hundred small tiles covering the whole globe, so it
// loads almost immediately and is small enough to never get evicted from
// cache — there's effectively always *something* under the sharp tiles.
const SATELLITE_BASE_MAXZOOM = 5
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'satellite-base': {
      type: 'raster',
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: SATELLITE_BASE_MAXZOOM,
      attribution: 'Tiles © Esri — World Imagery',
    },
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      attribution: 'Tiles © Esri — World Imagery',
    },
  },
  layers: [
    { id: 'satellite-base', type: 'raster', source: 'satellite-base' },
    { id: 'satellite', type: 'raster', source: 'satellite' },
  ],
}

// User-provided custom style ("Toner Soft", exported from MapTiler/Maputnik),
// re-pointed at OpenFreeMap's keyless tiles instead of the original
// api.maptiler.com source+glyphs URLs (which need a personal API key). Works
// unmodified because both are the same OpenMapTiles schema — only the host
// changed. It ships with no label/POI/road layers at all (already stripped
// by whoever built it), so unlike Liberty it needs no HIDDEN_LAYER_IDS-style
// suppression list — there's nothing in it that could leak an answer.
const TONER_STYLE: StyleSpecification = {
  version: 8,
  name: 'Toner',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgba(231, 225, 218, 1)' },
    },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wood'],
      paint: {
        'fill-color': 'rgba(218, 218, 218, 0.51)',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 22, 1],
      },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'grass'],
      paint: { 'fill-color': 'rgba(236, 235, 235, 1)', 'fill-opacity': 1 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': 'rgba(30, 29, 28, 1)' },
    },
    {
      // Building footprints don't render below their z13.5-16 stops anyway,
      // and MAX_ZOOM caps this game's globe at 9 — kept for fidelity to the
      // source style but effectively inert; static paint values instead of
      // the zoom-ramped ones since they'll never be visible mid-ramp.
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: { 'fill-color': 'rgba(212, 212, 212, 1)', 'fill-antialias': true },
    },
    {
      id: 'building-top',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-outline-color': 'rgba(181, 180, 179, 1)',
        'fill-color': 'rgba(249, 249, 249, 1)',
      },
    },
    {
      id: 'boundary_state',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      minzoom: 0,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['==', ['get', 'maritime'], 0]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(72, 70, 70, 1)',
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0.5, 10, 3, 23, 12],
        'line-blur': 0.4,
        'line-opacity': 1,
      },
    },
    {
      id: 'boundary_country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(82, 81, 81, 1)',
        'line-width': ['interpolate', ['exponential', 1.1], ['zoom'], 3, 1, 22, 20],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 22, 4],
        'line-opacity': 1,
      },
    },
  ],
}

// User-provided "desert" palette, ported from the legacy Google Maps
// JavaScript API styling-wizard format (featureType/elementType/stylers) —
// an entirely different, incompatible style spec from MapLibre's, and one
// whose stylers (color + relative saturation/lightness/gamma adjustments)
// don't map onto MapLibre's flat paint colors 1:1. Rather than replicate
// that adjustment pipeline, this hand-picks final RGBA values that land in
// the same neighborhood: landscape's #f9ddc5 (lightness -7) as the base
// sand tone, water's #1994bf desaturated/lightened per its stylers as a
// muted teal, and the road color #813033 repurposed as the border accent
// (the source style has no featureType for admin boundaries — this game
// draws those itself). Structured like TONER_STYLE (no boundary_state here
// either — see HIDDEN_LAYER_IDS/showStateBorders for why that'd be dead
// code) and, per the source style's `labels: visibility off`, no label/POI
// layers at all.
const DESERT_STYLE: StyleSpecification = {
  version: 8,
  name: 'Desert',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgba(225, 200, 152, 1)' },
    },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: {
        'fill-color': 'rgba(184, 158, 105, 0.4)',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 22, 1],
      },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: { 'fill-color': 'rgba(240, 217, 180, 1)', 'fill-opacity': 1 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': 'rgba(126, 178, 185, 1)' },
    },
    {
      // Inert at this game's MAX_ZOOM (9) — see TONER_STYLE's building layer.
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: { 'fill-color': 'rgba(204, 186, 148, 1)', 'fill-antialias': true },
    },
    {
      id: 'building-top',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-outline-color': 'rgba(197, 165, 123, 1)',
        'fill-color': 'rgba(240, 219, 189, 1)',
      },
    },
    {
      id: 'boundary_country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(129, 48, 51, 1)',
        'line-width': ['interpolate', ['exponential', 1.1], ['zoom'], 3, 1, 22, 20],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 22, 4],
        'line-opacity': 1,
      },
    },
  ],
}

// A dark/"light lines" companion to TONER_STYLE — same structure and layer
// ids, palette inverted: near-black land/water instead of near-white, and a
// light (rather than dark) boundary color. The one thing that can't just be
// inverted in this style's own JSON is entry-borders-state (the always-on
// US state-line overlay — see showStateBorders) and entry-borders-country
// (satellite's fallback), since both are shared game-drawn layers with a
// single hardcoded color; see STATE_BORDER_COLOR_BY_STYLE for how those stay
// legible against a dark basemap too.
const DARK_STYLE: StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgba(24, 24, 27, 1)' },
    },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: {
        'fill-color': 'rgba(60, 60, 66, 0.6)',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 22, 1],
      },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: { 'fill-color': 'rgba(32, 32, 35, 1)', 'fill-opacity': 1 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': 'rgba(10, 11, 15, 1)' },
    },
    {
      // Inert at this game's MAX_ZOOM (9) — see TONER_STYLE's building layer.
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: { 'fill-color': 'rgba(46, 46, 50, 1)', 'fill-antialias': true },
    },
    {
      id: 'building-top',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-outline-color': 'rgba(58, 58, 63, 1)',
        'fill-color': 'rgba(38, 38, 41, 1)',
      },
    },
    {
      id: 'boundary_country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(225, 225, 230, 1)',
        'line-width': ['interpolate', ['exponential', 1.1], ['zoom'], 3, 1, 22, 20],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 22, 4],
        'line-opacity': 1,
      },
    },
  ],
}

// entry-borders-{country,state} (see addGameSourcesAndLayers) are shared,
// game-drawn overlays reused across every basemap, so their line-color can't
// just live in one style's own JSON — a style-specific one is only needed
// for entries that'd otherwise be illegible (dark's near-black land under
// the default black line). Every other style keeps the original black.
export const STATE_BORDER_COLOR_BY_STYLE: Partial<Record<MapStyleChoice, string>> = {
  dark: 'rgba(225, 225, 230, 1)',
}

export const styleFor = (choice: MapStyleChoice): string | StyleSpecification => {
  if (choice === 'satellite') return SATELLITE_STYLE
  if (choice === 'toner') return TONER_STYLE
  if (choice === 'desert') return DESERT_STYLE
  if (choice === 'dark') return DARK_STYLE
  // Same base look as desert — the colorful per-region fill mosaic (see
  // addGameSourcesAndLayers/renderColorfulFill) is a game-drawn overlay on
  // top, not a different vector style. A distinct object (not just
  // DESERT_STYLE reused as-is) so map.setStyle() sees a genuine change and
  // always re-fires 'style.load' when switching directly between the two —
  // passing the exact same object reference back risks MapLibre's style
  // diffing treating it as a no-op and skipping the reload that
  // addGameSourcesAndLayers relies on to re-toggle the fill's visibility.
  if (choice === 'colorful') return { ...DESERT_STYLE, name: 'Colorful' }
  return OSM_STYLE_URL
}

// Every Liberty label/POI/road-shield/highway-name layer id, plus the road
// network itself (irrelevant clutter for a globe quiz) — hidden permanently
// so no country/state/city name ever leaks onto the map ahead of a guess.
// IDs pulled from apps/osm_globe/client/src/layerMenu.ts's hand-categorized
// LAYER_GROUPS.Text + LAYER_GROUPS.Roads.
export const HIDDEN_LAYER_IDS = [
  // Shaded-relief/albedo backdrop (Natural Earth II raster) — a low-res
  // terrain tint under everything else; not useful gameplay signal and
  // muddies the flat-color look we want.
  'natural_earth',
  // Worldwide state/province boundary lines (Liberty's boundary_3, Toner's
  // boundary_state) — permanently hidden in favor of our own US-only
  // entry-borders-state overlay; see showStateBorders for why.
  'boundary_3',
  'boundary_state',
  // Text: labels, POIs, road shields, highway names, one-way arrows.
  'road_one_way_arrow',
  'road_one_way_arrow_opposite',
  'waterway_line_label',
  'water_name_point_label',
  'water_name_line_label',
  'poi_r20',
  'poi_r7',
  'poi_r1',
  'poi_transit',
  'highway-name-path',
  'highway-name-minor',
  'highway-name-major',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
  'airport',
  'label_other',
  'label_village',
  'label_town',
  'label_state',
  'label_city',
  'label_city_capital',
  'label_country_3',
  'label_country_2',
  'label_country_1',
  // Roads: the whole street/rail network, on top of and under water/bridges.
  'aeroway_runway',
  'aeroway_taxiway',
  'tunnel_motorway_link_casing',
  'tunnel_service_track_casing',
  'tunnel_link_casing',
  'tunnel_street_casing',
  'tunnel_secondary_tertiary_casing',
  'tunnel_trunk_primary_casing',
  'tunnel_motorway_casing',
  'tunnel_path_pedestrian',
  'tunnel_motorway_link',
  'tunnel_service_track',
  'tunnel_link',
  'tunnel_minor',
  'tunnel_secondary_tertiary',
  'tunnel_trunk_primary',
  'tunnel_motorway',
  'tunnel_major_rail',
  'tunnel_major_rail_hatching',
  'tunnel_transit_rail',
  'tunnel_transit_rail_hatching',
  'road_motorway_link_casing',
  'road_service_track_casing',
  'road_link_casing',
  'road_minor_casing',
  'road_secondary_tertiary_casing',
  'road_trunk_primary_casing',
  'road_motorway_casing',
  'road_path_pedestrian',
  'road_motorway_link',
  'road_service_track',
  'road_link',
  'road_minor',
  'road_secondary_tertiary',
  'road_trunk_primary',
  'road_motorway',
  'road_major_rail',
  'road_major_rail_hatching',
  'road_transit_rail',
  'road_transit_rail_hatching',
  'bridge_motorway_link_casing',
  'bridge_service_track_casing',
  'bridge_link_casing',
  'bridge_street_casing',
  'bridge_path_pedestrian_casing',
  'bridge_secondary_tertiary_casing',
  'bridge_trunk_primary_casing',
  'bridge_motorway_casing',
  'bridge_path_pedestrian',
  'bridge_motorway_link',
  'bridge_service_track',
  'bridge_link',
  'bridge_street',
  'bridge_secondary_tertiary',
  'bridge_trunk_primary',
  'bridge_motorway',
  'bridge_major_rail',
  'bridge_major_rail_hatching',
  'bridge_transit_rail',
  'bridge_transit_rail_hatching',
]

// Each vector style's own admin-boundary layer ids, reused as-is instead of
// fetching/rendering our own borders dataset — keyed by MapStyleChoice since
// every style names/splits these differently (Liberty and Toner don't even
// agree on how many layers a "country border" is). Toggled show/hide by mode
// (see the store-subscription block) rather than loaded/unloaded. Styles with
// no entry here (satellite) have no native boundaries at all and fall back
// to the entry-borders GeoJSON overlay instead — see showCountryBorders.
export const COUNTRY_LINE_LAYERS_BY_STYLE: Partial<Record<MapStyleChoice, string[]>> = {
  // admin_level 2, plus disputed borders and the coastline stroke Liberty
  // draws as a separate layer from the water fill.
  osm: ['boundary_2', 'boundary_disputed', 'coastline_stroke'],
  toner: ['boundary_country'],
  desert: ['boundary_country'],
  dark: ['boundary_country'],
  colorful: ['boundary_country'],
}
// State lines have no per-style equivalent — see showStateBorders for why
// (Liberty's boundary_3 and Toner's boundary_state are both worldwide,
// admin_level 3-6/4, with no country code to filter on) — every style
// always uses the entry-borders-state overlay instead.
