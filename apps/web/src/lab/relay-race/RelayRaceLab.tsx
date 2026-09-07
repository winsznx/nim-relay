import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RaceController } from './controller'
import { mountRaceScene } from './scene'
import './lab.css'

const secs = (n: number): string => `${n.toFixed(2)}s`

export function RelayRaceLab() {
  const [controller] = useState(() => new RaceController())
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')

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
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') controller.setSteer(-1)
      if (e.code === 'ArrowRight' || e.code === 'KeyD') controller.setSteer(1)
      if (e.code === 'Space') { e.preventDefault(); controller.setBoost(true) }
      if (e.code === 'KeyR' && !e.repeat) controller.start()
    }
    const ku = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) controller.setSteer(0)
      if (e.code === 'Space') controller.setBoost(false)
    }
    const blur = () => { controller.setSteer(0); controller.setBoost(false) }
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

  const steerFromPointer = (e: React.PointerEvent) => {
    const z = zone.current
    if (!z) return
    const r = z.getBoundingClientRect()
    controller.setSteer(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)))
  }

  const racing = snap.phase === 'racing' || snap.phase === 'countdown'
  const delta = snap.ghostDeltaSec

  return (
    <main className="rc">
      <div className="rc-scene" ref={host} />

      {racing && (
        <>
          <div className="rc-hud">
            <div className="rc-time">{secs(snap.elapsedSec)}</div>
            <div className={`rc-delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(2)}s <span>{snap.ghostName}</span>
            </div>
          </div>
          <div className="rc-progress">
            <div className="rc-progress-fill" style={{ width: `${snap.progress * 100}%` }} />
            <div className="rc-ghost-pip" style={{ left: `${snap.ghostProgress * 100}%` }} />
          </div>
          <div className="rc-heat">
            <div className={`rc-heat-fill ${snap.overheating ? 'over' : snap.heatPct > 75 ? 'hot' : ''}`} style={{ height: `${snap.heatPct}%` }} />
          </div>
        </>
      )}

      {snap.phase === 'countdown' && <div className="rc-over"><strong>{snap.countdown}</strong></div>}

      {snap.phase === 'ready' && (
        <div className="rc-over rc-start">
          <h1>Relay Run</h1>
          <p>Carry the baton. Race {snap.ghostName} to the handoff gate.</p>
          <button type="button" onClick={() => controller.start()}>Race</button>
          <small>drag to steer · hold to boost · release to cool</small>
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
            <div><span>{snap.result.boostControlPct}%</span><label>boost control</label></div>
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

      <div
        className={`rc-zone ${racing ? 'live' : ''}`}
        ref={zone}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); steerFromPointer(e); controller.setBoost(true) }}
        onPointerMove={(e) => { if (e.buttons > 0) steerFromPointer(e) }}
        onPointerUp={(e) => { controller.setBoost(false); controller.setSteer(0); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
        onPointerCancel={() => { controller.setBoost(false); controller.setSteer(0) }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </main>
  )
}
