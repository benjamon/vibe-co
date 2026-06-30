import { chromium } from '@playwright/test'

const URL = 'http://localhost:5173/'
const log = (...a) => console.log('[test]', ...a)

const waitCountries = (page) =>
  page.waitForFunction(() => window.__gameState?.countries?.length > 0, null, {
    timeout: 30000,
  })

const browser = await chromium.launch()
try {
  // Two isolated contexts = two distinct players (separate session+localStorage).
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  // Point both clients at the local SpacetimeDB to avoid maincloud throttling.
  const pointLocal = (ctx) =>
    ctx.addInitScript(() => {
      localStorage.setItem('mapoguesser:spacetimeUri', 'ws://127.0.0.1:3000')
      localStorage.setItem('mapoguesser:spacetimeDb', 'mapoguesser-stats')
    })
  await pointLocal(ctxA)
  await pointLocal(ctxB)
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  a.on('console', (m) => m.type() === 'error' && console.log('[A err]', m.text()))
  b.on('console', (m) => m.type() === 'error' && console.log('[B err]', m.text()))

  log('loading both clients…')
  await a.goto(URL)
  await b.goto(URL)
  await waitCountries(a)
  await waitCountries(b)
  log('countries loaded on both')

  // --- A creates a party ---
  await a.getByRole('button', { name: /Play With Friends/ }).click()
  await a.getByPlaceholder(/Name/).fill('Alice')
  await a.getByRole('button', { name: /Create Party/ }).click()
  // Read the room code off the lobby header.
  await a.waitForFunction(() => window.__party?.room?.code, null, { timeout: 20000 })
  const code = await a.evaluate(() => window.__party.room.code)
  log('A created room code =', code)
  if (!code || code.length !== 4) throw new Error('no room code shown')

  // --- B joins with the code ---
  await b.getByRole('button', { name: /Play With Friends/ }).click()
  await b.getByPlaceholder(/Name/).fill('Bob')
  await b.getByPlaceholder(/––––|----/).fill(code)
  // Join button enables once the code is confirmed to exist.
  const joinBtn = b.getByRole('button', { name: /Join Party/ })
  await joinBtn.waitFor()
  await b.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll('button')].find((x) =>
        /Join Party/.test(x.textContent || ''),
      )
      return btn && !btn.disabled
    },
    null,
    { timeout: 15000 },
  )
  log('B: Join Party enabled (code exists ✓)')
  await joinBtn.click()

  // --- both should now see 2 players in the lobby ---
  for (const [name, p] of [['A', a], ['B', b]]) {
    await p.waitForFunction(
      () => document.body.innerText.includes('Alice') && document.body.innerText.includes('Bob'),
      null,
      { timeout: 15000 },
    )
    log(`${name}: sees both players in lobby`)
  }

  // --- ready up both ---
  for (const [name, p] of [['A', a], ['B', b]]) {
    const r = p.getByRole('button', { name: /Ready Up/ })
    await r.waitFor()
    await p.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find((x) =>
          /Ready Up/.test(x.textContent || ''),
        )
        return btn && !btn.disabled
      },
      null,
      { timeout: 15000 },
    )
    await r.click()
    log(`${name}: readied up`)
  }

  // --- match should start: store.phase playing, multiplayer true, a target served ---
  for (const [name, p] of [['A', a], ['B', b]]) {
    await p.waitForFunction(
      () =>
        window.__gameState?.multiplayer === true &&
        window.__gameState?.phase === 'playing' &&
        !!window.__gameState?.target,
      null,
      { timeout: 20000 },
    )
    const t = await p.evaluate(() => window.__gameState.target)
    log(`${name}: match started, target = ${t}`)
  }

  // Both clients should be drawing the SAME target (deterministic seed).
  const tA = await a.evaluate(() => window.__gameState.target)
  const tB = await b.evaluate(() => window.__gameState.target)
  if (tA !== tB) throw new Error(`targets differ: A=${tA} B=${tB}`)
  log('both clients agree on target ✓:', tA)

  // --- simulate a correct guess from A by calling the store directly ---
  await a.evaluate(() => {
    const t = window.__gameState.target
    window.__gameState.handleGlobeClick(t, 10, 10)
  })
  log('A: submitted a correct guess')
  // B should receive a toast for Alice within ~3s, and A's score should be 1.
  await b.waitForFunction(
    () => document.body.innerText.includes('Alice'),
    null,
    { timeout: 6000 },
  )
  await a.waitForFunction(() => window.__gameState.partyAnswered === true, null, {
    timeout: 6000,
  })
  log('A: partyAnswered locked ✓; B saw Alice toast ✓')

  log('SMOKE TEST PASSED ✅')
} catch (e) {
  console.error('SMOKE TEST FAILED ❌', e)
  process.exitCode = 1
} finally {
  await browser.close()
}
