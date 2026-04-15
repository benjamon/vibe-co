import { test, expect } from '@playwright/test'

test('game loads and runs for 5 seconds without crashing', async ({ page }) => {
  // Navigate to the game
  await page.goto('/')

  // Verify the canvas renders
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })

  // Verify the start screen is shown
  await expect(page.getByText('Click to Start')).toBeVisible()

  // Check game state is exposed
  const state = await page.evaluate(() => (window as any).__gameState)
  expect(state).toBeDefined()
  expect(state.started).toBe(false)

  // Click to start the game
  await page.getByText('Click to Start').click()

  // Verify game started
  const startedState = await page.evaluate(() => (window as any).__gameState)
  expect(startedState.started).toBe(true)

  // Wait 5 seconds — game should not crash
  await page.waitForTimeout(5000)

  // Verify page is still alive (no crash, no blank screen)
  await expect(canvas).toBeVisible()

  // Verify the HUD is showing
  await expect(page.getByText('Game Running')).toBeVisible()

  // Verify no console errors
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForTimeout(500)
  expect(errors).toHaveLength(0)
})
