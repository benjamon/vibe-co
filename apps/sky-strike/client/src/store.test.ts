import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './store'

describe('GameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      started: false,
      gameOver: false,
      score: 0,
      lives: 3,
      highScore: 0,
    })
  })

  it('starts in not-started state', () => {
    const s = useGameStore.getState()
    expect(s.started).toBe(false)
    expect(s.gameOver).toBe(false)
    expect(s.score).toBe(0)
    expect(s.lives).toBe(3)
  })

  it('starts the game', () => {
    useGameStore.getState().start()
    const s = useGameStore.getState()
    expect(s.started).toBe(true)
    expect(s.gameOver).toBe(false)
    expect(s.lives).toBe(3)
  })

  it('tracks score', () => {
    useGameStore.getState().addScore(100)
    useGameStore.getState().addScore(50)
    expect(useGameStore.getState().score).toBe(150)
  })

  it('decrements lives and ends game at zero', () => {
    useGameStore.getState().start()
    useGameStore.getState().loseLife()
    expect(useGameStore.getState().lives).toBe(2)
    useGameStore.getState().loseLife()
    useGameStore.getState().loseLife()
    const s = useGameStore.getState()
    expect(s.lives).toBe(0)
    expect(s.gameOver).toBe(true)
    expect(s.started).toBe(false)
  })

  it('records high score on game over', () => {
    useGameStore.getState().start()
    useGameStore.getState().addScore(420)
    useGameStore.getState().end()
    expect(useGameStore.getState().highScore).toBe(420)
  })
})
