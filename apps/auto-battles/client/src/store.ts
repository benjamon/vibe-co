import { createStore } from 'zustand/vanilla'
import type { Hero, OwnedHero, BattleResult } from './types'
import { MAX_BENCH, SELL_GOLD } from './types'
import { HERO_POOL, FIRST_SHOP_GOLD, SHOP_GOLD, REROLL_COST, HERO_COST, SHOP_CHOICES, STARTING_HEARTS, MAX_TEAM_SIZE } from './data'

export type GamePhase = 'menu' | 'shop' | 'battle' | 'gameover'

export interface PendingMerge {
  heroId: string
  fromIndices: number[]
  resultIndex: number
  resultStars: number
}

interface GameState {
  phase: GamePhase
  gold: number
  hearts: number
  round: number
  team: OwnedHero[]
  bench: OwnedHero[]
  shopChoices: Hero[]
  shopFrozen: boolean
  lastBattleResult: BattleResult | null
  won: boolean
  pendingMerge: PendingMerge | null
}

interface GameActions {
  startGame: () => void
  rerollShop: () => void
  buyHeroOnto: (shopIndex: number, targetTeamIndex: number) => void
  buyHeroToBench: (shopIndex: number) => void
  sellHero: (source: 'team' | 'bench', index: number) => void
  moveTeamToBench: (teamIndex: number, benchSlot: number) => void
  moveBenchToTeam: (benchIndex: number) => void
  swapTeamAndBench: (teamIndex: number, benchIndex: number) => void
  clearPendingMerge: () => void
  reorderTeam: (fromIndex: number, toIndex: number) => void
  toggleFreezeShop: () => void
  startBattle: () => void
  finishBattle: (result: BattleResult) => void
  returnToShop: () => void
  reset: () => void
}

function rollShopChoices(): Hero[] {
  const shuffled = [...HERO_POOL].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, SHOP_CHOICES)
}

/** Try to add a 1-star hero to team+bench with merging. Returns true if consumed. */
function aiAddHero(team: OwnedHero[], bench: OwnedHero[], hero: Hero): boolean {
  // Find a 1-star match on team to merge into 2-star
  const teamIdx = team.findIndex((h) => h.hero.id === hero.id && h.stars === 1)
  if (teamIdx !== -1) {
    const t = team[teamIdx]
    const merged: Hero = { ...t.hero, hp: t.hero.hp + hero.hp, attack: t.hero.attack + hero.attack }
    team[teamIdx] = { hero: merged, currentHp: merged.hp, stars: 2 }
    aiCheck3Star(team, bench, hero.id)
    return true
  }
  // Find a 1-star match on bench
  const benchIdx = bench.findIndex((h) => h.hero.id === hero.id && h.stars === 1)
  if (benchIdx !== -1) {
    const t = bench[benchIdx]
    const merged: Hero = { ...t.hero, hp: t.hero.hp + hero.hp, attack: t.hero.attack + hero.attack }
    bench[benchIdx] = { hero: merged, currentHp: merged.hp, stars: 2 }
    aiCheck3Star(team, bench, hero.id)
    return true
  }
  // No merge — add to team if space, else bench
  if (team.length < MAX_TEAM_SIZE) {
    team.push({ hero: { ...hero }, currentHp: hero.hp, stars: 1 })
    return true
  }
  // Bench (unlimited for AI generation purposes)
  bench.push({ hero: { ...hero }, currentHp: hero.hp, stars: 1 })
  return true
}

