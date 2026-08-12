/**
 * "Play With Friends" multiplayer UI: name entry → friends panel (join/create)
 * → lobby (ready up) → in-game HUD (per-question timer + live scoreboard) →
 * results. Plus the party→store bridge and the client-driven 30s round timer.
 *
 * All networking lives in ./party; this file is purely presentation + the glue
 * that feeds the room's seed/question into the existing game store so the globe
 * serves the same countries to everyone.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Confetti } from './Confetti'
import {
  useGameStore,
  roundsForMode,
  cityRevealName,
  cityFlagUrl,
  cityPopulationRank,
  MAX_CAPITAL_MILES,
  HINT_PENALTY,
  type GameMode,
} from './store'
import { US_CITY_FOUNDED } from './usCityFacts'
import { CityFactsCard, type CityFactsData } from './CityFactsCard'
import { CountryFactsCard } from './CountryFactsCard'
import { resolveSubMode, behavioralModeOf } from './gameModes'
import { COLOR, FONT, border, hardShadow, panelStyle, pillStyle, buttonStyle, inputStyle, disabledLook } from './theme'
import {
  subscribeParty,
  subscribePartyGuesses,
  subscribePartyEvents,
  createParty,
  joinParty,
  checkCodeExists,
  setReady,
  setVote,
  leaveParty,
  resumeParty,
  advanceQuestion,
  restartParty,
  getSavedName,
  generatePartySeed,
  MAX_PLAYER_NAME_LEN,
  PARTY_CODE_LEN,
  type PartySnapshot,
  type PartyPlayer,
  type PartyEvent,
} from './party'

// Presentation for a party sub-mode (lobby vote cards + in-game HUD), pulled
// straight from the shared gameModes definitions so labels stay in one place.
const modeMeta = (mode: string) => {
  if (!mode) return { label: '—', icon: '❓', blurb: '' }
  const sub = resolveSubMode(mode)
  return { label: sub.label, icon: sub.icon, blurb: sub.blurb }
}
// The behavioural mode ('classic'/'capitals') for a party sub-mode id.
const behavioralOf = (mode: string | undefined): GameMode =>
  behavioralModeOf(resolveSubMode(mode ?? ''))

// Capitals scoreboard: an un-answered round is charged the same as the worst
// possible guess (guess miles are capped at MAX_CAPITAL_MILES), so skipping is
// never better than guessing, but no worse than a maximally-bad guess either.
const CAPITAL_MISS_PENALTY = MAX_CAPITAL_MILES

// A player's effective capitals golf score: summed miss distance plus a penalty
// for every round they didn't answer. Lower is better.
const capitalScore = (
  userId: string,
  snap: PartySnapshot,
  rounds: number,
): number => {
  const total = snap.capitalTotals[userId] ?? 0
  const answered = snap.capitalAnswered[userId] ?? 0
  return total + CAPITAL_MISS_PENALTY * Math.max(0, rounds - answered)
}
const milesFmt = (m: number) => `${Math.round(m).toLocaleString()} mi`

// ---------- shared styles ----------

// Pair with className="arcade-btn" for the press-depress :active state.
const panelButton = buttonStyle(COLOR.cream)

const Flag = ({
  code,
  src,
  height,
}: {
  code?: string
  // Explicit image URL override (US state flags aren't ISO country codes).
  src?: string
  height: number
}) => {
  const url = src ?? (code ? `https://flagcdn.com/w80/${code}.png` : undefined)
  return url ? (
    <img
      src={url}
      alt=""
      width={Math.round((height * 4) / 3)}
      height={height}
      style={{ borderRadius: 4, verticalAlign: 'middle', border: border(1.5) }}
    />
  ) : null
}

// ---------- party state hook ----------

export function useParty(): { snap: PartySnapshot; active: boolean } {
  const [snap, setSnap] = useState<PartySnapshot>({
    room: null,
    players: [],
    myUserId: '',
    capitalTotals: {},
    capitalAnswered: {},
  })
  useEffect(() => {
    const unsub = subscribeParty((s) => {
      setSnap(s)
      // Mirror to window for Playwright introspection (cf. __gameState).
      ;(window as unknown as { __party: PartySnapshot }).__party = s
    })
    // On a fresh load, try to rejoin the room this tab was in (no-op if none).
    void resumeParty()
    return unsub
  }, [])
  return { snap, active: snap.room !== null }
}

// ---------- toasts ----------

interface Toast {
  id: number
  name: string
  correct: boolean
}

function ToastFeed({ myUserId }: { myUserId: string }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  useEffect(() => {
    return subscribePartyGuesses((e) => {
      const id = nextId.current++
      // Newest first so it sits at the top and pushes the rest down.
      setToasts((prev) => [{ id, name: e.name, correct: e.correct }, ...prev])
      // Lives 3s (matches the CSS animation), then unmounts.
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
    })
  }, [myUserId])

  if (toasts.length === 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 15,
            color: t.correct ? COLOR.charcoal : COLOR.cream,
            background: t.correct ? COLOR.green : COLOR.coral,
            border: border(2),
            boxShadow: hardShadow(3),
            whiteSpace: 'nowrap',
            animation: 'mpToastLife 3s ease forwards',
          }}
        >
          {t.name} {t.correct ? '✓' : '✗'}
        </div>
      ))}
    </div>
  )
}

// ---------- scoreboard ----------

function Scoreboard({
  snap,
  hostId,
  emphasizeTop,
}: {
  snap: PartySnapshot
  hostId?: string
  emphasizeTop?: boolean
}) {
  const { players, myUserId, room } = snap
  const behavioral = behavioralOf(room?.mode)
  const isCapitals = behavioral === 'capitals'
  const rounds = roundsForMode(behavioral)

  // Capitals ranks by lowest golf score (miles + skip penalty); the other modes
  // rank by highest correct-count. `metric` is the per-player number the row
  // shows; `best` is the leading value for the crown/highlight.
  const scored = useMemo(() => {
    const rows = players.map((p) => ({
      p,
      metric: isCapitals ? capitalScore(p.userId, snap, rounds) : p.score,
    }))
    rows.sort((a, b) =>
      isCapitals
        ? a.metric - b.metric || a.p.joinedAt - b.p.joinedAt
        : b.metric - a.metric || a.p.joinedAt - b.p.joinedAt,
    )
    return rows
  }, [players, snap, isCapitals, rounds])

  const best = scored.length ? scored[0].metric : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {scored.map(({ p, metric }, i) => {
        const isTop = emphasizeTop && metric === best && (isCapitals ? true : metric > 0)
        return (
          <div
            key={p.userId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: isTop ? '10px 14px' : '8px 12px',
              borderRadius: 12,
              background: isTop ? COLOR.yellow : COLOR.cream,
              border: border(2),
              boxShadow: isTop ? hardShadow(3) : undefined,
              animation: isTop ? 'mpWinnerPulse 1.4s ease-in-out infinite' : undefined,
            }}
          >
            <span style={{ width: 22, textAlign: 'center', fontSize: isTop ? 20 : 15, fontWeight: 800 }}>
              {isTop ? '👑' : i + 1}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: isTop ? 18 : 15,
                fontWeight: isTop ? 800 : 600,
                color: COLOR.charcoal,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
              {p.userId === myUserId && <span style={{ fontWeight: 600 }}> (you)</span>}
              {p.userId === hostId && <span style={{ fontWeight: 600 }}> · host</span>}
            </span>
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 800,
                fontSize: isTop ? 20 : 16,
                color: isTop ? COLOR.charcoal : '#1E8E4A',
              }}
            >
              {isCapitals ? milesFmt(snap.capitalTotals[p.userId] ?? 0) : p.score}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------- friends panel (choose → name [+ code]) ----------

// First pick Create or Join; only then are you asked for a name (and a code, if
// joining). Keeps the entry screen to a single clear decision.
type FriendsStep = 'choose' | 'create' | 'join'

function FriendsPanel({
  onCancel,
  onMainMenu,
}: {
  onCancel: () => void
  onMainMenu: () => void
}) {
  const [step, setStep] = useState<FriendsStep>('choose')

  if (step === 'choose') {
    return (
      <PanelShell title="Play With Friends">
        <button
          type="button"
          className="arcade-btn"
          onClick={() => setStep('create')}
          style={{ ...buttonStyle(COLOR.green), width: '100%' }}
        >
          Create Party
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', fontSize: 13, fontWeight: 700 }}>
          <div style={{ flex: 1, height: 2, background: COLOR.charcoal }} />
          or
          <div style={{ flex: 1, height: 2, background: COLOR.charcoal }} />
        </div>
        <button
          type="button"
          className="arcade-btn"
          onClick={() => setStep('join')}
          style={{ ...panelButton, width: '100%' }}
        >
          Join Party
        </button>
        <button
          type="button"
          className="arcade-btn"
          onClick={onMainMenu}
          style={{ ...panelButton, width: '100%' }}
        >
          ← Main Menu
        </button>
      </PanelShell>
    )
  }
  return (
    <NameEntry
      mode={step}
      onBack={() => setStep('choose')}
      onClose={onCancel}
    />
  )
}

function NameEntry({
  mode,
  onBack,
  onClose,
}: {
  mode: 'create' | 'join'
  onBack: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(getSavedName())
  const [code, setCode] = useState('')
  const [joinable, setJoinable] = useState(false)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const codeReady = code.length === PARTY_CODE_LEN

  // Probe whether the typed code exists → drives Join enablement. Polls rather
  // than checking once: a cold connection (or typing the code before the host
  // has finished creating the room) shouldn't leave the button stuck disabled.
  useEffect(() => {
    if (mode !== 'join' || !codeReady) {
      setJoinable(false)
      setChecking(false)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    setChecking(true)
    const run = async () => {
      const exists = await checkCodeExists(code)
      if (cancelled) return
      setJoinable(exists)
      setChecking(false)
      // Keep polling until the code resolves (so a late-arriving room enables
      // the button without the player having to retype).
      if (!exists) timer = setTimeout(run, 1200)
    }
    const initial = setTimeout(run, 250)
    return () => {
      cancelled = true
      clearTimeout(initial)
      clearTimeout(timer)
    }
  }, [code, codeReady, mode])

  const submit = async () => {
    if (!trimmedName || busy) return
    setBusy(true)
    setError(null)
    if (mode === 'create') {
      const created = await createParty(trimmedName, generatePartySeed())
      setBusy(false)
      if (!created) setError('Could not create a party — check your connection.')
    } else {
      if (!joinable) {
        setBusy(false)
        return
      }
      const ok = await joinParty(code, trimmedName)
      setBusy(false)
      if (!ok) setError('Could not join that party.')
    }
  }

  const joinDisabled = mode === 'join' && !joinable
  const actionDisabled = !trimmedName || busy || joinDisabled

  return (
    <PanelShell
      title={mode === 'create' ? 'Create Party' : 'Join Party'}
      onClose={onClose}
    >
      <label style={{ fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
        Your name
      </label>
      <input
        style={inputStyle}
        value={name}
        maxLength={MAX_PLAYER_NAME_LEN}
        placeholder="Name (max 10)"
        onChange={(e) => setName(e.target.value.slice(0, MAX_PLAYER_NAME_LEN))}
        autoFocus
      />

      {mode === 'join' && (
        <>
          <label style={{ fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
            Room code
          </label>
          <input
            style={{ ...inputStyle, letterSpacing: 6, fontWeight: 800, textAlign: 'center', fontSize: 22 }}
            value={code}
            placeholder="––––"
            inputMode="text"
            autoCapitalize="characters"
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, PARTY_CODE_LEN),
              )
            }
          />
        </>
      )}

      <button
        type="button"
        className="arcade-btn"
        onClick={submit}
        disabled={actionDisabled}
        style={{
          ...buttonStyle(mode === 'create' ? COLOR.green : COLOR.yellow),
          width: '100%',
          ...(actionDisabled ? disabledLook : {}),
        }}
      >
        {busy
          ? mode === 'create'
            ? 'Creating…'
            : 'Joining…'
          : mode === 'join' && codeReady && checking
            ? 'Checking…'
            : mode === 'join' && codeReady && !joinable
              ? 'No party with that code'
              : mode === 'create'
                ? 'Create Party'
                : 'Join Party'}
      </button>

      <button
        type="button"
        className="arcade-btn"
        onClick={onBack}
        disabled={busy}
        style={{ ...panelButton, width: '100%', ...(busy ? disabledLook : {}) }}
      >
        Back
      </button>

      {error && <div style={{ color: COLOR.coral, fontWeight: 700, fontSize: 13 }}>{error}</div>}
    </PanelShell>
  )
}

// ---------- lobby ----------

// Lobby roster: every player with a live ready indicator (✓ ready / ⏳ waiting).
function LobbyRoster({
  players,
  myUserId,
  hostId,
}: {
  players: PartyPlayer[]
  myUserId: string
  hostId?: string
}) {
  const ordered = useMemo(
    () => [...players].sort((a, b) => a.joinedAt - b.joinedAt),
    [players],
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {ordered.map((p) => (
        <div
          key={p.userId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 12,
            background: p.ready ? COLOR.green : COLOR.cream,
            border: border(2),
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 15,
              fontWeight: 600,
              color: COLOR.charcoal,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {p.name}
            {p.userId === myUserId && <span style={{ fontWeight: 600 }}> (you)</span>}
            {p.userId === hostId && <span style={{ fontWeight: 600 }}> · host</span>}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: COLOR.charcoal,
            }}
          >
            {p.ready ? '✓ Ready' : 'Waiting…'}
          </span>
        </div>
      ))}
    </div>
  )
}

// Two candidate modes shown side by side; tap to vote. The winner (most votes,
// random on a tie) is chosen server-side when everyone readies up.
function VoteCards({ snap }: { snap: PartySnapshot }) {
  const { room, players, myUserId } = snap
  const myVote = players.find((p) => p.userId === myUserId)?.vote ?? ''
  const candidates = [room?.modeA, room?.modeB].filter(
    (m): m is string => !!m,
  )
  if (candidates.length < 2) return null
  const tally = (mode: string) => players.filter((p) => p.vote === mode).length

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: 8,
          letterSpacing: 0.3,
        }}
      >
        Vote for the mode
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {candidates.map((mode) => {
          const meta = modeMeta(mode)
          const selected = myVote === mode
          const votes = tally(mode)
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setVote(mode)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '12px 6px',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: FONT,
                color: COLOR.charcoal,
                background: selected ? COLOR.green : COLOR.cream,
                border: border(2),
                boxShadow: selected ? hardShadow(3) : 'none',
              }}
            >
              <span style={{ fontSize: 30, lineHeight: 1 }}>{meta.icon}</span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{meta.label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', minHeight: 28 }}>
                {meta.blurb}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  marginTop: 2,
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: COLOR.yellow,
                  border: border(1.5),
                }}
              >
                {votes} vote{votes === 1 ? '' : 's'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Lobby({ snap }: { snap: PartySnapshot }) {
  const { room, players, myUserId } = snap
  const me = players.find((p) => p.userId === myUserId)
  const canReady = players.length >= 2
  const ready = me?.ready ?? false

  return (
    <>
      {/* Room code pinned to the top of the screen. */}
      <div
        style={{
          ...pillStyle,
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          flexDirection: 'column',
          padding: '8px 24px',
          pointerEvents: 'none',
          zIndex: 20,
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: 1, fontWeight: 700 }}>ROOM CODE</div>
        <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 10 }}>{room?.code}</div>
      </div>

      <PanelShell title="Lobby" anchor="bottom">
        <LobbyRoster players={players} myUserId={myUserId} hostId={room?.hostId} />
        {/* Mode vote, side by side, above the ready-up controls. */}
        <VoteCards snap={snap} />
        <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {canReady
            ? ready
              ? 'Waiting for everyone to ready up…'
              : 'Ready up to start. The match begins when everyone is ready.'
            : 'Waiting for at least one more player to join…'}
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button
            type="button"
            className="arcade-btn"
            onClick={() => leaveParty()}
            style={{ ...buttonStyle(COLOR.coral, COLOR.cream), flex: 1 }}
          >
            Leave
          </button>
          <button
            type="button"
            className="arcade-btn"
            onClick={() => setReady(!ready)}
            disabled={!canReady}
            style={{
              ...buttonStyle(ready ? COLOR.yellow : COLOR.green),
              flex: 2,
              ...(!canReady ? disabledLook : {}),
            }}
          >
            {ready ? 'Unready' : 'Ready Up'}
          </button>
        </div>
      </PanelShell>
    </>
  )
}

