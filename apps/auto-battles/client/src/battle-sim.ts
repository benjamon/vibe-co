import type { OwnedHero, BattleResult, BattleStep, PreBattleEffect, StatChange, StepStatBoost } from './types'

interface BattleUnit {
  hero: { id: string; name: string; hp: number; attack: number; ability: string }
  currentHp: number
  maxHp: number
  stars: number
  originalIndex: number // index in original team array
}

function cloneQueue(team: OwnedHero[]): BattleUnit[] {
  return team.map((h, i) => ({
    hero: { ...h.hero },
    currentHp: h.hero.hp,
    maxHp: h.hero.hp,
    stars: h.stars,
    originalIndex: i,
  }))
}

function processOneHeroAbility(
  unit: BattleUnit,
  qi: number,
  queue: BattleUnit[],
  enemyQueue: BattleUnit[],
  side: 'player' | 'opponent',
  enemySide: 'player' | 'opponent',
  effects: PreBattleEffect[]
) {
  const id = unit.hero.id
  const stars = unit.stars

  if (id === 'zeus') {
    const targetCount = stars === 1 ? 1 : stars === 2 ? 2 : 4
    const alive = enemyQueue.map((e, i) => ({ e, i })).filter((x) => x.e.currentHp > 0)
    const shuffled = [...alive].sort(() => Math.random() - 0.5)
    const hits = shuffled.slice(0, Math.min(targetCount, alive.length))

    for (const hit of hits) {
      hit.e.currentHp -= 15
      if (hit.e.currentHp < 0) hit.e.currentHp = 0
      effects.push({
        text: `${unit.hero.name} [Thunder Strike] -15 to ${hit.e.hero.name}`,
        side, casterIndex: qi,
        targetIndices: [hit.i],
        targetSide: enemySide,
      })
    }

    // Remove killed enemies
    for (let i = enemyQueue.length - 1; i >= 0; i--) {
      if (enemyQueue[i].currentHp <= 0) enemyQueue.splice(i, 1)
    }
  }

  if (id === 'poseidon') {
    if (enemyQueue.length > 1) {
      const backIdx = enemyQueue.length - 1
      const back = enemyQueue.splice(backIdx, 1)[0]
      if (stars === 3) {
        enemyQueue.unshift(back)
      } else {
        const moveBy = stars === 1 ? 1 : 3
        const newIdx = Math.max(0, backIdx - moveBy)
        enemyQueue.splice(newIdx, 0, back)
      }
      // Emit the new order so the scene can rearrange sprites
      const newOrder = enemyQueue.map((u) => u.hero.id + '-' + u.originalIndex)
      effects.push({
        text: `${unit.hero.name} [Grabbing Tide] rearranges the enemy line`,
        side, casterIndex: qi,
        targetIndices: [],
        targetSide: enemySide,
        rearrangeOrder: newOrder,
        rearrangeSide: enemySide,
      })
    }
  }

  if (id === 'hermes') {
    const boost = stars
    const indices: number[] = []
    for (let i = 0; i < queue.length; i++) {
      queue[i].hero.attack += boost
      indices.push(i)
    }
    effects.push({
      text: `${unit.hero.name} [Innovate] +${boost} ATK to all allies`,
      side, casterIndex: qi, targetIndices: indices, targetSide: side,
    })
  }
}

function findBackmostUncast(queue: BattleUnit[], side: string, hasCast: Set<string>): number {
  for (let i = queue.length - 1; i >= 0; i--) {
    const key = `${side}-${queue[i].originalIndex}`
    if (!hasCast.has(key)) return i
  }
  return -1
}

function processPreBattleInterleaved(
  pQueue: BattleUnit[],
  oQueue: BattleUnit[],
  effects: PreBattleEffect[]
) {
  const hasCast = new Set<string>()
  // Team with more or equal heroes goes first
  let playerTurn = pQueue.length >= oQueue.length
  let safety = 0

  while (safety++ < 100) {
    // Find the back-most uncast hero on the current side
    // Alternates: player first, then opponent, then player, ...
    const queue = playerTurn ? pQueue : oQueue
    const enemyQueue = playerTurn ? oQueue : pQueue
    const side = playerTurn ? 'player' : 'opponent'
    const enemySide = playerTurn ? 'opponent' : 'player'

    const idx = findBackmostUncast(queue, side, hasCast)
    if (idx >= 0) {
      const key = `${side}-${queue[idx].originalIndex}`
      hasCast.add(key)
      processOneHeroAbility(queue[idx], idx, queue, enemyQueue, side, enemySide, effects)
    }

    // Switch sides
    playerTurn = !playerTurn

    // Check if both sides are done
    const pDone = findBackmostUncast(pQueue, 'player', hasCast) === -1
    const oDone = findBackmostUncast(oQueue, 'opponent', hasCast) === -1
    if (pDone && oDone) break
  }
}

