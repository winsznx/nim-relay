import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RelayRunController } from './controller'
import { mountRelayRenderer } from './renderer'
import './lab.css'

const fmt = (n: number): string => n.toLocaleString('en-US')

export function RelayRunLab() {
  const [controller] = useState(() => new RelayRunController())
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void mountRelayRenderer(el, controller)
      .then((d) => { if (cancelled) d(); else dispose = d })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'renderer failed'))

    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') controller.setSteer(-1)
      if (e.code === 'ArrowRight' || e.code === 'KeyD') controller.setSteer(1)
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); controller.setPressed(true) }
      if (e.code === 'KeyR' && !e.repeat) controller.start(true)
      if (e.code === 'KeyG' && !e.repeat) controller.toggleGhost()
    }
    const keyup = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) controller.setSteer(0)
      if (e.code === 'Space') controller.setPressed(false)
    }
    const blur = () => { controller.setSteer(0); controller.setPressed(false) }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      cancelled = true
      dispose?.()
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
    }
  }, [controller])

  const zonePointer = (e: React.PointerEvent) => {
    const z = zone.current
    if (!z) return
    const rect = z.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    controller.setSteer(Math.max(-1, Math.min(1, nx)))
  }

  const playing = snap.phase === 'playing' || snap.phase === 'countdown'

  return (
    <main className="rr-lab">
      <div className="rr-field" ref={host} />

      <div className="rr-hud">
        <div className="rr-stat"><span>Score</span><strong>{fmt(snap.liveScore)}</strong></div>
        <div className="rr-stat"><span>Combo</span><strong>{snap.combo}×</strong></div>
        {!snap.ghostHidden && (
          <div className={`rr-stat rr-ghost ${snap.liveScore >= snap.ghostScore ? 'ahead' : 'behind'}`}>
            <span>vs ghost</span>
            <strong>{snap.liveScore >= snap.ghostScore ? '+' : '−'}{fmt(Math.abs(snap.liveScore - snap.ghostScore))}</strong>
          </div>
        )}
      </div>

      <div className="rr-heat">
        <div className={`rr-heat-fill ${snap.heatPct >= 78 ? 'greedy' : ''}`} style={{ height: `${snap.heatPct}%` }} />
        <span>HEAT</span>
      </div>

      {snap.phase === 'countdown' && <div className="rr-overlay"><strong>{snap.countdown}</strong><em>catch the baton</em></div>}

      {snap.phase === 'ready' && (
        <div className="rr-overlay rr-start">
          <h1>Relay Run <span>· lab</span></h1>
          <p>Steer the baton with your thumb along the bottom. Tap &amp; hold to catch, sync and sling.</p>
          <button type="button" onClick={() => controller.start(true)}>Start run</button>
          <small>Keyboard: ←/→ steer · Space action · R restart · G toggle ghost</small>
        </div>
      )}

      {snap.phase === 'results' && snap.result && snap.report && (
        <div className="rr-overlay rr-results" data-testid="results">
          <p>Run complete{snap.divergence ? ' · ⚠ DIVERGENCE' : ''}</p>
          <h2>{fmt(snap.result.score)}</h2>
          <p className={snap.report.ghostResult === 'won' ? 'rr-won' : 'rr-lost'}>
            {snap.report.ghostResult === 'no-ghost' ? 'ghost hidden' : snap.report.ghostResult === 'won' ? `beat the ghost by ${fmt(snap.result.score - snap.ghostScore)}` : `ghost won by ${fmt(snap.ghostScore - snap.result.score)}`}
          </p>
          <dl>
            {Object.entries(snap.result.breakdown).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{fmt(v as number)}</dd></div>
            ))}
          </dl>
          <div className="rr-actions">
            <button type="button" onClick={() => controller.start(true)}>Run again</button>
            <button type="button" className="ghost" onClick={() => controller.toggleGhost()}>{snap.ghostHidden ? 'Show' : 'Hide'} ghost</button>
          </div>
          <details>
            <summary>Instrumentation</summary>
            <pre data-testid="run-report">{JSON.stringify(snap.report, null, 2)}</pre>
            <pre data-testid="lab-aggregate">{JSON.stringify(controller.aggregate, null, 2)}</pre>
            <p className="rr-note">Deterministic replay: server-side <code>replayRelayRun()</code> of this trace produced hash <code>{snap.result.resultHash.slice(0, 16)}…</code>; live sim {snap.divergence ? 'DIVERGED' : 'matched'}.</p>
          </details>
        </div>
      )}

      {err && <div className="rr-overlay"><h2>Renderer error</h2><p>{err}</p></div>}

      <div
        className={`rr-zone ${playing ? 'live' : ''}`}
        ref={zone}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); zonePointer(e); controller.setPressed(true) }}
        onPointerMove={(e) => { if (e.buttons > 0) zonePointer(e) }}
        onPointerUp={(e) => { controller.setPressed(false); controller.setSteer(0); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
        onPointerCancel={() => { controller.setPressed(false); controller.setSteer(0) }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span>{playing ? 'thumb here — slide to steer, press to act' : ''}</span>
      </div>
    </main>
  )
}