/** Check if two 2-stars across team+bench can merge into 3-star */
function aiCheck3Star(team: OwnedHero[], bench: OwnedHero[], heroId: string) {
  const all: { arr: OwnedHero[]; idx: number }[] = []
  team.forEach((h, i) => { if (h.hero.id === heroId && h.stars === 2) all.push({ arr: team, idx: i }) })
  bench.forEach((h, i) => { if (h.hero.id === heroId && h.stars === 2) all.push({ arr: bench, idx: i }) })
  if (all.length < 2) return

  const [a, b] = all
  const merged: Hero = { ...a.arr[a.idx].hero, hp: a.arr[a.idx].hero.hp + b.arr[b.idx].hero.hp, attack: a.arr[a.idx].hero.attack + b.arr[b.idx].hero.attack }
  // Remove both (higher index first if same array)
  if (a.arr === b.arr) {
    const [hi, lo] = a.idx > b.idx ? [a.idx, b.idx] : [b.idx, a.idx]
    a.arr.splice(hi, 1); a.arr.splice(lo, 1)
  } else {
    a.arr.splice(a.idx, 1); b.arr.splice(b.idx, 1)
  }
  // Place 3-star on team if space, else bench
  const hero3: OwnedHero = { hero: merged, currentHp: merged.hp, stars: 3 }
  if (team.length < MAX_TEAM_SIZE) team.push(hero3)
  else bench.push(hero3)
}

/** Generate opponent team: round 1 = 2 picks, then +3 per round, with bench for merging. Max 5 on team. */
function generateOpponentTeam(round: number): OwnedHero[] {
  const totalPicks = round === 1 ? 2 : 2 + 3 * (round - 1)
  const team: OwnedHero[] = []
  const bench: OwnedHero[] = []

  for (let p = 0; p < totalPicks; p++) {
    const hero = HERO_POOL[Math.floor(Math.random() * HERO_POOL.length)]
    aiAddHero(team, bench, hero)
  }

  // Move bench heroes to team if there's space (strongest first)
  bench.sort((a, b) => (b.hero.hp + b.hero.attack) - (a.hero.hp + a.hero.attack))
  while (bench.length > 0 && team.length < MAX_TEAM_SIZE) {
    team.push(bench.shift()!)
  }

  return team.slice(0, MAX_TEAM_SIZE)
}

export { generateOpponentTeam }

/** Merge helper that checks both team and bench for 2→3 star auto-upgrade */
function doMerge(
  team: OwnedHero[],
  bench: OwnedHero[],
  targetIdx: number,
  targetSource: 'team' | 'bench',
  hero: Hero
): { team: OwnedHero[]; bench: OwnedHero[]; merge: PendingMerge } {
  let newTeam = [...team]
  let newBench = [...bench]
  const targetArr = targetSource === 'team' ? newTeam : newBench
  const target = targetArr[targetIdx]

  const merged: Hero = {
    ...target.hero,
    hp: target.hero.hp + hero.hp,
    attack: target.hero.attack + hero.attack,
    ability: target.hero.ability,
    sprite: target.hero.sprite,
  }
  targetArr[targetIdx] = { hero: merged, currentHp: merged.hp, stars: (target.stars + 1) as 1 | 2 | 3 }

  let merge: PendingMerge = {
    heroId: hero.id,
    fromIndices: [targetIdx],
    resultIndex: targetIdx,
    resultStars: target.stars + 1,
  }

  // Check for 2→3 star auto-merge across team AND bench
  if (merge.resultStars === 2) {
    const teamTwoStars = newTeam.map((h, i) => ({ h, i, src: 'team' as const })).filter((e) => e.h.hero.id === hero.id && e.h.stars === 2)
    const benchTwoStars = newBench.map((h, i) => ({ h, i, src: 'bench' as const })).filter((e) => e.h.hero.id === hero.id && e.h.stars === 2)
    const allTwoStars = [...teamTwoStars, ...benchTwoStars]

    if (allTwoStars.length >= 2) {
      const [a, b] = allTwoStars
      const merged3: Hero = {
        ...a.h.hero,
        hp: a.h.hero.hp + b.h.hero.hp,
        attack: a.h.hero.attack + b.h.hero.attack,
      }
      const mergedHero: OwnedHero = { hero: merged3, currentHp: merged3.hp, stars: 3 }

      // Remove both from their respective arrays (remove higher index first to avoid shifting)
      if (a.src === b.src) {
        const arr = a.src === 'team' ? newTeam : newBench
        const [hi, lo] = a.i > b.i ? [a.i, b.i] : [b.i, a.i]
        arr.splice(hi, 1)
        arr.splice(lo, 1)
      } else {
        if (a.src === 'team') { newTeam.splice(a.i, 1) } else { newBench.splice(a.i, 1) }
        if (b.src === 'team') { newTeam.splice(b.i, 1) } else { newBench.splice(b.i, 1) }
      }

      // Add merged hero to team
      newTeam.push(mergedHero)
      merge = {
        heroId: hero.id,
        fromIndices: [a.i, b.i],
        resultIndex: newTeam.length - 1,
        resultStars: 3,
      }
    }
  }

  return { team: newTeam, bench: newBench, merge }
}

