import { getUpgrade, playerStats, useGameStore, type UpgradeDef } from './store'

export function LevelUpOverlay() {
  const pending = useGameStore((s) => s.pendingLevelUps + s.pendingBossUpgrades > 0)
  const choices = useGameStore((s) => s.upgradeChoices)
  const level = useGameStore((s) => s.level)
  const holdLeft = useGameStore((s) => s.holdLeftProgress)
  const holdRight = useGameStore((s) => s.holdRightProgress)
  const flashingIdx = useGameStore((s) => s.flashingIdx)
  const slidingOut = useGameStore((s) => s.slidingOut)

  const visible = pending && !slidingOut

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        pointerEvents: 'none',
        transform: visible ? 'translateY(0)' : 'translateY(-110%)',
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
        LEVEL {level} — HOLD A SIDE TO CHOOSE
      </div>
      <div
        style={{
          display: 'flex',
          gap: 24,
          justifyContent: 'center',
          padding: '0 16px',
        }}
      >
        {choices[0] && (
          <Card
            upgrade={getUpgrade(choices[0])}
            side="left"
            progress={holdLeft}
            flashing={flashingIdx === 0}
          />
        )}
        {choices[1] && (
          <Card
            upgrade={getUpgrade(choices[1])}
            side="right"
            progress={holdRight}
            flashing={flashingIdx === 1}
          />
        )}
      </div>
    </div>
  )
}

function Card({
  upgrade,
  side,
  progress,
  flashing,
}: {
  upgrade: UpgradeDef
  side: 'left' | 'right'
  progress: number
  flashing: boolean
}) {
  const desc = upgrade.describe(playerStats)
  return (
    <div
      style={{
        position: 'relative',
        flex: '0 1 240px',
        maxWidth: 240,
        background: flashing ? '#ffffff' : 'rgba(8, 14, 38, 0.9)',
        border: `2px solid ${flashing ? '#ffffff' : '#33ddff'}`,
        borderRadius: 10,
        padding: '16px 20px',
        color: flashing ? '#08203a' : '#cceeff',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: flashing
          ? '0 0 60px rgba(255, 255, 255, 0.95), 0 0 24px rgba(170, 240, 255, 0.8)'
          : '0 0 24px rgba(51, 221, 255, 0.4)',
        transform: flashing ? 'scale(1.08)' : 'scale(1)',
        transition: 'transform 0.18s ease-out, background 0.12s, border-color 0.12s, box-shadow 0.18s',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: flashing ? '#08203a' : '#33ddff',
          letterSpacing: '0.2em',
          marginBottom: 6,
          fontFamily: 'monospace',
        }}
      >
        {side === 'left' ? '◄ HOLD LEFT' : 'HOLD RIGHT ►'}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 'bold',
          marginBottom: 8,
          color: flashing ? '#08203a' : '#ffffff',
        }}
      >
        {upgrade.name}
      </div>
      <div style={{ fontSize: 14, color: flashing ? '#1a3050' : '#aaccdd', lineHeight: 1.4 }}>
        {desc}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 5,
          background: 'rgba(51, 221, 255, 0.15)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [side === 'left' ? 'right' : 'left']: 0,
            width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
            background:
              side === 'left'
                ? 'linear-gradient(270deg, #33ddff, #aaffdd)'
                : 'linear-gradient(90deg, #33ddff, #aaffdd)',
            boxShadow: '0 0 10px rgba(51, 221, 255, 0.8)',
          }}
        />
      </div>
    </div>
  )
}
