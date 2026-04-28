import type {
  AbilityEffect,
  AtomicEvent,
  HeroAbility,
  ScaledValue,
  TargetSelector,
  UnitRef,
} from './types'

// ── Sim-side unit shape ───────────────────────────────────────────────────

export interface SimUnit {
  hero: { id: string; name: string; hp: number; attack: number; ability: HeroAbility }
  /** Live HP (mutable). */
  currentHp: number
  /** Max HP. Mutates with permanent HP buffs. */
  maxHp: number
  /** Current attack (mutates with attack buffs). */
  attack: number
  stars: number
  originalIndex: number
  /**
   * Pending Apollo bonus, consumed at the start of this unit's next ability
   * cast. Applied uniformly to every numeric output of that one cast.
   */
  abilityBonus: number
  /** Whether this unit's reaction trigger has fired this battle (Athena/Ares
   *  re-trigger every combat round, so this is ignored for those). */
  hasUsedReaction?: boolean
}

// ── Scaling and target resolution ─────────────────────────────────────────

export function scaledForStars(value: ScaledValue, stars: number): number {
  if (typeof value === 'number') return value
  const idx = Math.max(0, Math.min(2, stars - 1))
  return value[idx] ?? 0
}

interface RunContext {
  caster: SimUnit
  /** Caster's index in alliedQueue. */
  casterIdx: number
  side: 'player' | 'opponent'
  enemySide: 'player' | 'opponent'
  alliedQueue: SimUnit[]
  enemyQueue: SimUnit[]
  /** Output sink. */
  out: AtomicEvent[]
}

function aliveOf(queue: SimUnit[]): SimUnit[] {
  return queue.filter((u) => u.currentHp > 0)
}

function refOf(unit: SimUnit, side: 'player' | 'opponent'): UnitRef {
  return { side, originalIndex: unit.originalIndex }
}

function selectTargets(selector: TargetSelector, ctx: RunContext): SimUnit[] {
  const { caster, casterIdx, alliedQueue, enemyQueue } = ctx

  if (selector.side === 'self') return [caster]

  const ownPool = selector.side === 'ally' ? alliedQueue : enemyQueue
  const alive = aliveOf(ownPool)
  if (alive.length === 0) return []

  switch (selector.pick) {
    case 'all': {
      const limit = selector.count !== undefined
        ? scaledForStars(selector.count, caster.stars)
        : alive.length
      return alive.slice(0, Math.max(0, limit))
    }
    case 'front':
      return [alive[0]]
    case 'back':
      return [alive[alive.length - 1]]
    case 'random': {
      const limit = selector.count !== undefined
        ? scaledForStars(selector.count, caster.stars)
        : 1
      const shuffled = [...alive].sort(() => Math.random() - 0.5)
      return shuffled.slice(0, Math.max(0, Math.min(limit, alive.length)))
    }
    case 'allBehindCaster':
      if (selector.side !== 'ally') return alive
      return aliveOf(alliedQueue.slice(casterIdx + 1))
    case 'allInFrontOfCaster':
      if (selector.side !== 'ally') return alive
      return aliveOf(alliedQueue.slice(0, casterIdx))
  }
}

function selectorSideToBattleSide(
  selector: TargetSelector,
  ctx: RunContext,
): 'player' | 'opponent' {
  if (selector.side === 'enemy') return ctx.enemySide
  return ctx.side
}

// ── Effect runner ─────────────────────────────────────────────────────────

/**
 * Runs all effects of one ability cast, emitting atomic events into ctx.out.
 * Apollo bonus on the caster (if any) is consumed at the start of this cast
 * and added uniformly to every numeric scaling resolved during the cast.
 *
 * Dead units are compacted out of both queues first so target pickers and
 * rearrangement always see the live formation. The caster's queue index is
 * re-resolved against the compacted allied queue.
 */
export function runAbility(ctx: RunContext) {
  for (let i = ctx.alliedQueue.length - 1; i >= 0; i--) {
    if (ctx.alliedQueue[i].currentHp <= 0) ctx.alliedQueue.splice(i, 1)
  }
  for (let i = ctx.enemyQueue.length - 1; i >= 0; i--) {
    if (ctx.enemyQueue[i].currentHp <= 0) ctx.enemyQueue.splice(i, 1)
  }
  if (ctx.caster.currentHp <= 0) return
  ctx.casterIdx = ctx.alliedQueue.indexOf(ctx.caster)
  if (ctx.casterIdx < 0) return

  const ability = ctx.caster.hero.ability
  if (ability.trigger === 'none') return

  const bonus = ctx.caster.abilityBonus
  ctx.caster.abilityBonus = 0

  for (const effect of ability.effects) {
    runEffect(effect, ctx, bonus)
  }
}

