import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { chooseNoticeCopy, failureCopy, formatNim, sceneStateFor, verificationCopy, type CeremonySceneState } from './copy'
import type { HandoffOrchestrator, HandoffStage, LaunchParameters } from './machine'
import { RunnerPicker, type RunnerGroup } from './RunnerPicker'
import './handoff.css'

type ConfirmedStage = Extract<HandoffStage, { stage: 'confirmed' }>

interface HandoffCeremonyProps {
  machine: HandoffOrchestrator
  groups: RunnerGroup[]
  /** Baton value in Luna. */
  value: number
  onSceneState(state: CeremonySceneState): void
  onInvite(): void
  /** Called once the launch cinematic has played after server verification. */
  onDeparted(stage: ConfirmedStage): void
  /** Leave the handoff zone while keeping the baton. */
  onKeepBaton(): void
}

/** Launch cinematic length before the world takes over. */
const DEPARTURE_MS = 2600
const FULL_CHARGE_MS = 1100

export function HandoffCeremony({ machine, groups, value, onSceneState, onInvite, onDeparted, onKeepBaton }: HandoffCeremonyProps) {
  const stage = useSyncExternalStore(machine.subscribe, machine.getSnapshot)
  const sceneState = sceneStateFor(stage.stage)

  useEffect(() => {
    onSceneState(sceneState)
  }, [sceneState, onSceneState])

  // The cinematic timer belongs to the confirmed stage. A new onDeparted identity (every network refresh
  // re-renders the host) must not restart it, or a busy network holds the ceremony on "confirmed".
  const depart = useEffectEvent(onDeparted)
  useEffect(() => {
    if (stage.stage !== 'confirmed') return
    const timer = window.setTimeout(() => depart(stage), DEPARTURE_MS)
    return () => window.clearTimeout(timer)
  }, [stage])

  const amount = formatNim(value)

  switch (stage.stage) {
    case 'choose':
      return (
        <CeremonyFrame>
          <RunnerPicker groups={groups} notice={stage.notice ? chooseNoticeCopy(stage.notice) : null} onSelect={runner => machine.select(runner)} onInvite={onInvite} />
          <button type="button" className="handoff-link" onClick={onKeepBaton}>
            Keep the baton for now
          </button>
        </CeremonyFrame>
      )
    case 'aiming':
      return (
        <CeremonyFrame>
          <p className="handoff-eyebrow">Launch platform</p>
          <h2 className="handoff-title">
            Passing {amount}
            <span>to {stage.recipient.name}</span>
          </h2>
          <LaunchPad onThrow={launch => void machine.throwBaton(launch)} />
          <button type="button" className="handoff-link" onClick={() => machine.changeRunner()}>
            Choose a different runner
          </button>
        </CeremonyFrame>
      )
    case 'preparing':
      return (
        <CeremonyFrame tone="frozen">
          <h2 className="handoff-title">
            Passing {amount}
            <span>to {stage.recipient.name}</span>
          </h2>
          <p className="handoff-status">Locking the pass…</p>
        </CeremonyFrame>
      )
    case 'armed':
      return (
        <CeremonyFrame>
          <p className="handoff-eyebrow">Pass locked</p>
          <h2 className="handoff-title">
            Passing {formatNim(stage.intent.value)}
            <span>to {stage.intent.recipientName}</span>
          </h2>
          <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
            Approve in Nimiq Pay
          </button>
          <button type="button" className="handoff-link" onClick={() => void machine.cancelUnattempted()}>
            Choose a different runner
          </button>
        </CeremonyFrame>
      )
    case 'wallet':
      return (
        <CeremonyFrame tone="frozen">
          <h2 className="handoff-title">
            Passing {formatNim(stage.intent.value)}
            <span>to {stage.intent.recipientName}</span>
          </h2>
          <p className="handoff-status">Approve the pass in Nimiq Pay</p>
        </CeremonyFrame>
      )
    case 'paused':
      return (
        <CeremonyFrame>
          <h2 className="handoff-title">Pass paused</h2>
          <p className="handoff-body">The baton is still with you.</p>
          <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
            Approve again
          </button>
          <button type="button" className="handoff-link" onClick={() => void machine.cancelUnattempted()}>
            Choose a different runner
          </button>
        </CeremonyFrame>
      )
    case 'insufficient':
      return (
        <CeremonyFrame>
          <h2 className="handoff-title">This relay requires {formatNim(stage.intent.value)}</h2>
          <p className="handoff-body">Add NIM to your wallet, then approve again. The baton is still with you.</p>
          <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
            Approve again
          </button>
          <button type="button" className="handoff-link" onClick={onKeepBaton}>
            Keep the baton for now
          </button>
        </CeremonyFrame>
      )
    case 'recovery':
      return (
        <CeremonyFrame tone="frozen">
          <RecoveryPanel invalidHash={stage.invalidHash} onSubmit={hash => void machine.submitRecoveredHash(hash)} />
        </CeremonyFrame>
      )
    case 'in-flight':
      return (
        <CeremonyFrame tone="frozen">
          <p className="handoff-eyebrow live">Nimiq network</p>
          <h2 className="handoff-title">Handoff in flight</h2>
          <p className="handoff-body">
            {stage.slow
              ? 'Confirmation is taking longer than usual. You can leave; the relay keeps checking and confirms it automatically.'
              : `Waiting for the network to confirm your pass to ${stage.intent.recipientName}.`}
          </p>
          {stage.slow && (
            <button type="button" className="handoff-secondary" onClick={() => void machine.checkAgain()}>
              Check again
            </button>
          )}
        </CeremonyFrame>
      )
    case 'not-verified':
      return (
        <CeremonyFrame>
          <h2 className="handoff-title">Handoff not verified</h2>
          <p className="handoff-body">{verificationCopy(stage.reason)}</p>
          <p className="handoff-muted">The baton stays with you until a matching transfer is verified.</p>
          <button type="button" className="handoff-link" onClick={onKeepBaton}>
            Back to the journey
          </button>
        </CeremonyFrame>
      )
    case 'confirmed':
      return (
        <CeremonyFrame tone="launch">
          <p className="handoff-eyebrow live">Verified on Nimiq</p>
          <h2 className="handoff-title">Handoff confirmed</h2>
        </CeremonyFrame>
      )
    case 'failed':
      return (
        <CeremonyFrame>
          <h2 className="handoff-title">Pass not locked</h2>
          <p className="handoff-body">{failureCopy(stage.message)}</p>
          <button type="button" className="handoff-link" onClick={onKeepBaton}>
            Back to the journey
          </button>
        </CeremonyFrame>
      )
  }
}

