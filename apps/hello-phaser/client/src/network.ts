import { DbConnection, tables } from './module_bindings'
import { Identity } from 'spacetimedb'

const SPACETIMEDB_URI = 'ws://127.0.0.1:3000'
const MODULE_NAME = 'hello-phaser'

export interface RemotePlayer {
  identity: Identity
  x: number
  y: number
  directionX: number
  color: number
}

type PlayerCallback = (players: RemotePlayer[]) => void

let connection: DbConnection | null = null
let localIdentity: Identity | null = null
let onPlayersChanged: PlayerCallback | null = null

export function getLocalIdentity(): Identity | null {
  return localIdentity
}

export function getConnection(): DbConnection | null {
  return connection
}

export function setOnPlayersChanged(cb: PlayerCallback) {
  onPlayersChanged = cb
}

function notifyPlayers() {
  if (!connection || !onPlayersChanged) return
  const players: RemotePlayer[] = []
  for (const row of connection.db.player.iter()) {
    players.push({
      identity: row.identity,
      x: row.x,
      y: row.y,
      directionX: row.directionX,
      color: row.color,
    })
  }
  onPlayersChanged(players)
}

export function connectToServer(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(MODULE_NAME)
      .onConnect((_conn, identity, _authToken) => {
        console.log('Connected to SpacetimeDB as', identity.toHexString())
        localIdentity = identity

        // Subscribe to all player data
        _conn.subscriptionBuilder()
          .onApplied(() => {
            console.log('Subscription applied')
            notifyPlayers()
            resolve(_conn)
          })
          .subscribeToAllTables()
      })
      .onConnectError((_conn, err) => {
        console.error('Connection error:', err)
        reject(err)
      })
      .onDisconnect(() => {
        console.log('Disconnected from SpacetimeDB')
      })
      .build()

    connection = conn

    // Listen for player table changes
    conn.db.player.onInsert(() => notifyPlayers())
    conn.db.player.onUpdate(() => notifyPlayers())
    conn.db.player.onDelete(() => notifyPlayers())
  })
}

export function sendPosition(x: number, y: number, directionX: number) {
  if (!connection) return
  connection.reducers.updatePosition({ x, y, directionX })
}