function runEffect(effect: AbilityEffect, ctx: RunContext, bonus: number) {
  switch (effect.kind) {
    case 'damage':
      runDamage(effect, ctx, bonus)
      return
    case 'statBoost':
      runStatBoost(effect, ctx, bonus)
      return
    case 'rearrangeBack':
      runRearrangeBack(effect, ctx, bonus)
      return
    case 'amplifyAhead':
      runAmplifyAhead(effect, ctx, bonus)
      return
  }
}

function runDamage(effect: import('./types').DamageEffect, ctx: RunContext, bonus: number) {
  const targets = selectTargets(effect.target, ctx)
  const amount = scaledForStars(effect.amount, ctx.caster.stars) + bonus
  if (amount <= 0 || targets.length === 0) return
  const targetSide = selectorSideToBattleSide(effect.target, ctx)
  for (const t of targets) {
    t.currentHp = Math.max(0, t.currentHp - amount)
    ctx.out.push({
      kind: 'damage',
      target: refOf(t, targetSide),
      amount,
      remainingHp: t.currentHp,
      source: refOf(ctx.caster, ctx.side),
    })
    if (t.currentHp === 0) {
      ctx.out.push({ kind: 'death', target: refOf(t, targetSide) })
    }
  }
}

function runStatBoost(
  effect: import('./types').StatBoostEffect,
  ctx: RunContext,
  bonus: number,
) {
  const targets = selectTargets(effect.target, ctx)
  if (targets.length === 0) return
  const stars = ctx.caster.stars
  const hpDelta = effect.hp !== undefined ? scaledForStars(effect.hp, stars) + bonus : 0
  const attackDelta = effect.attack !== undefined ? scaledForStars(effect.attack, stars) + bonus : 0
  if (hpDelta === 0 && attackDelta === 0) return
  const targetSide = selectorSideToBattleSide(effect.target, ctx)

  for (const t of targets) {
    if (hpDelta !== 0) {
      t.maxHp += hpDelta
      t.currentHp = Math.max(0, t.currentHp + hpDelta)
      // Heroic stat values shadow current battle stats; only mutate the
      // underlying hero record when the change is permanent so revival
      // after the battle picks up the new max.
      if (effect.permanent) t.hero.hp += hpDelta
    }
    if (attackDelta !== 0) {
      t.attack += attackDelta
      if (effect.permanent) t.hero.attack += attackDelta
    }
    ctx.out.push({
      kind: 'statChange',
      target: refOf(t, targetSide),
      hpDelta,
      attackDelta,
      remainingHp: t.currentHp,
      newMaxHp: t.maxHp,
      newAttack: t.attack,
      permanent: effect.permanent,
      source: refOf(ctx.caster, ctx.side),
    })
  }
}

function runRearrangeBack(
  effect: import('./types').RearrangeBackEffect,
  ctx: RunContext,
  bonus: number,
) {
  const targetQueue = effect.side === 'enemy' ? ctx.enemyQueue : ctx.alliedQueue
  const targetSide = effect.side === 'enemy' ? ctx.enemySide : ctx.side
  if (targetQueue.length < 2) return

  const moveBy = scaledForStars(effect.moveForwardBy, ctx.caster.stars) + bonus
  const backIdx = targetQueue.length - 1
  const newIdx = Math.max(0, backIdx - moveBy)
  if (newIdx === backIdx) return

  const [moved] = targetQueue.splice(backIdx, 1)
  targetQueue.splice(newIdx, 0, moved)

  ctx.out.push({
    kind: 'rearrange',
    side: targetSide,
    newOrder: targetQueue.map((u) => refOf(u, targetSide)),
    source: refOf(ctx.caster, ctx.side),
  })
}

function runAmplifyAhead(
  effect: import('./types').AmplifyAheadEffect,
  ctx: RunContext,
  bonus: number,
) {
  // The "unit ahead" is the one immediately in front of the caster in the
  // queue — the next unit to cast in back-to-front pre-battle order.
  const aheadIdx = ctx.casterIdx - 1
  if (aheadIdx < 0 || aheadIdx >= ctx.alliedQueue.length) return
  const target = ctx.alliedQueue[aheadIdx]
  if (target.currentHp <= 0) return

  const amount = scaledForStars(effect.bonus, ctx.caster.stars) + bonus
  if (amount <= 0) return

  target.abilityBonus += amount
  ctx.out.push({
    kind: 'amplify',
    target: refOf(target, ctx.side),
    bonus: amount,
    source: refOf(ctx.caster, ctx.side),
  })
}

// ── Re-export the run context type for the simulator's consumption ────────

export type { RunContext }
