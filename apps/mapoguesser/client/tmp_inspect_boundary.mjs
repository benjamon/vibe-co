import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173/')
await page.waitForTimeout(3000)

await page.getByText('⚙️ Settings', { exact: true }).click()
await page.waitForTimeout(500)
await page.getByLabel('Previous map style').click() // satellite -> osm
await page.waitForTimeout(1500)

const result = await page.evaluate(async () => {
  const map = window.__mapInstance
  if (!map) return { error: 'no map instance' }
  for (const id of ['boundary_3', 'boundary_state']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
  }
  map.jumpTo({ center: [-98, 39], zoom: 4 })
  await new Promise((r) => setTimeout(r, 1500))
  const feats3 = map.getLayer('boundary_3')
    ? map.queryRenderedFeatures(undefined, { layers: ['boundary_3'] }).slice(0, 8)
    : []
  return {
    boundary_3: feats3.map((f) => f.properties),
  }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
