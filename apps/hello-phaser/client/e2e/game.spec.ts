import { test, expect } from '@playwright/test'

test('game loads and runs for 5 seconds without crashing', async ({ page }) => {
  // Navigate to the game
  await page.goto('/')

  // Wait for Phaser canvas to appear
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })

  // Check game state is exposed
  const state = await page.evaluate(() => (window as any).__gameState)
  expect(state).toBeDefined()
  expect(state.started).toBe(false)

  // Click to start the game
  await canvas.click()

  // Verify game started
  await page.waitForFunction(() => (window as any).__gameState?.started === true, null, { timeout: 5000 })

  // Wait 5 seconds — game should not crash
  await page.waitForTimeout(5000)

  // Verify page is still alive (no crash, no blank screen)
  await expect(canvas).toBeVisible()

  // Verify game has been ticking
  const elapsed = await page.evaluate(() => (window as any).__gameState?.elapsed)
  expect(elapsed).toBeGreaterThan(3)

  // Verify coin tracking is set up
  const totalCoins = await page.evaluate(() => (window as any).__gameState?.totalCoins)
  expect(totalCoins).toBeGreaterThan(0)

  // Verify no console errors
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForTimeout(500)
  expect(errors).toHaveLength(0)
})
