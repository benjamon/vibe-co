// ── Hero data ─────────────────────────────────────────────────────────────

export interface Hero {
  id: string
  name: string
  hp: number
  attack: number
  cost: number
  sprite: string
  ability: HeroAbility
}

export interface HeroAbility {
  name: string
  description: string
  trigger: AbilityTrigger
  effects: AbilityEffect[]
}

export type AbilityTrigger = 'preBattle' | 'onSurviveDamage' | 'onKill' | 'none'

export type AbilityEffect =
  | DamageEffect
  | StatBoostEffect
  | RearrangeBackEffect
  | AmplifyAheadEffect

export interface DamageEffect {
  kind: 'damage'
  target: TargetSelector
  amount: ScaledValue
}

export interface StatBoostEffect {
  kind: 'statBoost'
  target: TargetSelector
  hp?: ScaledValue
  attack?: ScaledValue
  /** When true, surviving player units carry the change between rounds. */
  permanent: boolean
}

/**
 * Yank the back-most enemy/ally unit forward by `moveForwardBy` slots.
 * Poseidon-shaped repositioning. We model rearrangement as a single op
 * because composing it from individual swaps would require per-step
 * animations to make sense visually.
 */
export interface RearrangeBackEffect {
  kind: 'rearrangeBack'
  side: 'enemy' | 'ally'
  moveForwardBy: ScaledValue
}

/**
 * Apollo-shaped meta-ability: amplify the ability the unit-ahead-of-caster
 * is about to cast. The bonus is consumed by the first numeric output of
 * that unit's ability and is never persisted.
 */
export interface AmplifyAheadEffect {
  kind: 'amplifyAhead'
  bonus: ScaledValue
}

export interface TargetSelector {
  side: 'enemy' | 'ally' | 'self'
  pick:
    | 'all'
    | 'random'
    | 'front'
    | 'back'
    | 'allBehindCaster'
    | 'allInFrontOfCaster'
  /** Used by 'random'. */
  count?: ScaledValue
}

/** Scalar value or per-star tuple [s1, s2, s3]. */
export type ScaledValue = number | readonly [number, number, number]

// ── Owned hero (player or opponent unit) ───────────────────────────────────

export interface OwnedHero {
  hero: Hero
  currentHp: number
  /** 1, 2, or 3. */
  stars: number
}

// ── Battle event types ─────────────────────────────────────────────────────

/** Stable identifier for a unit across an entire battle. */
export interface UnitRef {
  side: 'player' | 'opponent'
  /** Index into the original team array passed to simulateBattle. */
  originalIndex: number
}

export type BattleEventBlock = PhaseBlock | AbilityBlock | CombatRoundBlock

export interface PhaseBlock {
  kind: 'phase'
  phase: 'preBattle' | 'combat' | 'end'
  outcome?: BattleOutcome
}

export interface AbilityBlock {
  kind: 'abilityBlock'
  caster: UnitRef
  abilityName: string
  events: AtomicEvent[]
}

export interface CombatRoundBlock {
  kind: 'combatRound'
  attacks: AttackEvent[]
  /** Reactive abilities (Athena on survive, Ares on kill, etc.). */
  reactions: AbilityBlock[]
}

export interface AttackEvent {
  attacker: UnitRef
  defender: UnitRef
  damage: number
  defenderRemainingHp: number
  defenderDied: boolean
}

export type AtomicEvent =
  | DamageAtom
  | StatChangeAtom
  | AmplifyAtom
  | RearrangeAtom
  | DeathAtom

export interface DamageAtom {
  kind: 'damage'
  target: UnitRef
  amount: number
  remainingHp: number
  source: UnitRef
}

/**
 * One-shot stat change. Carries the resulting state so the renderer never
 * has to compute it. `permanent` controls whether the change survives the
 * battle (Athena/Ares) or is local to it (Hermes/Hephaestus).
 */
export interface StatChangeAtom {
  kind: 'statChange'
  target: UnitRef
  hpDelta: number
  attackDelta: number
  /** Resulting current HP after the change (handles HP buffs that also heal). */
  remainingHp: number
  newMaxHp: number
  newAttack: number
  permanent: boolean
  source: UnitRef
}

export interface AmplifyAtom {
  kind: 'amplify'
  target: UnitRef
  bonus: number
  source: UnitRef
}

export interface RearrangeAtom {
  kind: 'rearrange'
  side: 'player' | 'opponent'
  /** Front-to-back order of survivors after the rearrange. */
  newOrder: UnitRef[]
  source: UnitRef
}

export interface DeathAtom {
  kind: 'death'
  target: UnitRef
}

// ── Battle result ──────────────────────────────────────────────────────────

export type BattleOutcome = 'won' | 'lost' | 'draw'

export interface PermanentStatChange {
  originalIndex: number
  hpDelta: number
  attackDelta: number
}

export interface BattleResult {
  outcome: BattleOutcome
  initialPlayerTeam: OwnedHero[]
  initialOpponentTeam: OwnedHero[]
  /** Block-structured event stream the renderer consumes. */
  blocks: BattleEventBlock[]
  /** Permanent stat changes on player units only, applied to store after battle. */
  playerStatChanges: PermanentStatChange[]
}

// ── Misc constants ─────────────────────────────────────────────────────────

export const MAX_BENCH = 2
export const SELL_GOLD = 1