// ---------- in-game HUD ----------

function GameHud({ snap }: { snap: PartySnapshot }) {
  const { room } = snap
  const mode = behavioralOf(room?.mode)
  const isCapitals = mode === 'capitals'
  const rounds = roundsForMode(mode)

  const target = useGameStore((s) => s.target)
  const partyAnswered = useGameStore((s) => s.partyAnswered)
  const roundGuess = useGameStore((s) => s.roundGuess)
  const guess = useGameStore((s) => s.country)
  const countryCodes = useGameStore((s) => s.countryCodes)
  const countryPopulations = useGameStore((s) => s.countryPopulations)
  const cities = useGameStore((s) => s.cities)
  const commitPartyCapitalGuess = useGameStore((s) => s.commitPartyCapitalGuess)
  const clearRoundMarkers = useGameStore((s) => s.clearRoundMarkers)
  const revealName = useGameStore((s) => s.revealName)
  const revealFlag = useGameStore((s) => s.revealFlag)
  const hintCircle = useGameStore((s) => s.hintCircle)
  const useLifeline = useGameStore((s) => s.useLifeline)
  const markers = useGameStore((s) => s.markers)
  const markerEpoch = useGameStore((s) => s.markerEpoch)

  // Local clock, synced to the server deadline. Drives the countdown and the
  // idempotent advance call when the deadline passes.
  const [now, setNow] = useState(() => Date.now())
  // Epoch-ms of our last advance attempt, to throttle retries (see below).
  const lastAdvanceAttempt = useRef(0)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const deadline = room?.questionDeadline ?? 0
  const question = room?.currentQuestion ?? 0
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000))

  useEffect(() => {
    if (room?.phase !== 'playing') return
    if (deadline <= 0 || now < deadline) return
    // The deadline passed — ask the server to advance. Retry ~once a second
    // rather than firing once: advance_question is idempotent (guarded by
    // current_question), and retrying self-heals client/server clock skew. If
    // our clock runs ahead of the server's, the first call arrives before the
    // server's deadline and is rejected; a later retry lands once the server
    // clock passes it. A single one-shot call would wedge the room forever.
    if (now - lastAdvanceAttempt.current >= 1000) {
      lastAdvanceAttempt.current = now
      advanceQuestion(question)
    }
  }, [now, deadline, question, room?.phase])

  // City modes: if we only dropped one pin, lock it in a couple seconds before
  // the deadline so it still counts (the second guess is optional). The buffer
  // gives the submit time to land before the server's "too late" cutoff even
  // with a little clock skew; a real second guess before then supersedes it.
  useEffect(() => {
    if (!isCapitals || partyAnswered || roundGuess === null) return
    if (deadline <= 0 || secondsLeft > 2) return
    commitPartyCapitalGuess()
  }, [
    isCapitals,
    partyAnswered,
    roundGuess,
    deadline,
    secondsLeft,
    commitPartyCapitalGuess,
  ])

  const lowTime = secondsLeft <= 5
  // City modes: this round's scoring guess distance — the closer of the two
  // guess pins (each labelled "N mi"). Shown once we've locked in.
  const myDistanceLabel = useMemo(() => {
    if (!isCapitals || !partyAnswered) return null
    let best = Infinity
    for (const m of markers) {
      if (m.kind === 'reveal') continue
      const n = Number(m.label.replace(/[^0-9.]/g, ''))
      if (Number.isFinite(n) && n < best) best = n
    }
    return Number.isFinite(best) ? `${Math.round(best).toLocaleString()} mi` : null
  }, [isCapitals, partyAnswered, markers])

  // Once the round locks in, show the facts card for the city just answered
  // — `target` hasn't advanced yet in the party flow (the next question only
  // lands on the server's round-end broadcast), so it's still the right city
  // to read straight off the live target.
  const lastCity =
    isCapitals && partyAnswered && target ? cities[target] : null
  // The most recently resolved classic round (not capitals), for the
  // Countries mode's after-guess facts card. Mirrors App.tsx's solo-mode
  // derivation — states isn't a party mode, so !isCapitals is enough to gate.
  const lastResolvedCountryMarker = useMemo(() => {
    if (isCapitals) return null
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]
      if (m.kind === 'correct' || m.kind === 'reveal') return m
    }
    return null
  }, [markers, isCapitals])
  const lastCityInfo: CityFactsData | null =
    lastCity && target
      ? {
          key: target,
          city: lastCity.city,
          place: cityRevealName(lastCity, room?.mode ?? ''),
          flagCode: countryCodes[lastCity.country],
          flagSrc: cityFlagUrl(lastCity, room?.mode ?? ''),
          pop: lastCity.pop,
          rank: cityPopulationRank(cities, target),
          founded: US_CITY_FOUNDED[lastCity.city],
          isCapital: lastCity.stateCapital || lastCity.capital,
        }
      : null

  // Epoch snapshot of the map state as of the last capitals-mode reveal —
  // lets the details card's dismiss handler (which can fire up to
  // AUTO_DISMISS_MS later) tell whether the player has already started a new
  // round in the meantime (bumping markerEpoch again via their next guess),
  // so it never wipes pins that aren't the ones it was shown for.
  const cityRevealEpochRef = useRef(0)
  useEffect(() => {
    if (lastCityInfo) cityRevealEpochRef.current = markerEpoch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCityInfo?.key])

  return (
    <>
      {/* Top centre: question progress, target, countdown. */}
      <div
        style={{
          ...pillStyle,
          position: 'absolute',
          top: 56,
          left: '50%',
          transform: 'translateX(-50%)',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 20px',
          pointerEvents: 'none',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {Math.min(question + 1, rounds)} / {rounds}
          </span>
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 900,
              fontSize: 20,
              padding: '2px 12px',
              borderRadius: 999,
              background: lowTime ? COLOR.coral : COLOR.yellow,
              color: COLOR.charcoal,
              border: border(2),
            }}
          >
            {secondsLeft}s
          </span>
        </div>
        {isCapitals ? (
          // Capitals: show only the capital city; country name/flag stay hidden
          // behind the lifelines.
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>City:</span>
              <span style={{ fontSize: 28, fontWeight: 800 }}>
                {target ? cities[target]?.city ?? '…' : '…'}
              </span>
            </div>
            {(revealFlag || revealName) && target && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
                {revealFlag && cities[target] && (
                  <Flag
                    code={countryCodes[cities[target].country]}
                    src={cityFlagUrl(cities[target], room?.mode ?? '')}
                    height={40}
                  />
                )}
                {revealName && cities[target] && (
                  <span>{cityRevealName(cities[target], room?.mode ?? '')}</span>
                )}
              </div>
            )}
            {!partyAnswered && (
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {roundGuess === null
                  ? 'Guess 1 of 2'
                  : 'Guess 2 of 2 — closer one counts'}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 26, fontWeight: 700 }}>
            <span>Find:</span>
            <Flag code={target ? countryCodes[target] : undefined} height={22} />
            <span>{target ?? '…'}</span>
          </div>
        )}
        {partyAnswered && (
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              padding: '4px 14px',
              borderRadius: 999,
              background: isCapitals ? COLOR.cream : COLOR.yellow,
              border: border(2),
            }}
          >
            {myDistanceLabel
              ? `Your guess: ${myDistanceLabel} — waiting for the round to end…`
              : 'Locked in — waiting for the round to end…'}
          </div>
        )}
      </div>

      <CityFactsCard
        info={lastCityInfo}
        seed={room?.code ?? null}
        onDismiss={() => clearRoundMarkers(cityRevealEpochRef.current)}
      />
      <CountryFactsCard
        marker={lastResolvedCountryMarker}
        countryCodes={countryCodes}
        countryPopulations={countryPopulations}
        seed={room?.code ?? null}
      />

      {/* Capitals lifelines (top-right): usable every round at a points cost,
          until you've answered. */}
      {isCapitals && !partyAnswered && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            pointerEvents: 'auto',
            zIndex: 25,
          }}
        >
          {(
            [
              { key: 'name', icon: '🏳️', text: 'Name', title: 'Show country name', used: revealName },
              { key: 'flag', icon: '🚩', text: 'Flag', title: 'Show country flag', used: revealFlag },
              { key: 'circle', icon: '⭕', text: 'Circle', title: 'Draw circle', used: hintCircle !== null },
            ] as const
          ).map((l) => (
            <button
              key={l.key}
              type="button"
              className="arcade-btn"
              title={l.title}
              disabled={l.used}
              onClick={() => useLifeline(l.key)}
              style={{
                ...panelButton,
                // Narrow + stacked so the label wraps down the button instead
                // of stretching wide into the centre of the map.
                width: 70,
                boxSizing: 'border-box',
                padding: '6px 6px',
                fontSize: 13,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                lineHeight: 1.15,
                textDecoration: l.used ? 'line-through' : 'none',
                ...(l.used ? disabledLook : {}),
              }}
            >
              <span style={{ fontSize: 18 }}>{l.icon}</span>
              <span>{l.text}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>-{HINT_PENALTY[l.key]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Live scoreboard, bottom-left, out of the way of the globe. */}
      <div
        style={{
          ...panelStyle,
          position: 'absolute',
          left: 12,
          bottom: 56,
          width: 'min(240px, 70vw)',
          padding: 10,
          borderRadius: 14,
          zIndex: 20,
        }}
      >
        <Scoreboard snap={snap} />
      </div>

      {/* Last guess, bottom centre (classic only — capitals shows its
          distance in the status pill above). */}
      {!isCapitals && guess && (
        <div
          style={{
            ...pillStyle,
            position: 'absolute',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 16px',
            fontSize: 18,
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          <span style={{ fontWeight: 700 }}>Guessed:</span>
          <Flag code={countryCodes[guess]} height={16} />
          <span>{guess}</span>
        </div>
      )}
    </>
  )
}

// ---------- results ----------

function Results({ snap, onExit }: { snap: PartySnapshot; onExit: () => void }) {
  const { room, players, myUserId } = snap
  const behavioral = behavioralOf(room?.mode)
  const isCapitals = behavioral === 'capitals'
  const rounds = roundsForMode(behavioral)

  // Capitals wins on the lowest golf score; the other modes on the highest
  // correct-count. A capitals room always has a winner (someone is closest);
  // classic needs at least one point on the board.
  const metricOf = (p: PartyPlayer) =>
    isCapitals ? capitalScore(p.userId, snap, rounds) : p.score
  const best = players.length
    ? players.reduce(
        (m, p) => (isCapitals ? Math.min(m, metricOf(p)) : Math.max(m, metricOf(p))),
        isCapitals ? Infinity : 0,
      )
    : 0
  const winners = players.filter((p) =>
    isCapitals ? metricOf(p) === best : metricOf(p) === best && best > 0,
  )
  const iWon = winners.some((w) => w.userId === myUserId)
  const [celebrate, setCelebrate] = useState(iWon)

  return (
    <PanelShell title="Final Scores" anchor="center">
      {celebrate && <Confetti intensity="full" onDone={() => setCelebrate(false)} />}
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>
        {modeMeta(room?.mode ?? '').icon} {modeMeta(room?.mode ?? '').label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: COLOR.coral,
          textAlign: 'center',
        }}
      >
        {winners.length === 0
          ? 'No points scored!'
          : winners.length === 1
            ? `${iWon ? 'You win! 🎉' : `${winners[0].name} wins! 🏆`}`
            : `It's a tie! 🤝`}
      </div>
      <Scoreboard snap={snap} hostId={room?.hostId} emphasizeTop />
      {/* Play Again sends everyone back to the ready-up lobby (same code, fresh
          seed). Any player can trigger it; the reducer is idempotent. */}
      <button
        type="button"
        className="arcade-btn"
        onClick={() => restartParty(generatePartySeed())}
        style={{ ...buttonStyle(COLOR.green), width: '100%' }}
      >
        🔁 Play Again
      </button>
      <button
        type="button"
        className="arcade-btn"
        onClick={() => {
          leaveParty()
          onExit()
        }}
        style={{ ...panelButton, width: '100%' }}
      >
        Back to Menu
      </button>
    </PanelShell>
  )
}

// ---------- panel shell ----------

function PanelShell({
  title,
  children,
  onClose,
  anchor = 'center',
}: {
  title: string
  children: React.ReactNode
  onClose?: () => void
  anchor?: 'center' | 'bottom'
}) {
  const pos =
    anchor === 'bottom'
      ? { left: '50%', bottom: 16, transform: 'translateX(-50%)' }
      : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  return (
    <div
      style={{
        ...panelStyle,
        position: 'absolute',
        ...pos,
        width: 'min(360px, 92vw)',
        borderRadius: 16,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'auto',
        zIndex: 25,
      }}
    >
      <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.3 }}>{title}</div>
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLOR.charcoal,
              fontSize: 24,
              fontWeight: 700,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

// ---------- lifeline notification feed ----------

// Toasts a line whenever any player spends a capitals lifeline, e.g.
// "Ada used the Show country flag lifeline". Sits just below the guess toasts.
const LIFELINE_LABEL: Record<string, string> = {
  name: 'Show country name',
  flag: 'Show country flag',
  circle: 'Draw circle',
}

interface LifelineToast {
  id: number
  text: string
}

function LifelineFeed() {
  const [toasts, setToasts] = useState<LifelineToast[]>([])
  const nextId = useRef(1)
  useEffect(() => {
    return subscribePartyEvents((e) => {
      if (e.kind !== 'lifeline') return
      const label = LIFELINE_LABEL[e.detail] ?? e.detail
      const id = nextId.current++
      const text = `${e.name} used the ${label} lifeline`
      setToasts((prev) => [{ id, text }, ...prev])
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        4000,
      )
    })
  }, [])

  if (toasts.length === 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        pointerEvents: 'none',
        zIndex: 31,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 15,
            color: COLOR.cream,
            background: COLOR.charcoal,
            border: border(2),
            boxShadow: hardShadow(3),
            whiteSpace: 'nowrap',
            animation: 'mpToastLife 4s ease forwards',
          }}
        >
          📱 {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------- overlay root ----------

export function PartyOverlay({
  friendsOpen,
  onClose,
  onMainMenu,
}: {
  friendsOpen: boolean
  onClose: () => void
  onMainMenu: () => void
}) {
  const { snap } = useParty()
  const { room } = snap
  const multiplayer = useGameStore((s) => s.multiplayer)
  const syncPartyMatch = useGameStore((s) => s.syncPartyMatch)
  const endPartyMatch = useGameStore((s) => s.endPartyMatch)

  // Bridge: feed the room's seed/question/phase into the game store so the
  // globe serves the right country and the store knows we're in a party match.
  useEffect(() => {
    if (room && (room.phase === 'playing' || room.phase === 'finished')) {
      syncPartyMatch({
        seed: room.seed,
        phase: room.phase,
        currentQuestion: room.currentQuestion,
        mode: room.mode,
      })
    }
  }, [room, syncPartyMatch])

  // When the room disappears (we left, or the host closed it) tear the match
  // down and return to the main menu.
  useEffect(() => {
    if (!room && multiplayer) endPartyMatch()
  }, [room, multiplayer, endPartyMatch])

  return (
    <>
      <style>{`
        @keyframes mpToastLife {
          0%   { opacity: 0; transform: translateY(-12px) scale(0.96); }
          10%  { opacity: 1; transform: translateY(0) scale(1); }
          80%  { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(0) scale(1); }
        }
        @keyframes mpWinnerPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.03); }
        }
      `}</style>

      {room && <ToastFeed myUserId={snap.myUserId} />}
      {room && <LifelineFeed />}

      {room?.phase === 'lobby' && <Lobby snap={snap} />}
      {room?.phase === 'playing' && <GameHud snap={snap} />}
      {room?.phase === 'finished' && <Results snap={snap} onExit={onClose} />}

      {!room && friendsOpen && (
        <FriendsPanel onCancel={onClose} onMainMenu={onMainMenu} />
      )}
    </>
  )
}
