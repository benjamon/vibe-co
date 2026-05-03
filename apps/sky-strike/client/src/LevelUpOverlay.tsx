import { getUpgrade, playerStats, useGameStore, type UpgradeDef } from './store'

export function LevelUpOverlay() {
  const pending = useGameStore((s) => s.pendingLevelUps > 0)
  const choices = useGameStore((s) => s.upgradeChoices)
  const level = useGameStore((s) => s.level)

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        pointerEvents: 'none',
        transform: pending ? 'translateY(0)' : 'translateY(-110%)',
        transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)',
        zIndex: 10,
      }}
    >
      <div
        style={{
          margin: '40px auto 16px',
          textAlign: 'center',
          color: '#33ddff',
          fontFamily: 'monospace',
          fontSize: 14,
          letterSpacing: '0.3em',
          textShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
        }}
      >
        LEVEL {level} — CHOOSE UPGRADE
      </div>
      <div
        style={{
          display: 'flex',
          gap: 24,
          justifyContent: 'center',
          padding: '0 16px',
        }}
      >
        {choices[0] && <Card upgrade={getUpgrade(choices[0])} side="left" />}
        {choices[1] && <Card upgrade={getUpgrade(choices[1])} side="right" />}
      </div>
    </div>
  )
}

function Card({ upgrade, side }: { upgrade: UpgradeDef; side: 'left' | 'right' }) {
  const desc = upgrade.describe(playerStats)
  return (
    <div
      style={{
        flex: '0 1 240px',
        maxWidth: 240,
        background: 'rgba(8, 14, 38, 0.9)',
        border: '2px solid #33ddff',
        borderRadius: 10,
        padding: '16px 20px',
        color: '#cceeff',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 0 24px rgba(51, 221, 255, 0.4)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: '#33ddff',
          letterSpacing: '0.2em',
          marginBottom: 6,
          fontFamily: 'monospace',
        }}
      >
        {side === 'left' ? '◄ LEFT' : 'RIGHT ►'}
      </div>
      <div style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 8, color: '#ffffff' }}>
        {upgrade.name}
      </div>
      <div style={{ fontSize: 14, color: '#aaccdd', lineHeight: 1.4 }}>{desc}</div>
    </div>
  )
}