function CeremonyFrame({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'frozen' | 'launch' }) {
  return (
    <div className={`handoff-frame handoff-${tone}`} role="dialog" aria-modal="false" aria-live="polite">
      {children}
    </div>
  )
}

function RecoveryPanel({ invalidHash, onSubmit }: { invalidHash: boolean; onSubmit(hash: string): void }) {
  const [hash, setHash] = useState('')
  return (
    <form
      className="handoff-recovery"
      onSubmit={event => {
        event.preventDefault()
        onSubmit(hash)
      }}
    >
      <h2 className="handoff-title">Check your wallet</h2>
      <p className="handoff-body">Nimiq Pay didn’t tell us whether the pass was sent. Don’t send it again. Open your wallet activity and paste the transaction reference.</p>
      <label className="handoff-label">
        Transaction reference
        <input value={hash} onChange={event => setHash(event.target.value)} autoComplete="off" spellCheck={false} inputMode="text" />
      </label>
      {invalidHash && <p className="handoff-notice">That doesn’t look like a Nimiq transaction reference.</p>}
      <button type="submit" className="handoff-primary" disabled={!hash.trim()}>
        Verify the pass
      </button>
    </form>
  )
}

interface Charge {
  pointerId: number
  startedAt: number
  startY: number
  y: number
}

/** Hold to charge, drag up to raise the arc, release to throw. */
function LaunchPad({ onThrow }: { onThrow(launch: LaunchParameters): void }) {
  const charge = useRef<Charge | null>(null)
  const [level, setLevel] = useState(0)
  const charging = level > 0

  useEffect(() => {
    if (!charging) return
    let frame = 0
    const tick = () => {
      const active = charge.current
      if (!active) return
      setLevel(Math.min(1, (performance.now() - active.startedAt) / FULL_CHARGE_MS) || 0.001)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [charging])

  const release = () => {
    const active = charge.current
    if (!active) return
    charge.current = null
    setLevel(0)
    const held = Math.min(1, (performance.now() - active.startedAt) / FULL_CHARGE_MS)
    const power = Math.round(30 + held * 70)
    const angle = Math.max(15, Math.min(75, Math.round(45 + (active.startY - active.y) / 4)))
    if ('vibrate' in navigator) navigator.vibrate(24)
    onThrow({ angle, power })
  }

  return (
    <div className="handoff-launchpad">
      <button
        type="button"
        className="handoff-pad"
        style={{ '--charge': level } as React.CSSProperties}
        aria-label="Hold to charge the throw, release to pass the baton"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          charge.current = { pointerId: event.pointerId, startedAt: performance.now(), startY: event.clientY, y: event.clientY }
          setLevel(0.001)
        }}
        onPointerMove={event => {
          if (charge.current?.pointerId === event.pointerId) charge.current.y = event.clientY
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          charge.current = null
          setLevel(0)
        }}
        onKeyDown={event => {
          if ((event.key === ' ' || event.key === 'Enter') && !charge.current && !event.repeat) {
            event.preventDefault()
            charge.current = { pointerId: -1, startedAt: performance.now(), startY: 0, y: 0 }
            setLevel(0.001)
          }
        }}
        onKeyUp={event => {
          if (event.key === ' ' || event.key === 'Enter') release()
        }}
      >
        <span className="handoff-pad-ring" aria-hidden="true" />
        <span className="handoff-pad-core" aria-hidden="true" />
      </button>
      <p className="handoff-hint">{level > 0 ? 'Release to throw' : 'Hold the baton. Release to throw.'}</p>
    </div>
  )
}
