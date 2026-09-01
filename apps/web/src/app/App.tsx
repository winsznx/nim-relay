import { useEffect, useState } from 'react'

/**
 * Mobile app shell for the Phase 1 gate. Real routing/screens (PRD section
 * 20-22) land Phase 5-8; this confirms the build/dev pipeline and the
 * same-origin /api proxy work end to end.
 */
export function App() {
  const [health, setHealth] = useState<'idle' | 'ok' | 'error'>('idle')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(() => setHealth('ok'))
      .catch(() => setHealth('error'))
  }, [])

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 'env(safe-area-inset-top) 24px env(safe-area-inset-bottom)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>
        <span style={{ color: 'var(--color-text-primary)' }}>NIM</span>{' '}
        <span style={{ color: 'var(--color-gold-500)' }}>Relay</span>
      </h1>
      <p style={{ color: 'var(--color-text-muted)', margin: 0, maxWidth: 320 }}>
        How far can one NIM travel? Real NIM is the turn.
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        Worker API: {health === 'idle' ? 'checking...' : health === 'ok' ? 'reachable' : 'unreachable'}
      </p>
    </main>
  )
}