export const gameStore = createStore<GameState & GameActions>((set, get) => ({
  phase: 'menu',
  gold: FIRST_SHOP_GOLD,
  hearts: STARTING_HEARTS,
  round: 1,
  team: [],
  bench: [],
  shopChoices: [],
  shopFrozen: false,
  lastBattleResult: null,
  won: false,
  pendingMerge: null,

  startGame: () =>
    set({
      phase: 'shop', gold: FIRST_SHOP_GOLD, hearts: STARTING_HEARTS, round: 1,
      team: [], bench: [], shopChoices: rollShopChoices(), shopFrozen: false,
      lastBattleResult: null, won: false, pendingMerge: null,
    }),

  rerollShop: () => {
    const state = get()
    if (state.gold < REROLL_COST) return
    set({ gold: state.gold - REROLL_COST, shopChoices: rollShopChoices(), shopFrozen: false })
  },

  buyHeroOnto: (shopIndex: number, targetTeamIndex: number) => {
    const state = get()
    const hero = state.shopChoices[shopIndex]
    if (!hero || state.gold < HERO_COST) return

    const target = targetTeamIndex >= 0 && targetTeamIndex < state.team.length
      ? state.team[targetTeamIndex] : null

    const newChoices = [...state.shopChoices]
    newChoices.splice(shopIndex, 1)

    if (target && target.hero.id === hero.id && target.stars === 1) {
      const result = doMerge(state.team, state.bench, targetTeamIndex, 'team', hero)
      set({ gold: state.gold - HERO_COST, team: result.team, bench: result.bench, shopChoices: newChoices, pendingMerge: result.merge })
    } else {
      // Auto-merge: check team then bench for 1-star match
      const autoTeamIdx = state.team.findIndex((h) => h.hero.id === hero.id && h.stars === 1)
      const autoBenchIdx = autoTeamIdx === -1 ? state.bench.findIndex((h) => h.hero.id === hero.id && h.stars === 1) : -1

      if (autoTeamIdx !== -1) {
        const result = doMerge(state.team, state.bench, autoTeamIdx, 'team', hero)
        set({ gold: state.gold - HERO_COST, team: result.team, bench: result.bench, shopChoices: newChoices, pendingMerge: result.merge })
      } else if (autoBenchIdx !== -1) {
        const result = doMerge(state.team, state.bench, autoBenchIdx, 'bench', hero)
        set({ gold: state.gold - HERO_COST, team: result.team, bench: result.bench, shopChoices: newChoices })
      } else if (state.team.length < MAX_TEAM_SIZE) {
        const newTeam = [...state.team, { hero: { ...hero }, currentHp: hero.hp, stars: 1 }]
        set({ gold: state.gold - HERO_COST, team: newTeam, shopChoices: newChoices,
          pendingMerge: { heroId: hero.id, fromIndices: [], resultIndex: newTeam.length - 1, resultStars: 1 } })
      }
    }
  },

  buyHeroToBench: (shopIndex: number) => {
    const state = get()
    const hero = state.shopChoices[shopIndex]
    if (!hero || state.gold < HERO_COST || state.bench.length >= MAX_BENCH) return
    const newChoices = [...state.shopChoices]
    newChoices.splice(shopIndex, 1)
    set({ gold: state.gold - HERO_COST, bench: [...state.bench, { hero: { ...hero }, currentHp: hero.hp, stars: 1 }], shopChoices: newChoices })
  },

  sellHero: (source: 'team' | 'bench', index: number) => {
    const state = get()
    if (source === 'team') {
      if (index < 0 || index >= state.team.length) return
      const newTeam = [...state.team]; newTeam.splice(index, 1)
      set({ team: newTeam, gold: state.gold + SELL_GOLD })
    } else {
      if (index < 0 || index >= state.bench.length) return
      const newBench = [...state.bench]; newBench.splice(index, 1)
      set({ bench: newBench, gold: state.gold + SELL_GOLD })
    }
  },

  moveTeamToBench: (teamIndex: number, _benchSlot: number) => {
    const state = get()
    if (teamIndex < 0 || teamIndex >= state.team.length || state.bench.length >= MAX_BENCH) return
    const hero = state.team[teamIndex]
    const newTeam = [...state.team]; newTeam.splice(teamIndex, 1)
    set({ team: newTeam, bench: [...state.bench, hero] })
  },

  moveBenchToTeam: (benchIndex: number) => {
    const state = get()
    if (benchIndex < 0 || benchIndex >= state.bench.length || state.team.length >= MAX_TEAM_SIZE) return
    const hero = state.bench[benchIndex]
    const newBench = [...state.bench]; newBench.splice(benchIndex, 1)
    set({ bench: newBench, team: [...state.team, hero] })
  },

  swapTeamAndBench: (teamIndex: number, benchIndex: number) => {
    const state = get()
    if (teamIndex < 0 || teamIndex >= state.team.length) return
    if (benchIndex < 0 || benchIndex >= state.bench.length) return
    const newTeam = [...state.team]; const newBench = [...state.bench]
    const temp = newTeam[teamIndex]; newTeam[teamIndex] = newBench[benchIndex]; newBench[benchIndex] = temp
    set({ team: newTeam, bench: newBench })
  },

  clearPendingMerge: () => set({ pendingMerge: null }),

  reorderTeam: (fromIndex: number, toIndex: number) => {
    const state = get()
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= state.team.length || toIndex < 0 || toIndex >= state.team.length) return
    const newTeam = [...state.team]; const [moved] = newTeam.splice(fromIndex, 1); newTeam.splice(toIndex, 0, moved)
    set({ team: newTeam })
  },

  toggleFreezeShop: () => set({ shopFrozen: !get().shopFrozen }),

  startBattle: () => { if (get().team.length === 0) return; set({ phase: 'battle' }) },

  finishBattle: (result: BattleResult) => {
    const state = get()
    const newHearts = result.outcome === 'lost' ? state.hearts - 1 : state.hearts
    const newTeam = state.team.map((h, i) => {
      const change = result.playerStatChanges.find((c) => c.index === i)
      if (!change) return h
      const updatedHero: Hero = { ...h.hero, hp: h.hero.hp + change.hpDelta, attack: h.hero.attack + change.attackDelta }
      return { ...h, hero: updatedHero, currentHp: updatedHero.hp }
    })
    if (newHearts <= 0) set({ phase: 'gameover', hearts: 0, lastBattleResult: result, won: false, team: newTeam })
    else set({ lastBattleResult: result, hearts: newHearts, team: newTeam })
  },

  returnToShop: () => {
    const state = get()
    if (state.phase === 'gameover') return
    const revivedTeam = state.team.map((h) => ({ ...h, currentHp: h.hero.hp }))
    let newChoices: Hero[]
    if (state.shopFrozen) {
      const kept = [...state.shopChoices]
      const slotsToFill = SHOP_CHOICES - kept.length
      if (slotsToFill > 0) {
        const keptIds = new Set(kept.map((h) => h.id))
        const available = [...HERO_POOL].filter((h) => !keptIds.has(h.id)).sort(() => Math.random() - 0.5)
        const filler = available.length >= slotsToFill ? available.slice(0, slotsToFill) : [...available, ...[...HERO_POOL].sort(() => Math.random() - 0.5)].slice(0, slotsToFill)
        kept.push(...filler)
      }
      newChoices = kept
    } else { newChoices = rollShopChoices() }
    set({ phase: 'shop', round: state.round + 1, team: revivedTeam, gold: SHOP_GOLD, shopChoices: newChoices, shopFrozen: false, lastBattleResult: null, pendingMerge: null })
  },

  reset: () => set({
    phase: 'menu', gold: FIRST_SHOP_GOLD, hearts: STARTING_HEARTS, round: 1,
    team: [], bench: [], shopChoices: [], shopFrozen: false, pendingMerge: null, lastBattleResult: null, won: false,
  }),
}))
