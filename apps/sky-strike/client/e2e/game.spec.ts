import { test, expect } from '@playwright/test'

test('game loads and runs for 5 seconds without crashing', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })

  await expect(page.getByText('SKY STRIKE')).toBeVisible()

  const state = await page.evaluate(() => (window as any).__gameState)
  expect(state).toBeDefined()
  expect(state.started).toBe(false)

  await page.getByRole('button', { name: 'Start' }).click()

  const startedState = await page.evaluate(() => (window as any).__gameState)
  expect(startedState.started).toBe(true)

  await page.waitForTimeout(5000)

  await expect(canvas).toBeVisible()
  await expect(page.getByText('SCORE')).toBeVisible()

  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForTimeout(500)
  expect(errors).toHaveLength(0)
})
