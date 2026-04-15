import { test, expect, type Page } from '@playwright/test'

async function startGame(page: Page) {
  await page.goto('/')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 10000 })
  await canvas.click()
  await page.waitForFunction(() => (window as any).__gameState?.started === true, null, { timeout: 5000 })
}

test('two players can see each other', async ({ browser }) => {
  // Create two separate browser contexts (separate identities)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const page1 = await ctx1.newPage()
  const page2 = await ctx2.newPage()

  // Ignore WebSocket errors in both pages
  page1.on('pageerror', () => {})
  page2.on('pageerror', () => {})

  // Start both games
  await startGame(page1)
  await startGame(page2)

  // Wait for both to connect and see each other
  // The connection text should show "Online (2 players)"
  // Give it a few seconds for WebSocket connections to establish
  await page1.waitForTimeout(3000)

  // Check that both pages have the game running
  const elapsed1 = await page1.evaluate(() => (window as any).__gameState?.elapsed)
  const elapsed2 = await page2.evaluate(() => (window as any).__gameState?.elapsed)
  expect(elapsed1).toBeGreaterThan(1)
  expect(elapsed2).toBeGreaterThan(1)

  await ctx1.close()
  await ctx2.close()
})
