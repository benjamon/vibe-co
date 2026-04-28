import {
  runAbility,
  type RunContext,
  type SimUnit,
} from './abilities'
import type {
  AbilityBlock,
  AbilityTrigger,
  AtomicEvent,
  AttackEvent,
  BattleEventBlock,
  BattleOutcome,
  BattleResult,
  CombatRoundBlock,
  OwnedHero,
  PermanentStatChange,
  StatChangeAtom,
  UnitRef,
} from './types'

// ── Setup ──────────────────────────────────────────────────────────────────

function toSim(team: OwnedHero[]): SimUnit[] {
  return team.map((h, i) => ({
    hero: { ...h.hero },
    currentHp: h.hero.hp,
    maxHp: h.hero.hp,
    attack: h.hero.attack,
    stars: h.stars,
    originalIndex: i,
    abilityBonus: 0,
  }))
}

function makeContext(
  caster: SimUnit,
  side: 'player' | 'opponent',
  alliedQueue: SimUnit[],
  enemyQueue: SimUnit[],
  out: AtomicEvent[],
): RunContext {
  return {
    caster,
    casterIdx: alliedQueue.indexOf(caster),
    side,
    enemySide: side === 'player' ? 'opponent' : 'player',
    alliedQueue,
    enemyQueue,
    out,
  }
}

function castAbility(
  caster: SimUnit,
  side: 'player' | 'opponent',
  alliedQueue: SimUnit[],
  enemyQueue: SimUnit[],
): AbilityBlock | null {
  if (caster.hero.ability.trigger === 'none') return null
  const events: AtomicEvent[] = []
  runAbility(makeContext(caster, side, alliedQueue, enemyQueue, events))
  if (events.length === 0) return null
  return {
    kind: 'abilityBlock',
    caster: { side, originalIndex: caster.originalIndex },
    abilityName: caster.hero.ability.name,
    events,
  }
}

// ── Pre-battle phase: back-to-front, alternating sides ─────────────────────

function runPreBattle(
  pQueue: SimUnit[],
  oQueue: SimUnit[],
  blocks: BattleEventBlock[],
) {
  const hasCast = new Set<string>()
  const isUncast = (side: 'player' | 'opponent', u: SimUnit) =>
    !hasCast.has(`${side}-${u.originalIndex}`)

  const findBackmostUncast = (queue: SimUnit[], side: 'player' | 'opponent'): SimUnit | null => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].currentHp > 0 && isUncast(side, queue[i])) return queue[i]
    }
    return null
  }

  // Larger team goes first; ties to player.
  let playerTurn = pQueue.length >= oQueue.length
  let safety = 0
  while (safety++ < 64) {
    const side = playerTurn ? 'player' : 'opponent'
    const allied = playerTurn ? pQueue : oQueue
    const enemy = playerTurn ? oQueue : pQueue
    const caster = findBackmostUncast(allied, side)

    if (caster && caster.hero.ability.trigger === 'preBattle') {
      hasCast.add(`${side}-${caster.originalIndex}`)
      const block = castAbility(caster, side, allied, enemy)
      if (block) blocks.push(block)
    } else if (caster) {
      // Hero exists but doesn't trigger preBattle — mark it cast so we move on.
      hasCast.add(`${side}-${caster.originalIndex}`)
    }

    playerTurn = !playerTurn
    const pDone = !findBackmostUncast(pQueue, 'player')
    const oDone = !findBackmostUncast(oQueue, 'opponent')
    if (pDone && oDone) break
  }
}

// ── Combat phase: simultaneous front-row exchange + reactions ─────────────

function nextAlive(queue: SimUnit[]): SimUnit | null {
  for (const u of queue) if (u.currentHp > 0) return u
  return null
}

function compactDead(queue: SimUnit[]) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].currentHp <= 0) queue.splice(i, 1)
  }
}

