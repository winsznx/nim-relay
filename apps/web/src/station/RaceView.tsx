import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { sendRelayHandoff, NimiqPayError } from '../lib/nimiq'
import * as api from './api'
import { StationController } from './controller'
import { RaceControls } from './controls'
import { mountRace } from './visuals'
import { RelayAudio } from './audio'
import { saveTransfer, readTransfer } from './transfer-store'
const worldNames = { coast: 'Sunbreak Coast', alpine: 'Cloudline Alps', metro: 'Midnight Metro', solar: 'Solar Frontier', ocean: 'Ocean Skyway' }
export type RaceSession = { controller: StationController; issued: api.IssuedRace | null }
export interface RaceViewProps {
 session: RaceSession; audio: RelayAudio | null; profile: api.StationProfile | undefined;
 couriers: api.StationSnapshot['rankings']; onExit: () => void; onReplay?: () => void; network?: string;
 onSubmit?: typeof api.submitRace; onPrepare?: typeof api.prepareHandoff; onConfirm?: typeof api.confirmHandoff;
 onAttempt?: (intent: api.HandoffIntent) => Promise<unknown>; onCancel?: (intent: api.HandoffIntent) => Promise<unknown>;
 onTransfer?: (intent: api.HandoffIntent) => void;
}
export function RaceView({ session, audio, profile, couriers, onExit, onReplay, network, onSubmit = api.submitRace, onPrepare = api.prepareHandoff, onConfirm = api.confirmHandoff, onAttempt, onTransfer }: RaceViewProps) {
  const { controller, issued } = session
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const submitted = useRef(false)
  const feedback = useRef({ hits: 0, gates: 0, misses: 0, near: 0, landings: 0, delta: 0 })
  const [receipt, setReceipt] = useState<api.SubmittedRace | null>(null)
  const [throwAngle, setThrowAngle] = useState(45)
  const [throwPower, setThrowPower] = useState(75)
  const [error, setError] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ intent: api.HandoffIntent; hash: string | null } | null>(null)
  const controls = useMemo(() => new RaceControls(controller), [controller])
  useEffect(() => { if (!host.current) return; return mountRace(host.current, controller, { world: controller.config.world, cosmetics: { ...profile?.equipped, handoffs: profile?.handoffs ?? 0 } }) }, [controller, profile])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName))) return
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault()
      controls.keyDown(event.key, event.repeat)
    }
    const up = (event: KeyboardEvent) => controls.keyUp(event.key)
    const blur = () => { controls.reset(); controller.pause() }
    const hide = () => { if (document.hidden) blur() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hide)
    return () => { controls.reset(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hide) }
  }, [controller, controls])
  useEffect(() => { if (snap.phase === 'racing') audio?.tick(snap.state.tick, snap.state.boosting === 1, controller.config.world) }, [snap.phase, snap.state.tick, snap.state.boosting, audio, controller])
  useEffect(() => {
    const metrics = snap.state.metrics, previous = feedback.current
    if (metrics.hazardsHit > previous.hits || metrics.missedGates > previous.misses) audio?.cue(false)
    else if (metrics.gates > previous.gates || metrics.nearMisses > previous.near || metrics.landings > previous.landings || (previous.delta > 0 && (snap.ghostDeltaSeconds ?? 0) <= 0)) audio?.cue(true)
    feedback.current = { hits: metrics.hazardsHit, gates: metrics.gates, misses: metrics.missedGates, near: metrics.nearMisses, landings: metrics.landings, delta: snap.ghostDeltaSeconds ?? 0 }
  }, [snap.state.metrics, snap.ghostDeltaSeconds, audio])
  useEffect(() => {
    if (controller.isPlayback || !snap.result || !issued || submitted.current || snap.divergence) return
    submitted.current = true
    void onSubmit(issued, snap.trace).then(setReceipt).catch(cause => { submitted.current = false; setError(cause instanceof Error ? cause.message : 'Could not save ride') })
  }, [snap.result, snap.trace, snap.divergence, issued, onSubmit, controller])
  async function handoff() {
    if (!receipt || controller.isPlayback) return
    setBusy(true); setError('')
    let transaction = pending
    try {
      if (!transaction) {
        const intent = await onPrepare(receipt.runId, recipient, { angle: throwAngle, power: throwPower })
        const stored = await readTransfer(intent.id)
        transaction = { intent, hash: intent.txHash ?? stored?.hash ?? null }
        setPending(transaction)
        controller.commitThrow(intent.throw?.angle ?? throwAngle, intent.throw?.power ?? throwPower)
      }
      if (!transaction.hash) {
        const stored = await readTransfer(transaction.intent.id)
        if (stored?.state === 'attempting') throw new Error('A wallet request was already opened. Check your wallet activity before trying again; do not send a second transfer.')
        await saveTransfer({ id: transaction.intent.id, hash: null, state: 'attempting' })
        await onAttempt?.(transaction.intent)
        const hash = await sendRelayHandoff(transaction.intent)
        transaction = { ...transaction, hash }
        setPending(transaction)
        await saveTransfer({ id: transaction.intent.id, hash, state: 'sent' })
      }
      const hash = transaction.hash
      if (!hash) throw new Error('Missing transaction reference.')
      const result = await onConfirm(transaction.intent.id, hash)
      if (result.status === 'verified') {
        await saveTransfer({ id: transaction.intent.id, hash, state: 'verified' })
        audio?.cue(true); controller.launch({ verifiedTransactionHash: hash })
        onTransfer?.(result.intent ?? { ...transaction.intent, txHash: hash, status: 'verified' })
      } else setError(result.status === 'pending' ? 'Your baton is on its way. Network confirmation is still pending; check again shortly.' : `The network could not verify this transfer: ${result.reason ?? 'Check your wallet activity.'}`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Handoff failed. Your journey is saved.'
      setError(message)
      if (cause instanceof NimiqPayError && cause.approvalDeclined && transaction && !transaction.hash) {
        await saveTransfer({ id: transaction.intent.id, hash: null, state: 'ready' })
        setError(`${message} Your pass is saved. You can retry approval for the same recipient.`)
      }

    } finally { setBusy(false) }
  }
  const progress = Math.min(100, snap.state.dist / snap.state.track.finishDist * 100)
  return <main className="station-app">
    <div className="station-scene" ref={host} />
    <header className="race-hud"><div className="station-topbar"><button className="station-pill" onClick={() => controller.pause()}>Ⅱ Pause</button><span>{worldNames[controller.config.world]}</span><span>{(snap.state.tick / 60).toFixed(1)}s</span></div><div className="race-progress" role="progressbar" aria-label="Route completed" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div><div className="race-stats"><span>{Math.round(snap.state.speed / 65536 * 60 * 3.6)} km/h</span>{snap.ghostName && <span>{snap.ghostName} {snap.ghostDeltaSeconds !== null ? `${snap.ghostDeltaSeconds > 0 ? '+' : ''}${snap.ghostDeltaSeconds.toFixed(2)}s` : ''}</span>}<div>HEAT <div className="heat-meter" role="meter" aria-label="Board heat" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.state.heat / 65536 * 100)}><div style={{ width: `${snap.state.heat / 65536 * 100}%` }} /></div></div></div></header>
    {snap.phase === 'racing' && !controller.isPlayback && <div className="race-controls" style={{ top: 230, touchAction: 'none', userSelect: 'none' }} onPointerDown={event => { if (controls.pointerDown(event.pointerId, event.clientX, event.clientY)) event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => controls.pointerMove(event.pointerId, event.clientX, event.clientY)} onPointerUp={event => controls.pointerUp(event.pointerId)} onPointerCancel={event => controls.pointerUp(event.pointerId)} onLostPointerCapture={event => controls.pointerUp(event.pointerId)}><span>DRAG TO STEER · HOLD TO BOOST · SWIPE ↑ JUMP / ↓ DUCK</span></div>}
    {snap.phase === 'ready' && <section className="race-modal"><p className="station-eyebrow">DEPARTURE READY</p><h1>{worldNames[controller.config.world]}</h1><p>Gold is opportunity. Red is danger.</p><p>Drag to steer. Hold to boost, release to cool.<br />Swipe up to jump. Swipe down to duck.</p><p className="station-muted">Keyboard: ← → steer · Space boost · ↑ jump · ↓ duck</p><button className="station-primary" onClick={() => { void audio?.unlock(); controller.start() }}>{controller.isPlayback ? 'Watch verified ride →' : 'Let’s ride →'}</button><button className="station-secondary" onClick={onExit}>Back to station</button></section>}
    {snap.phase === 'countdown' && <div className="race-countdown">{snap.countdown || 'GO'}</div>}
    {snap.phase === 'paused' && <section className="race-modal"><h2>Take a breath.</h2><button className="station-primary" onClick={() => controller.resume()}>Keep riding</button><button className="station-secondary" onClick={onExit}>Leave ride</button></section>}
    {(snap.phase === 'handoff' || snap.phase === 'results') && <section className="race-modal"><p className="station-eyebrow">{snap.result?.completed ? 'ARRIVAL' : 'RIDE COMPLETE'}</p><h1>{snap.result?.score.toLocaleString()}<small> points</small></h1><p>{receipt ? `+${receipt.xpEarned} XP · Level ${receipt.profile.level}` : controller.isPlayback ? 'Verified historic replay · No rewards' : issued ? 'Saving your ride…' : 'Practice ride'}</p>{snap.divergence && <p role="alert">This ride could not be verified. Please try again.</p>}{receipt?.qualifiedHandoff && snap.phase === 'handoff' && <><h3>Set your throw</h3><label>Arc {throwAngle}°<input aria-label="Throw arc" type="range" min={15} max={75} value={throwAngle} disabled={!!pending || busy} onChange={e => setThrowAngle(Number(e.target.value))} /></label><label>Power {throwPower}%<input aria-label="Throw power" type="range" min={30} max={100} value={throwPower} disabled={!!pending || busy} onChange={e => setThrowPower(Number(e.target.value))} /></label><h3>Who carries it next?</h3>{couriers.length > 0 && <select aria-label="Choose next courier" value={recipient} disabled={!!pending || busy} onChange={e => setRecipient(e.target.value)}><option value="">Choose a courier</option>{couriers.map(courier => <option key={courier.id} value={courier.id}>{courier.name}</option>)}</select>}<input aria-label="Next courier handle" placeholder="Next courier’s handle" value={recipient} disabled={!!pending} onChange={e => setRecipient(e.target.value)} /><p>Pass {pending ? pending.intent.value / 100000 : 1} NIM on {pending?.intent.network ?? network ?? 'the relay network'}. Review the recipient in Nimiq Pay.</p><button className="station-primary" disabled={busy || (!pending && !recipient.trim())} onClick={() => void handoff()}>{busy ? 'Waiting for Nimiq Pay…' : pending?.hash ? 'Check confirmation' : 'Pass the baton →'}</button></>}{receipt && <button className="station-secondary" disabled={!recipient.trim() || busy} onClick={() => { setBusy(true); void api.challengeRunner(recipient, receipt.runId).then(() => setError('Challenge sent.')).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not send challenge')).finally(() => setBusy(false)) }}>Challenge this courier</button>}{receipt && !receipt.qualifiedHandoff && <input aria-label="Challenge courier handle" placeholder="Challenge a courier by handle" value={recipient} onChange={e => setRecipient(e.target.value)} />}{error && <p className="station-error" role="status">{error}</p>}{onReplay && <button className="station-primary" onClick={onReplay}>{controller.isPlayback ? 'Race this ghost' : 'Ride again'}</button>}<button className="station-secondary" onClick={onExit}>Return to world</button>{!issued && !controller.isPlayback && snap.phase === 'handoff' && <button className="station-secondary" onClick={() => controller.launch({ practice: true })}>Celebrate ride</button>}<p className="station-muted">{profile ? `${profile.name} · ${worldNames[controller.config.world]}` : 'Keep exploring. Every line is a new possibility.'}</p></section>}
    {snap.phase === 'launch' && <div className="race-countdown">{pending ? 'Baton passed.' : 'Beautiful ride.'}</div>}
  </main>
}

