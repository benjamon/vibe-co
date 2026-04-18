export interface Hero {
  id: string
  name: string
  hp: number
  attack: number
  cost: number
  sprite: string
  ability: string
}

export interface OwnedHero {
  hero: Hero
  currentHp: number
  stars: number // 1, 2, or 3
}

export interface StepStatBoost {
  /** Queue index relative to current front (0 = front) */
  queueOffset: number
  side: 'player' | 'opponent'
  hpDelta: number
  attackDelta: number
}

export interface BattleStep {
  playerHp: number
  opponentHp: number
  playerDamage: number
  opponentDamage: number
  playerDied: boolean
  opponentDied: boolean
  playerHeroId: string
  opponentHeroId: string
  abilityText?: string
  statBoosts?: StepStatBoost[]
}

export interface PreBattleEffect {
  text: string
  /** Which side the caster is on */
  side: 'player' | 'opponent'
  /** Queue index of the caster (for indicator dot) */
  casterIndex: number
  /** Queue indices on the TARGET side that were hit (for target circle animations) */
  targetIndices?: number[]
  /** Which side the targets are on */
  targetSide?: 'player' | 'opponent'
  /** If set, the scene should rearrange the target side's sprites to match this id order */
  rearrangeOrder?: string[]
  rearrangeSide?: 'player' | 'opponent'
}

export interface StatChange {
  index: number
  hpDelta: number
  attackDelta: number
}

export type BattleOutcome = 'won' | 'lost' | 'draw'

export interface BattleResult {
  outcome: BattleOutcome
  preBattleEffects: PreBattleEffect[]
  /** Teams BEFORE pre-battle abilities — render these during ability phase */
  prePrePlayerTeam: OwnedHero[]
  prePreOpponentTeam: OwnedHero[]
  /** Teams AFTER pre-battle abilities — render these during combat phase */
  postPrePlayerTeam: OwnedHero[]
  postPreOpponentTeam: OwnedHero[]
  steps: BattleStep[]
  playerStatChanges: StatChange[]
}

export const MAX_BENCH = 2
export const SELL_GOLD = 1
