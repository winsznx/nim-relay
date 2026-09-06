import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CHALLENGE_IDS, scoreState, totalTicks, type ChallengeId } from '@nim-relay/game-engine'
import { GameController } from './controller'
import { mountRenderer } from './renderer'
import './game.css'

const challenges: Record<ChallengeId, { name: string; description: string; instruction: string; glyph: string }> = {
  stabilize: { name: 'Stabilize', description: 'Find your balance.', instruction: 'Hold to build energy. Release to ease off. Stay inside the cyan corridor.', glyph: '◉' },
  slipstream: { name: 'Slipstream', description: 'Thread the moving gates.', instruction: 'Hold to steer right. Release to steer left. Cross each gate at its center.', glyph: '≋' },
  'pulse-sync': { name: 'Pulse Sync', description: 'Feel the signal.', instruction: 'Tap when the expanding ring meets the gold ring. Release between pulses.', glyph: '⌁' },
  sling: { name: 'Sling', description: 'Charge. Aim. Release.', instruction: 'Hold to charge. Release toward the top target with power in the cyan band, near the timing marker. One shot per cycle.', glyph: '↗' },
  redline: { name: 'Redline', description: 'Bring it back from the edge.', instruction: 'Hold to move right. Release to move left. Recover into the cyan band and stay there.', glyph: '⋮' },
}
const format = (value: number) => value.toLocaleString('en-US')
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase())

export function GamePage() {
  const [selected, setSelected] = useState<ChallengeId>('stabilize')
  const [active, setActive] = useState<ChallengeId | null>(null)
  return <main className="relay-game">
    <header className="game-header"><a href="/play" className="game-brand" aria-label="NIM Relay solo"><span className="brand-hex">⬡</span> NIM <strong>Relay</strong></a><span className="solo-pill">Solo practice</span></header>
    {active ? <Run key={active} challenge={active} onChoose={() => setActive(null)} /> : <section className="challenge-picker">
      <div className="picker-intro"><span className="hero-hex" aria-hidden="true">⬡</span><h1>Your next<br /><em>20 seconds.</em></h1><p>One baton. Five ways to find your flow.<br />No sign-in needed. Just you and the signal.</p></div>
      <div className="challenge-list" role="group" aria-label="Choose a challenge">{CHALLENGE_IDS.map(id => <button type="button" key={id} aria-label={challenges[id].name} aria-pressed={selected === id} className={`challenge-option ${selected === id ? 'selected' : ''}`} onClick={() => setSelected(id)}><span className="challenge-glyph" aria-hidden="true">{challenges[id].glyph}</span><span><strong>{challenges[id].name}</strong><small>{challenges[id].description}</small></span><span className="selection-dot" /></button>)}</div>
      <div className="picker-start"><p>{challenges[selected].instruction}</p><button className="game-primary" type="button" onClick={() => setActive(selected)}>Start challenge</button><small>Touch & hold or Space · P pause · R restart</small></div>
    </section>}
    <footer className="game-footer">Baton Physics <span>Local practice · scores stay on this device</span></footer>
  </main>
}

