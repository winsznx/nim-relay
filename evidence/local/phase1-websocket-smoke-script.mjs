const url = 'ws://localhost:8797/ws/relays/smoke-test-relay'

function helloOnce(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => reject(new Error(`[${label}] timeout`)), 6000)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello' })))
    ws.addEventListener('message', (ev) => {
      clearTimeout(timer)
      const ack = JSON.parse(ev.data)
      console.log(`[${label}] ack:`, ack)
      ws.close(1000, 'done')
      resolve(ack)
    })
    ws.addEventListener('error', (ev) => {
      clearTimeout(timer)
      reject(new Error(`[${label}] ws error: ${ev.message ?? ev.error ?? 'unknown'}`))
    })
  })
}

await helloOnce('first-connect')
await new Promise((r) => setTimeout(r, 500))
await helloOnce('reconnect')
console.log('WS_SMOKE_PASS')