function runCombat(
  pQueue: SimUnit[],
  oQueue: SimUnit[],
  blocks: BattleEventBlock[],
) {
  let safety = 0
  while (pQueue.length > 0 && oQueue.length > 0 && safety++ < 256) {
    const pFront = nextAlive(pQueue)
    const oFront = nextAlive(oQueue)
    if (!pFront || !oFront) break

    const round: CombatRoundBlock = { kind: 'combatRound', attacks: [], reactions: [] }

    // Simultaneous strikes — compute deltas first, then apply.
    const pDamage = pFront.attack
    const oDamage = oFront.attack
    pFront.currentHp = Math.max(0, pFront.currentHp - oDamage)
    oFront.currentHp = Math.max(0, oFront.currentHp - pDamage)
    const pDied = pFront.currentHp === 0
    const oDied = oFront.currentHp === 0

    round.attacks.push(makeAttack(pFront, oFront, pDamage, 'player'))
    round.attacks.push(makeAttack(oFront, pFront, oDamage, 'opponent'))

    // Reactions fire after the simultaneous swing resolves. onSurviveDamage
    // requires the reactor to still be alive; onKill requires the OTHER
    // front to have just died.
    const tryReaction = (
      reactor: SimUnit,
      reactorSide: 'player' | 'opponent',
      reactorAllied: SimUnit[],
      reactorEnemy: SimUnit[],
      reactorDied: boolean,
      enemyDied: boolean,
    ) => {
      const trigger = reactor.hero.ability.trigger
      if (trigger === 'onSurviveDamage' && !reactorDied) {
        const block = castAbility(reactor, reactorSide, reactorAllied, reactorEnemy)
        if (block) round.reactions.push(block)
      } else if (trigger === 'onKill' && enemyDied && !reactorDied) {
        const block = castAbility(reactor, reactorSide, reactorAllied, reactorEnemy)
        if (block) round.reactions.push(block)
      }
    }
    tryReaction(pFront, 'player', pQueue, oQueue, pDied, oDied)
    tryReaction(oFront, 'opponent', oQueue, pQueue, oDied, pDied)

    blocks.push(round)
    compactDead(pQueue)
    compactDead(oQueue)
  }
}

function makeAttack(
  attacker: SimUnit,
  defender: SimUnit,
  damage: number,
  attackerSide: 'player' | 'opponent',
): AttackEvent {
  const defenderSide = attackerSide === 'player' ? 'opponent' : 'player'
  return {
    attacker: { side: attackerSide, originalIndex: attacker.originalIndex },
    defender: { side: defenderSide, originalIndex: defender.originalIndex },
    damage,
    defenderRemainingHp: defender.currentHp,
    defenderDied: defender.currentHp === 0,
  }
}

// ── Permanent stat change extraction ──────────────────────────────────────

function aggregatePermanentChanges(
  blocks: BattleEventBlock[],
  side: 'player' | 'opponent',
): PermanentStatChange[] {
  const acc = new Map<number, PermanentStatChange>()

  const visitAtom = (atom: AtomicEvent) => {
    if (atom.kind !== 'statChange') return
    const sc = atom as StatChangeAtom
    if (!sc.permanent || sc.target.side !== side) return
    const prev = acc.get(sc.target.originalIndex) ??
      { originalIndex: sc.target.originalIndex, hpDelta: 0, attackDelta: 0 }
    prev.hpDelta += sc.hpDelta
    prev.attackDelta += sc.attackDelta
    acc.set(sc.target.originalIndex, prev)
  }

  for (const block of blocks) {
    if (block.kind === 'abilityBlock') {
      for (const a of block.events) visitAtom(a)
    } else if (block.kind === 'combatRound') {
      for (const r of block.reactions) for (const a of r.events) visitAtom(a)
    }
  }
  return Array.from(acc.values())
}

// ── Outcome ───────────────────────────────────────────────────────────────

function determineOutcome(pQueue: SimUnit[], oQueue: SimUnit[]): BattleOutcome {
  if (pQueue.length === 0 && oQueue.length === 0) return 'draw'
  if (pQueue.length === 0) return 'lost'
  if (oQueue.length === 0) return 'won'
  // Both sides have survivors — count as draw (battle hit safety cap).
  return 'draw'
}

// ── Public entry point ────────────────────────────────────────────────────

export function simulateBattle(
  playerTeam: OwnedHero[],
  opponentTeam: OwnedHero[],
): BattleResult {
  const pQueue = toSim(playerTeam)
  const oQueue = toSim(opponentTeam)
  const blocks: BattleEventBlock[] = []

  blocks.push({ kind: 'phase', phase: 'preBattle' })
  runPreBattle(pQueue, oQueue, blocks)
  compactDead(pQueue)
  compactDead(oQueue)

  blocks.push({ kind: 'phase', phase: 'combat' })
  runCombat(pQueue, oQueue, blocks)

  const outcome = determineOutcome(pQueue, oQueue)
  blocks.push({ kind: 'phase', phase: 'end', outcome })

  return {
    outcome,
    initialPlayerTeam: playerTeam.map(cloneOwned),
    initialOpponentTeam: opponentTeam.map(cloneOwned),
    blocks,
    playerStatChanges: aggregatePermanentChanges(blocks, 'player'),
  }
}

function cloneOwned(h: OwnedHero): OwnedHero {
  return { hero: { ...h.hero }, currentHp: h.hero.hp, stars: h.stars }
}

// Type re-export so other modules can import the trigger string directly.
export type { AbilityTrigger, UnitRef }