function Run({ challenge, onChoose }: { challenge: ChallengeId; onChoose: () => void }) {
  const [controller] = useState(() => new GameController(challenge))
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const canvasHost = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState('')
  const { state, phase, result, ghost, ghostScore } = snapshot
  const currentScore = scoreState(state).score
  const liveDelta = ghost ? currentScore - scoreState(ghost).score : 0
  const progress = Math.floor(state.tick * 100 / totalTicks(controller.config))
  const info = challenges[challenge]

  useEffect(() => {
    const host = canvasHost.current
    if (!host) return
    let cancelled = false
    let dispose: (() => void) | undefined
    void mountRenderer(host, controller).then(cleanup => {
      if (cancelled) cleanup()
      else { dispose = cleanup; controller.start() }
    }).catch((error: unknown) => {
      if (!cancelled) setRenderError(error instanceof Error ? error.message : 'Renderer unavailable')
    })
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) controller.keyboard(true) }
      if (event.code === 'KeyP' && !event.repeat) { event.preventDefault(); if (controller.getSnapshot().phase === 'paused') controller.resume(); else controller.pause() }
      if (event.code === 'KeyR' && !event.repeat) { event.preventDefault(); controller.start() }
    }
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') { event.preventDefault(); controller.keyboard(false) } }
    const pause = () => controller.pause()
    const visibility = () => { if (document.hidden) controller.pause() }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', pause)
    window.addEventListener('orientationchange', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cancelled = true; dispose?.(); controller.pause()
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', pause); window.removeEventListener('orientationchange', pause)
      document.removeEventListener('visibilitychange', visibility)
      document.documentElement.classList.remove('game-active')
    }
  }, [controller])

  useEffect(() => {
    document.documentElement.classList.toggle('game-active', phase === 'playing' || phase === 'countdown' || phase === 'paused')
    return () => document.documentElement.classList.remove('game-active')
  }, [phase])

  return <section className="run-shell">
    <div className="run-heading"><div><p className="run-mode">20 second challenge</p><h1>{info.name}</h1></div><button className="game-secondary pause-button" type="button" onClick={phase === 'paused' ? controller.resume : controller.pause} disabled={phase === 'results' || phase === 'ready'}>{phase === 'paused' ? 'Resume' : 'Pause'}</button></div>
    <div className="game-hud"><div><span>Progress</span><strong data-testid="hud-progress">{progress}<small>%</small></strong></div><div><span>Combo</span><strong>{state.combo}<small>×</small></strong></div><div><span>Streak</span><strong>{state.streak}</strong></div></div>
    {ghost && <div className="ghost-strip" data-testid="ghost"><span><i /> Previous run <small>Local replay · {format(ghostScore ?? 0)}</small></span><strong>{liveDelta >= 0 ? '+' : '−'}{format(Math.abs(liveDelta))}</strong></div>}
    <div className="game-stage" data-testid="game-stage" data-tick={state.tick} data-phase={phase} data-challenge={challenge} data-position={state.position} data-target={state.target} data-velocity={state.velocity} data-input={state.lastInput}>
      <div ref={canvasHost} className="game-canvas" aria-label={`${info.name} game field`} />
      {phase === 'playing' && <div className={`field-caption field-caption-${challenge}`} aria-hidden="true"><span>{challenge === 'stabilize' ? 'Find the perfect zone' : challenge === 'sling' ? 'Charge • aim • release' : challenge === 'pulse-sync' ? 'Tap on the gold ring' : challenge === 'slipstream' ? 'Meet the gate' : 'Recover your balance'}</span><strong>{Math.max(0, Math.ceil((totalTicks(controller.config) - state.tick) / 60))}<small>s</small></strong></div>}
      {phase === 'countdown' && <div className="stage-overlay" data-testid="countdown"><span>Find your rhythm</span><strong key={snapshot.countdown} className="countdown-number">{snapshot.countdown}</strong></div>}
      {phase === 'paused' && <div className="stage-overlay"><span>Take a breath</span><h2>Paused</h2><p>Your run will wait.</p></div>}
      {renderError && <div className="stage-overlay" role="alert"><h2>Unable to start graphics</h2><p>{renderError}</p><button type="button" className="game-secondary" onClick={onChoose}>Choose challenge</button></div>}
    </div>
    {phase !== 'results' && <div className="game-controls"><p>{info.instruction}</p><button type="button" data-testid="action-pad" data-held={String(snapshot.held)} className={`action-pad ${snapshot.held ? 'is-held' : ''}`} disabled={phase !== 'playing'} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); controller.pointer(event.pointerId, true) }} onPointerUp={event => { controller.pointer(event.pointerId, false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={event => controller.pointer(event.pointerId, false)} onLostPointerCapture={event => controller.pointer(event.pointerId, false)} onContextMenu={event => event.preventDefault()}>{challenge === 'pulse-sync' ? 'Tap to sync' : snapshot.held ? 'Release' : 'Tap & hold'}<small>{challenge === 'sling' ? 'Charge your shot' : 'Space on keyboard'}</small></button><div className="run-actions"><button type="button" onClick={controller.start}>Restart</button><button type="button" onClick={onChoose}>Choose challenge</button></div></div>}
    {result && <section className="results-panel" data-testid="results" aria-label="Run results"><p>Run complete</p><h2>{format(result.score)}<small>points</small></h2>{ghostScore !== null && <p className="result-delta">{result.score >= ghostScore ? '+' : '−'}{format(Math.abs(result.score - ghostScore))} vs previous run</p>}<dl className="score-breakdown">{Object.entries(result.breakdown).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value > 0 ? '+' : ''}{format(value)}</dd></div>)}</dl><div className="result-actions"><button className="game-primary" type="button" onClick={controller.start}>Play again</button><button className="game-secondary" type="button" onClick={onChoose}>Choose challenge</button></div><p className="local-note">Replayed locally with the same engine. Not server-verified.</p><details><summary>Run trace & performance</summary><p>Frame intervals: {snapshot.metrics.averageMs.toFixed(2)} ms average / {snapshot.metrics.p95Ms.toFixed(2)} ms p95. {snapshot.metrics.frames} frames. Up to {snapshot.metrics.maxDrawCalls} draw calls per frame at {snapshot.metrics.dpr}× DPR ({snapshot.metrics.renderer}).</p><p>Measured with requestAnimationFrame and WebGL draw-call counters. This measures this session, not device certification.</p><pre data-testid="input-trace">{JSON.stringify({ ...controller.config, inputTrace: snapshot.trace }, null, 2)}</pre><output data-testid="frame-metrics">{JSON.stringify(snapshot.metrics)}</output></details></section>}
  </section>
}
