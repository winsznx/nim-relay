import { useEffect, useRef, useState } from 'react'
import type { BatonAtlas } from '@nim-relay/shared'
import { linkProps, pathFor } from '../shell/router'
import { Button } from '../shell/ui/Button'
import { SectionHeader } from '../shell/ui/primitives'
import { formatDateTime } from '../relays/format'
import { playAtlasFlight } from '../world/globe-bridge'
import { journeySteps, stationName } from './model'
import './atlas.css'

/**
 * The baton's journey across the Relay Atlas, hop by hop. The scrubber flies the globe along the chosen hop; Replay
 * flies every hop in order.
 */
export function AtlasJourney({ atlas, relayCode }: { atlas: BatonAtlas; relayCode: string }) {
  const steps = journeySteps(atlas.journey)
  const [index, setIndex] = useState(Math.max(0, steps.length - 1))
  const [replaying, setReplaying] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  if (steps.length === 0) return null
  const selected = steps[Math.min(index, steps.length - 1)]!

  const scrubTo = (next: number) => {
    setIndex(next)
    const step = steps[next]
    if (step) void playAtlasFlight({ from: step.from, to: step.to, kind: step.kind === 'grant' ? 'grant' : 'handoff' })
  }

  const replay = async () => {
    setReplaying(true)
    for (let at = 0; at < steps.length && alive.current; at++) {
      const step = steps[at]!
      setIndex(at)
      await playAtlasFlight({ from: step.from, to: step.to, kind: step.kind === 'grant' ? 'grant' : 'handoff' })
    }
    if (alive.current) setReplaying(false)
  }

  return (
    <section className="nr-section" aria-labelledby="atlas-journey" data-tour="atlas-journey">
      <SectionHeader
        id="atlas-journey"
        title="Across the Atlas"
        detail={`From ${stationName(steps[0]!.from)}. Stations are game-world destinations, not where runners are.`}
        action={
          steps.length > 1 ? (
            <Button variant="secondary" size="sm" busy={replaying} onClick={() => void replay()}>
              Replay
            </Button>
          ) : undefined
        }
      />
      {steps.length > 1 && (
        <div className="nr-atlas-journey__scrub">
          <label className="nr-visually-hidden" htmlFor="atlas-journey-scrubber">
            Journey hop
          </label>
          <input id="atlas-journey-scrubber" type="range" min={0} max={steps.length - 1} step={1} value={index} disabled={replaying} onChange={event => scrubTo(Number(event.target.value))} aria-valuetext={selected.title} />
          <p className="nr-atlas-journey__now" aria-live="polite">
            {selected.title}
          </p>
          <p className="nr-atlas-journey__detail">{selected.detail}</p>
        </div>
      )}
      <ol className="nr-atlas-steps">
        {steps.map((step, at) => (
          <li key={step.key} className="nr-atlas-step" data-current={at === index} data-progress={step.inProgress}>
            <div>
              <p className="nr-atlas-step__title">{step.title}</p>
              <p className="nr-atlas-step__meta">
                {step.detail}
                {step.backfilled ? '. Raced before the Atlas, placed on its Genesis route' : ''}
                {step.inProgress ? '' : `. ${formatDateTime(step.at)}`}
                {step.txHash && (
                  <>
                    {' '}
                    <a {...linkProps(`${pathFor('proofRelay', { code: relayCode })}#tx-${step.txHash}`)}>Transaction</a>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
