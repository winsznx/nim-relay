import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

interface ConnectionAttachment {
  connectedAt: number
  playerId: string | null
}

/**
 * One RelayRoom per active relay (env.RELAY_ROOM.getByName(relayId)).
 * Owns live coordination only - never wallet funds, never durable relational
 * history (that's Supabase). See ARCHITECTURE.md "four authorities".
 */
export class RelayRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    this.ctx.acceptWebSocket(server)
    const attachment: ConnectionAttachment = { connectedAt: Date.now(), playerId: null }
    server.serializeAttachment(attachment)

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      (parsed as { type: unknown }).type === 'hello'
    ) {
      ws.send(JSON.stringify({ type: 'hello_ack', relayName: this.ctx.id.name ?? null, ts: Date.now() }))
    }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Notification only - the socket is already closing. Calling ws.close()
    // again here throws (found via a live wrangler-dev WS smoke test: closing
    // with code 1005, the client's "no status" default, is rejected as an
    // invalid explicit close code). Presence/cleanup bookkeeping lands Phase 4.
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('RelayRoom websocket error', error)
  }

  override async alarm(): Promise<void> {
    // Idempotent alarm handler - claim expiration / reconciliation sweep land in Phase 4.
  }
}
