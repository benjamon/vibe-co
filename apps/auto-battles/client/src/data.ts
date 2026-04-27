import type { Hero } from './types'
import heroData from './heroes.json'

const BASE = import.meta.env.BASE_URL ?? '/'

export const HERO_POOL: Hero[] = (heroData as Hero[]).map((h) => ({
  ...h,
  sprite: h.sprite ? `${BASE}${h.sprite.replace(/^\/+/, '')}` : h.sprite,
}))

export const FIRST_SHOP_GOLD = 7
export const SHOP_GOLD = 10
export const REROLL_COST = 1
export const HERO_COST = 3
export const SHOP_CHOICES = 3
export const STARTING_HEARTS = 5
export const MAX_TEAM_SIZE = 5