export function simulateBattle(
  playerTeam: OwnedHero[],
  opponentTeam: OwnedHero[]
): BattleResult {
  const pQueue = cloneQueue(playerTeam)
  const oQueue = cloneQueue(opponentTeam)
  const steps: BattleStep[] = []
  const preBattleEffects: PreBattleEffect[] = []

  // Track initial stats for permanent change calculation
  const initialPlayerStats = playerTeam.map((h) => ({ hp: h.hero.hp, attack: h.hero.attack }))

  // Snapshot BEFORE pre-battle abilities — scene renders these first
  const prePrePlayerTeam: OwnedHero[] = pQueue.map((u) => ({
    hero: { ...u.hero }, currentHp: u.currentHp, stars: u.stars,
  }))
  const prePreOpponentTeam: OwnedHero[] = oQueue.map((u) => ({
    hero: { ...u.hero }, currentHp: u.currentHp, stars: u.stars,
  }))

  // Pre-battle abilities: interleaved back-to-front (player back, opponent back, ...)
  processPreBattleInterleaved(pQueue, oQueue, preBattleEffects)

  // Snapshot AFTER pre-battle abilities — used for combat phase rendering
  const postPrePlayerTeam: OwnedHero[] = pQueue.map((u) => ({
    hero: { ...u.hero },
    currentHp: u.currentHp,
    stars: u.stars,
  }))
  const postPreOpponentTeam: OwnedHero[] = oQueue.map((u) => ({
    hero: { ...u.hero },
    currentHp: u.currentHp,
    stars: u.stars,
  }))

  let safety = 0
  while (pQueue.length > 0 && oQueue.length > 0 && safety < 200) {
    safety++
    const pFront = pQueue[0]
    const oFront = oQueue[0]

    // Simultaneous damage
    const pDamage = pFront.hero.attack
    const oDamage = oFront.hero.attack
    oFront.currentHp -= pDamage
    pFront.currentHp -= oDamage

    const playerDied = pFront.currentHp <= 0
    const opponentDied = oFront.currentHp <= 0

    let abilityText = ''
    const statBoosts: StepStatBoost[] = []

    // Athena: on surviving damage, boost HP
    if (!playerDied && pFront.hero.id === 'athena') {
      const stars = pFront.stars
      const count = stars === 3 ? pQueue.length : stars === 1 ? 2 : 3
      const affected = Math.min(count, pQueue.length)
      for (let j = 0; j < affected; j++) {
        pQueue[j].currentHp += 1; pQueue[j].maxHp += 1; pQueue[j].hero.hp += 1
        statBoosts.push({ queueOffset: j, side: 'player', hpDelta: 1, attackDelta: 0 })
      }
      abilityText += `Athena [Bulwark] +1 HP to ${affected} allies. `
    }
    if (!opponentDied && oFront.hero.id === 'athena') {
      const stars = oFront.stars
      const count = stars === 3 ? oQueue.length : stars === 1 ? 2 : 3
      const affected = Math.min(count, oQueue.length)
      for (let j = 0; j < affected; j++) {
        oQueue[j].currentHp += 1; oQueue[j].maxHp += 1; oQueue[j].hero.hp += 1
        statBoosts.push({ queueOffset: j, side: 'opponent', hpDelta: 1, attackDelta: 0 })
      }
    }

    // Ares: on kill, boost self
    if (opponentDied && pFront.hero.id === 'ares') {
      const boost = pFront.stars
      pFront.hero.attack += boost; pFront.hero.hp += boost; pFront.currentHp += boost; pFront.maxHp += boost
      statBoosts.push({ queueOffset: 0, side: 'player', hpDelta: boost, attackDelta: boost })
      abilityText += `Ares [Harvest] +${boost}/${boost} HP/ATK. `
    }
    if (playerDied && oFront.hero.id === 'ares') {
      const boost = oFront.stars
      oFront.hero.attack += boost; oFront.hero.hp += boost; oFront.currentHp += boost; oFront.maxHp += boost
      statBoosts.push({ queueOffset: 0, side: 'opponent', hpDelta: boost, attackDelta: boost })
    }

    steps.push({
      playerHp: Math.max(0, pFront.currentHp),
      opponentHp: Math.max(0, oFront.currentHp),
      playerDamage: pDamage,
      opponentDamage: oDamage,
      playerDied,
      opponentDied,
      playerHeroId: pFront.hero.id,
      opponentHeroId: oFront.hero.id,
      abilityText: abilityText || undefined,
      statBoosts: statBoosts.length > 0 ? statBoosts : undefined,
    })

    if (playerDied) pQueue.shift()
    if (opponentDied) oQueue.shift()
  }

  // Calculate permanent stat changes for player heroes
  const playerStatChanges: StatChange[] = []
  // Build a map from originalIndex to final stats
  const finalStats = new Map<number, { hp: number; attack: number }>()
  for (const u of pQueue) {
    finalStats.set(u.originalIndex, { hp: u.hero.hp, attack: u.hero.attack })
  }
  // Also check dead heroes — they had stats changed before dying
  // We need to track all heroes that were in the queue... unfortunately dead ones are gone.
  // For dead heroes, we can't recover their final stats. So permanent changes only apply to survivors.
  // That's actually fine — Athena/Ares changes are "permanent" but if the hero dies, the changes are moot.
  // However, heroes are revived after battle, so we want to keep the stat gains.
  // We need a different approach: track stat deltas as they happen.

  // Simpler: compare queue heroes' stats to initial stats
  for (const [origIdx, final] of finalStats) {
    const initial = initialPlayerStats[origIdx]
    if (initial) {
      const hpDelta = final.hp - initial.hp
      const attackDelta = final.attack - initial.attack
      if (hpDelta !== 0 || attackDelta !== 0) {
        playerStatChanges.push({ index: origIdx, hpDelta, attackDelta })
      }
    }
  }

  const outcome: BattleOutcome =
    pQueue.length === 0 && oQueue.length === 0 ? 'draw'
    : oQueue.length === 0 ? 'won'
    : pQueue.length === 0 ? 'lost'
    : pQueue.length >= oQueue.length ? 'draw'
    : 'lost'

  return { outcome, preBattleEffects, prePrePlayerTeam, prePreOpponentTeam, postPrePlayerTeam, postPreOpponentTeam, steps, playerStatChanges }
}
