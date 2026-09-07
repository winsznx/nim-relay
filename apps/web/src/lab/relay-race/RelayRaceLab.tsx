import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RaceController } from './controller'
import { mountRaceScene } from './scene'
import './lab.css'

const secs = (n: number): string => `${n.toFixed(2)}s`

export function RelayRaceLab() {
  const [controller] = useState(() => new RaceController())
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  const dragging = useRef(false)
  const kbSteer = useRef(0)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dispose: (() => void) | undefined
    try {
      dispose = mountRaceScene(el, controller)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'scene failed to start')
    }
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { kbSteer.current = -1; controller.setSteer(-1) }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { kbSteer.current = 1; controller.setSteer(1) }
      if (e.code === 'KeyR' && !e.repeat) controller.start()
    }
    const ku = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) { kbSteer.current = 0; controller.setSteer(0) }
    }
    const blur = () => { dragging.current = false; controller.setSteer(0) }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    return () => {
      dispose?.()
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', blur)
    }
  }, [controller])

  const steerTo = (clientX: number) => {
    const w = window.innerWidth
    // full-screen: thumb X maps to lane target, with a touch of easing at the edges
    const n = (clientX / w) * 2 - 1
    controller.setSteer(Math.max(-1, Math.min(1, n * 1.15)))
  }

  return (
    <main className="rc">
      <div className="rc-scene" ref={host} />

      {(snap.phase === 'racing' || snap.phase === 'countdown') && (
        <>
          <div className="rc-hud">
            <div className="rc-time">{secs(snap.elapsedSec)}</div>
            <div className={`rc-delta ${snap.ghostDeltaSec >= 0 ? 'up' : 'down'}`}>
              {snap.ghostDeltaSec >= 0 ? '+' : ''}{snap.ghostDeltaSec.toFixed(2)}s <span>{snap.ghostName}</span>
            </div>
          </div>
          <div className="rc-progress">
            <div className="rc-progress-fill" style={{ width: `${snap.progress * 100}%` }} />
            <div className="rc-ghost-pip" style={{ left: `${snap.ghostProgress * 100}%` }} />
          </div>
          <div className="rc-heat">
            <div className={`rc-heat-fill ${snap.heatPct > 60 ? 'hot' : ''}`} style={{ height: `${snap.heatPct}%` }} />
            <span>FLOW</span>
          </div>
        </>
      )}

      {snap.phase === 'countdown' && <div className="rc-over"><strong>{snap.countdown}</strong></div>}

      {snap.phase === 'ready' && (
        <div className="rc-over rc-start">
          <h1>Relay Run</h1>
          <p>Carry the baton. Steer through the gold gates and race {snap.ghostName} to the finish.</p>
          <button type="button" onClick={() => controller.start()}>Race</button>
          <small>touch and slide to steer · clean gates keep you fast · red = slow</small>
        </div>
      )}

      {snap.phase === 'handoff' && <div className="rc-over rc-handoff"><strong>HANDOFF</strong><em>baton away</em></div>}

      {snap.phase === 'results' && snap.result && snap.report && (
        <div className="rc-over rc-results" data-testid="results">
          {snap.divergence && <p className="rc-warn">⚠ replay divergence</p>}
          <div className="rc-final-time">{secs(snap.result.timeSeconds)}</div>
          <p className={`rc-verdict ${snap.report.ghostResult === 'won' ? 'won' : 'lost'}`}>
            {snap.report.ghostResult === 'won'
              ? `You beat ${snap.ghostName} by ${(snap.ghostResultSec - snap.result.timeSeconds).toFixed(2)}s`
              : `${snap.ghostName} beat you by ${(snap.result.timeSeconds - snap.ghostResultSec).toFixed(2)}s`}
          </p>
          <div className="rc-stats">
            <div><span>{snap.result.perfectGates} / {snap.result.totalGates}</span><label>perfect gates</label></div>
            <div><span>{snap.result.shortcuts}</span><label>shortcut{snap.result.shortcuts === 1 ? '' : 's'}</label></div>
            <div><span>{snap.result.boostControlPct}%</span><label>flow</label></div>
          </div>
          <button type="button" className="rc-again" onClick={() => controller.start()}>Run again</button>
          <details>
            <summary>lab instrumentation</summary>
            <pre data-testid="run-report">{JSON.stringify(snap.report, null, 2)}</pre>
            <p>server replay hash <code>{snap.result.resultHash.slice(0, 16)}…</code> · live sim {snap.divergence ? 'DIVERGED' : 'matched'}</p>
          </details>
        </div>
      )}

      {err && <div className="rc-over"><h2>WebGL error</h2><p>{err}</p></div>}

      {(snap.phase === 'racing' || snap.phase === 'countdown') && (
        <div
          className="rc-steer"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; steerTo(e.clientX) }}
          onPointerMove={(e) => { if (dragging.current) steerTo(e.clientX) }}
          onPointerUp={(e) => { dragging.current = false; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
          onPointerCancel={() => { dragging.current = false }}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </main>
  )
}
