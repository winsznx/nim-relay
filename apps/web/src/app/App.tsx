import { lazy, Suspense, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe, logout, requestNonce, verifyLogin } from '../lib/auth-api'
import { connectAccount, deviceIdentifier, isInsideNimiqPay, nimiqPayDeepLink, signMessage } from '../lib/nimiq'

/**
 * Phase 2 auth harness. Real product screens (PRD sections 20-22) land
 * Phase 5-8; this screen exists to exercise the Nimiq Pay login flow on a
 * real device: connect -> sign the server challenge -> session cookie.
 */

const DEVICE_ID_REASON = 'Sign in to NIM Relay'

async function runLogin() {
  await connectAccount()
  const deviceId = await deviceIdentifier(DEVICE_ID_REASON)
  const { nonce, message } = await requestNonce()
  const { publicKeyHex, signatureHex } = await signMessage(message)
  const { player } = await verifyLogin({
    nonce,
    publicKeyHex,
    signatureHex,
    ...(deviceId ? { deviceId } : {}),
  })
  return player
}

const GamePage = lazy(() => import('../game/GamePage').then(module => ({ default: module.GamePage })))

export function App() {
  if (window.location.pathname === '/play' || window.location.pathname === '/play/') {
    return <Suspense fallback={<p>Loading solo practice…</p>}><GamePage /></Suspense>
  }
  return <LoginApp />
}

function LoginApp() {
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe })

  const login = useMutation({
    mutationFn: runLogin,
    onSuccess: (player) => queryClient.setQueryData(['me'], player),
  })
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(['me'], null),
  })

  const insideNimiqPay = isInsideNimiqPay()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>
          <span style={{ color: 'var(--color-text-primary)' }}>NIM</span>{' '}
          <span style={{ color: 'var(--color-gold-500)' }}>Relay</span>
        </h1>
        <p style={styles.tagline}>How far can one NIM travel? Real NIM is the turn.</p>
      </header>

      {me.isLoading ? (
        <p style={styles.muted}>Checking session…</p>
      ) : me.data ? (
        <section style={styles.card}>
          <p style={styles.muted}>Signed in</p>
          <p style={styles.handle}>{me.data.handle}</p>
          <p style={styles.wallet}>{me.data.walletAddress}</p>
          <button
            type="button"
            style={styles.buttonSecondary}
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </section>
      ) : insideNimiqPay ? (
        <section style={styles.card}>
          <button
            type="button"
            style={styles.buttonPrimary}
            onClick={() => login.mutate()}
            disabled={login.isPending}
          >
            {login.isPending ? 'Waiting for Nimiq Pay…' : 'Connect with Nimiq Pay'}
          </button>
          {login.isError ? <p style={styles.error}>{(login.error as Error).message}</p> : null}
        </section>
      ) : (
        <section style={styles.card}>
          <p style={styles.muted}>Open NIM Relay inside Nimiq Pay to sign in.</p>
          <a style={styles.buttonPrimary} href={nimiqPayDeepLink(origin)}>
            Open in Nimiq Pay
          </a>
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 'max(env(safe-area-inset-top), 24px) 24px max(env(safe-area-inset-bottom), 24px)',
    textAlign: 'center',
  },
  header: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 32, margin: 0 },
  tagline: { color: 'var(--color-text-muted)', margin: 0, maxWidth: 320 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
    minWidth: 260,
  },
  muted: { color: 'var(--color-text-muted)', margin: 0, fontSize: 14 },
  handle: { margin: 0, fontSize: 22, color: 'var(--color-text-primary)' },
  wallet: { margin: 0, fontSize: 12, color: 'var(--color-text-muted)', wordBreak: 'break-all' },
  buttonPrimary: {
    appearance: 'none',
    border: 'none',
    borderRadius: 12,
    padding: '14px 20px',
    fontSize: 16,
    fontWeight: 600,
    background: 'var(--color-gold-500)',
    color: '#1a1400',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  buttonSecondary: {
    appearance: 'none',
    border: '1px solid var(--color-text-muted)',
    borderRadius: 12,
    padding: '10px 18px',
    fontSize: 14,
    background: 'transparent',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
  },
  error: { color: '#ff6b6b', fontSize: 13, margin: 0, maxWidth: 280 },
}
