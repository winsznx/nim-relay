import { isRelayLegGhost, type BatonHandoff } from '@nim-relay/shared'
import { flowControlPercent } from '../../race/format'
import { useVerifiedReplay } from '../../relays/data'
import type { RelayView } from '../../relays/model'
import { useAction } from '../../shell/use-action'
import type { HandoffCard, ResultCard } from './layout'
import { shareCard } from './share'

interface LegShareProps {
  relay: RelayView
  handoffs: readonly BatonHandoff[]
  handoff: BatonHandoff
  playerId: string | null
}

/**
 * Share actions on a verified leg for the two runners in it: the handoff for
 * both, and the race result for the runner who rode the leg. The result's
 * figures come from the verified replay, loaded before the tap.
 */
export function LegShare({ relay, handoffs, handoff, playerId }: LegShareProps) {
  const action = useAction()
  const race = handoff.race?.completed ? handoff.race : null
  const rodeIt = playerId !== null && playerId === handoff.from.id
  const replay = useVerifiedReplay(rodeIt && race ? handoff.runId : null)
  const knownGhost = race?.ghostRunId ? handoffs.find(item => item.runId === race.ghostRunId)?.from.name : undefined
  const ghostReplay = useVerifiedReplay(rodeIt && race?.ghostRunId && knownGhost === undefined ? race.ghostRunId : null)
  if (playerId === null || (playerId !== handoff.from.id && playerId !== handoff.to.id)) return null

  const handoffCard: HandoffCard = {
    kind: 'handoff',
    from: { name: handoff.from.name, country: handoff.from.country },
    to: { name: handoff.to.name, country: handoff.to.country },
    leg: handoff.leg,
    batonName: relay.name,
    code: relay.code,
    valueLuna: handoff.value,
    network: handoff.network,
  }
  const verified = replay.data && isRelayLegGhost(replay.data) ? replay.data.result : null
  const ghostName = knownGhost ?? ghostReplay.data?.runner.name ?? null
  const resultCard: ResultCard | null =
    rodeIt && race
      ? {
          kind: 'result',
          runner: { name: handoff.from.name, handle: handoff.from.handle },
          world: race.world,
          timeMs: race.timeMs,
          ghost: race.ghostTimeMs !== null && ghostName ? { name: ghostName, timeMs: race.ghostTimeMs } : null,
          perfectGates: verified ? { hit: verified.metrics.perfectGates, total: verified.metrics.totalGates } : null,
          flowControl: verified ? flowControlPercent(verified.metrics, verified.ticks) : null,
          relay: { code: relay.code, name: relay.name, leg: handoff.leg },
        }
      : null
  const resultLoading = replay.isFetching || ghostReplay.isFetching

  return (
    <p className="nr-route__links">
      {resultCard && (
        <button type="button" className="nr-link-button" disabled={action.pending || resultLoading} onClick={() => action.run(() => shareCard(resultCard))}>
          Share result card
        </button>
      )}
      <button type="button" className="nr-link-button" disabled={action.pending} onClick={() => action.run(() => shareCard(handoffCard))}>
        Share handoff card
      </button>
    </p>
  )
}
