import type { Map as MaplibreMap } from 'maplibre-gl'

// All free, keyless, OSM-derived vector styles served by OpenFreeMap
// (https://openfreemap.org/quick_start/) against the same underlying tiles.
export const STYLES: Record<string, string> = {
  Liberty: 'https://tiles.openfreemap.org/styles/liberty',
  Bright: 'https://tiles.openfreemap.org/styles/bright',
  Light: 'https://tiles.openfreemap.org/styles/positron',
  Dark: 'https://tiles.openfreemap.org/styles/dark',
  Fiord: 'https://tiles.openfreemap.org/styles/fiord',
}

export const DEFAULT_STYLE_LABEL = 'Liberty'

// Call once at startup; independent of style load state since it only wires
// up listeners. The layer-toggle menu (see layerMenu.ts) is built against
// Liberty's layer IDs specifically — other styles use different layer
// naming for the same features, so those toggles are effectively inert
// unless Liberty is the active style.
export function initStyleSwitcher(map: MaplibreMap) {
  const panel = document.getElementById('menu-panel')!

  panel.appendChild(document.createElement('hr'))

  const heading = document.createElement('div')
  heading.textContent = 'Style'
  heading.className = 'menu-section-heading'
  panel.appendChild(heading)

  for (const [label, url] of Object.entries(STYLES)) {
    const row = document.createElement('label')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'map-style'
    radio.checked = label === DEFAULT_STYLE_LABEL
    radio.addEventListener('change', () => {
      if (radio.checked) map.setStyle(url)
    })
    row.appendChild(radio)
    row.appendChild(document.createTextNode(label))
    panel.appendChild(row)
  }
}
