import {
  AUTO_FLIPPER_BASE_INTERVAL_MS,
  autoFlipIntervalMs,
  autoFlipperCost,
  coinCost,
  coinValueCost,
  coinsPerTapCost,
  useGameStore,
} from './store'

function formatGold(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatInterval(ms: number): string {
  if (ms <= 0) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

interface UpgradeButtonProps {
  label: string
  detail: string
  cost: number
  affordable: boolean
  onBuy: () => void
}

function UpgradeButton({ label, detail, cost, affordable, onBuy }: UpgradeButtonProps) {
  return (
    <button
      onClick={onBuy}
      disabled={!affordable}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        marginBottom: 8,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.15)',
        background: affordable ? 'rgba(255,215,0,0.18)' : 'rgba(255,255,255,0.04)',
        color: affordable ? '#fff' : '#888',
        cursor: affordable ? 'pointer' : 'not-allowed',
        fontFamily: 'inherit',
        fontSize: 13,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ opacity: 0.85, marginTop: 2 }}>{detail}</div>
      <div style={{ marginTop: 4, color: affordable ? '#ffd700' : '#888' }}>
        cost: {formatGold(cost)}g
      </div>
    </button>
  )
}

export function HUD() {
  const gold = useGameStore((s) => s.gold)
  const coinValue = useGameStore((s) => s.coinValue)
  const coinsPerTap = useGameStore((s) => s.coinsPerTap)
  const coinCount = useGameStore((s) => s.coinCount)
  const autoFlippers = useGameStore((s) => s.autoFlippers)
  const flips = useGameStore((s) => s.flips)
  const headsCount = useGameStore((s) => s.headsCount)
  const tailsCount = useGameStore((s) => s.tailsCount)

  const buyCoin = useGameStore((s) => s.buyCoin)
  const buyCoinsPerTap = useGameStore((s) => s.buyCoinsPerTap)
  const buyCoinValue = useGameStore((s) => s.buyCoinValue)
  const buyAutoFlipper = useGameStore((s) => s.buyAutoFlipper)

  const buyCoinPrice = coinCost(coinCount)
  const tapCost = coinsPerTapCost(coinsPerTap)
  const valueCost = coinValueCost(coinValue)
  const autoCost = autoFlipperCost(autoFlippers)
  const autoInterval = autoFlipIntervalMs(autoFlippers)
  const baseSeconds = AUTO_FLIPPER_BASE_INTERVAL_MS / 1000
  const tapAtCap = coinsPerTap >= coinCount

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        userSelect: 'none',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        data-hud
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          fontSize: 13,
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.45)',
          padding: '10px 14px',
          borderRadius: 8,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 18, color: '#ffd700' }}>{formatGold(gold)} gold</div>
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <div>coins: {coinCount}</div>
          <div>per tap: {coinsPerTap}</div>
          <div>flips: {flips}</div>
          <div>heads: {headsCount}</div>
          <div>tails: {tailsCount}</div>
        </div>
      </div>

      <div
        data-hud
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 240,
          background: 'rgba(0,0,0,0.45)',
          padding: 12,
          borderRadius: 10,
          fontSize: 13,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>upgrades</div>
        <UpgradeButton
          label={`buy a coin (${coinCount})`}
          detail={`add another coin to the table → ${coinCount + 1} total`}
          cost={buyCoinPrice}
          affordable={gold >= buyCoinPrice}
          onBuy={buyCoin}
        />
        <UpgradeButton
          label={`coins per tap (${coinsPerTap}/${coinCount})`}
          detail={
            tapAtCap
              ? 'buy more coins first'
              : `flip ${coinsPerTap + 1} coins per tap`
          }
          cost={tapCost}
          affordable={!tapAtCap && gold >= tapCost}
          onBuy={buyCoinsPerTap}
        />
        <UpgradeButton
          label={`coin value (${coinValue}g)`}
          detail={`+1g per flip → ${coinValue + 1}g each`}
          cost={valueCost}
          affordable={gold >= valueCost}
          onBuy={buyCoinValue}
        />
        <UpgradeButton
          label={`auto-flippers (${autoFlippers})`}
          detail={
            autoFlippers === 0
              ? `unlock auto-flip every ${baseSeconds}s`
              : `next: 1 flip every ${formatInterval(
                  AUTO_FLIPPER_BASE_INTERVAL_MS / (autoFlippers + 1),
                )}`
          }
          cost={autoCost}
          affordable={gold >= autoCost}
          onBuy={buyAutoFlipper}
        />
        {autoFlippers > 0 && (
          <div style={{ marginTop: 4, opacity: 0.7, fontSize: 12 }}>
            current: 1 auto-flip every {formatInterval(autoInterval)}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 18,
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        }}
      >
        tap anywhere to flip {coinsPerTap === 1 ? 'a coin' : `${coinsPerTap} coins`}
      </div>
    </div>
  )
}
