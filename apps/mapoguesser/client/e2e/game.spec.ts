import { test, expect } from '@playwright/test'

test('world viewer loads and spins horizontally', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible({ timeout: 15000 })

  // Game state is exposed for introspection
  const initial = await page.evaluate(() => (window as any).__gameState)
  expect(initial).toBeDefined()
  expect(initial.heading).toBe(0)

  // Wait for Cesium to finish its initial render before driving input
  await page.waitForTimeout(1500)

  // Drag horizontally across the viewport — heading should advance
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const cy = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.3, cy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, cy, { steps: 10 })
  await page.mouse.up()

  await page.waitForTimeout(500)

  const after = await page.evaluate(() => (window as any).__gameState)
  expect(after.heading).not.toBe(0)

  // Run for a bit longer to ensure the viewer doesn't crash
  await page.waitForTimeout(3000)
  await expect(canvas).toBeVisible()
  expect(errors).toEqual([])
})
