import mqtt, { type MqttClient } from 'mqtt'
import type { Round } from './schedule'

export interface RoomState {
  v: 1
  code: string
  title: string
  players: string[]
  courts: number
  rounds: Round[]
  current: number
  /** Monotonic revision (ms timestamp) so the newest publish wins across brokers. */
  rev: number
}

export type Status = 'connecting' | 'live' | 'offline'

// Public brokers with retained-message support. We publish to and listen on
// all of them so the room survives any single broker being down.
const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt']
const TOPIC_PREFIX = 'vibe-co/round-robin/v1/'

function brokers(): string[] {
  const override = new URLSearchParams(location.search).getAll('broker')
  return override.length ? override : DEFAULT_BROKERS
}

export class Room {
  private clients: MqttClient[] = []
  private connected = new Set<MqttClient>()
  private topic: string
  state: RoomState | null = null

  constructor(
    readonly code: string,
    private onState: (s: RoomState) => void,
    private onStatus: (s: Status) => void,
  ) {
    this.topic = TOPIC_PREFIX + code
    this.onStatus('connecting')
    for (const url of brokers()) {
      const c = mqtt.connect(url, {
        reconnectPeriod: 3000,
        connectTimeout: 8000,
        clean: true,
      })
      c.on('connect', () => {
        this.connected.add(c)
        c.subscribe(this.topic, { qos: 1 })
        // Host: once any retained state has arrived, re-send our latest in case
        // this broker lost it (or never got it while we were offline).
        setTimeout(() => {
          if (this.owned && this.state && this.connected.has(c)) this.send(c, this.state)
        }, 1500)
        this.emitStatus()
      })
      const drop = () => {
        this.connected.delete(c)
        this.emitStatus()
      }
      c.on('close', drop)
      c.on('offline', drop)
      c.on('error', () => {})
      c.on('message', (_t, payload) => {
        if (!payload.length) return
        try {
          const s = JSON.parse(payload.toString()) as RoomState
          if (s.v !== 1 || s.code !== this.code) return
          if (this.state && s.rev <= this.state.rev) return
          this.state = s
          this.onState(s)
        } catch {
          /* ignore junk */
        }
      })
      this.clients.push(c)
    }
  }

  /** True once this tab has published (i.e. it's the host). */
  private owned = false

  /** Host: start from a locally saved copy until the network catches up. */
  seed(s: RoomState) {
    this.owned = true
    if (!this.state || s.rev > this.state.rev) this.state = s
  }

  publish(s: RoomState) {
    this.owned = true
    s.rev = Math.max(Date.now(), (this.state?.rev ?? 0) + 1)
    this.state = s
    for (const c of this.connected) this.send(c, s)
  }

  private send(c: MqttClient, s: RoomState) {
    c.publish(this.topic, JSON.stringify(s), { qos: 1, retain: true })
  }

  private emitStatus() {
    this.onStatus(this.connected.size > 0 ? 'live' : 'connecting')
  }

  close() {
    for (const c of this.clients) c.end(true)
    this.clients = []
  }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newRoomCode(len = 5): string {
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return [...buf].map((x) => ALPHABET[x % ALPHABET.length]).join('')
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
