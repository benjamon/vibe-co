import type { Map as MaplibreMap } from 'maplibre-gl'

// Layer IDs pulled from the OpenFreeMap "liberty" style
// (https://tiles.openfreemap.org/styles/liberty), grouped by what they
// visually represent.
const LAYER_GROUPS: Record<string, string[]> = {
  'Base albedo': [
    'background',
    'park',
    'landuse_residential',
    'landcover_wood',
    'landcover_grass',
    'landcover_ice',
    'landcover_wetland',
    'landuse_pitch',
    'landuse_track',
    'landuse_cemetery',
    'landuse_hospital',
    'landuse_school',
    'water',
    'landcover_sand',
    'aeroway_fill',
    'road_area_pattern',
    'building',
    'building-3d',
  ],
  Hillshading: ['natural_earth'],
  // boundary_3 (admin_level 3-6) is state/province borders worldwide, incl.
  // US state lines — the tileset has no country-code property to isolate
  // US-only borders, so this is every country's first-level subdivisions.
  'Country lines': ['boundary_2', 'boundary_3', 'boundary_disputed'],
  Coasts: ['coastline_stroke'],
  Lakes: ['lake_stroke'],
  // waterway_river is thin OSM-tagged river/stream centerlines;
  // river_polygon_stroke is the edge of wide rivers rendered as polygons.
  Rivers: ['waterway_river', 'river_polygon_stroke'],
  Lines: ['park_outline', 'waterway_tunnel', 'waterway_other'],
  Roads: [
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
  ],
  Text: [
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
  ],
}

function setGroupVisibility(map: MaplibreMap, layerIds: string[], visible: boolean) {
  for (const id of layerIds) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }
}

// Call once the map's style has finished loading, so the layer IDs above
// are guaranteed to exist.
export function initLayerMenu(map: MaplibreMap) {
  const toggleButton = document.getElementById('menu-toggle')!
  const panel = document.getElementById('menu-panel')!

  for (const [label, layerIds] of Object.entries(LAYER_GROUPS)) {
    const row = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.addEventListener('change', () => {
      setGroupVisibility(map, layerIds, checkbox.checked)
    })
    row.appendChild(checkbox)
    row.appendChild(document.createTextNode(label))
    panel.appendChild(row)
  }

  toggleButton.addEventListener('click', () => {
    const open = panel.classList.toggle('open')
    toggleButton.setAttribute('aria-expanded', String(open))
  })

  document.addEventListener('click', (event) => {
    if (
      panel.classList.contains('open') &&
      !panel.contains(event.target as Node) &&
      !toggleButton.contains(event.target as Node)
    ) {
      panel.classList.remove('open')
      toggleButton.setAttribute('aria-expanded', 'false')
    }
  })
}
