import { test, expect } from '@playwright/test'

test('coin flip game loads and flips on tap', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })

  await expect(page.getByText('tap anywhere to flip the coin')).toBeVisible()

  const initial = await page.evaluate(() => (window as any).__gameState)
  expect(initial).toBeDefined()
  expect(initial.flips).toBe(0)
  expect(initial.gold).toBe(0)
  expect(initial.coinsPerTap).toBe(1)
  expect(initial.coins).toHaveLength(1)

  await canvas.click()

  const duringFlip = await page.evaluate(() => (window as any).__gameState)
  expect(duringFlip.coins[0].flipping).toBe(true)

  await page.waitForFunction(
    () => !(window as any).__gameState.coins.some((c: any) => c.flipping),
    null,
    { timeout: 5000 },
  )

  const afterFlip = await page.evaluate(() => (window as any).__gameState)
  expect(afterFlip.flips).toBe(1)
  expect(afterFlip.gold).toBe(1)
  expect(['heads', 'tails']).toContain(afterFlip.coins[0].result)

  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForTimeout(300)
  expect(errors).toHaveLength(0)
})
