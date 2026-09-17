import { useEffect, type ReactNode } from 'react'
import type { NetworkSnapshot } from '@nim-relay/shared'
import type { Player } from '../../lib/auth-api'
import { flyToRelay } from '../world/globe-bridge'
import { playerMessage } from '../shell/errors'
import { navigate, pathFor, useLocation } from '../shell/router'
import { useRequireRunner, useSession } from '../shell/session'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Icon } from '../shell/ui/Icon'
import { EmptyState, Loading, Pill, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { batonMilestone } from '../social/cards/layout'
import { ShareCardButton } from '../social/cards/ShareCardButton'
import * as api from './api'
import { BatonHero } from './BatonHero'
import { useNetwork, useNow, useRefreshNetwork, useRelay } from './data'
import { countryName, formatCount, formatDuration, formatNim, formatSince, networkLabel } from './format'
import { JourneyRecords, JourneyRoute } from './JourneyRoute'
import { useFreshLive } from './live'
import { LiveLegPanel } from './LiveLegPanel'
import { practicePath } from './paths'
import { journeyHeadline, type RelayView } from './model'
import { PendingPass } from '../handoff/PendingPass'
import { useDeparture } from '../leg/departure'
import { playArrival } from '../world/globe-bridge'
import './relays.css'

function statusPill(relay: RelayView) {
  if (relay.status === 'active') return <Pill tone="live">Live</Pill>
  if (relay.status === 'stranded') return <Pill tone="danger">Waiting on holder</Pill>
  return <Pill>Finished</Pill>
}

function NextLeg({ relay, player }: { relay: RelayView; player: Player | null }) {
  const requireRunner = useRequireRunner()
  const action = useAction()
  const refresh = useRefreshNetwork()
  if (relay.status === 'completed') return null
  const holder = relay.holder.name
  let body: string
  let control: ReactNode = null
  if (player?.id === relay.holder.id) {
    body = relay.next
      ? `The next pass is reserved for ${relay.next.name}${relay.next.accepted ? ', who accepted' : ', who hasn’t accepted yet'}. Finish your leg, then pass the baton.`
      : 'Finish your leg, then choose who carries the baton next.'
  } else if (relay.next && relay.next.id === player?.id) {
    body = relay.next.accepted ? `You’re next. ${holder} passes the baton to you after their leg.` : `${holder} reserved the next leg for you. Accept it so the reservation doesn’t lapse.`
    if (!relay.next.accepted) {
      control = (
        <Button
          variant="primary"
          busy={action.pending}
          onClick={() =>
            action.run(async () => {
              await api.acceptReservation(relay.id)
              refresh()
            })
          }
        >
          Accept next leg
        </Button>
      )
    }
  } else if (player) {
    body = relay.next ? `${holder} has reserved the next pass for ${relay.next.name}. Share your runner link to be picked for a later leg.` : `${holder} chooses who carries the next leg. Share your runner link so they can pass it to you.`
    control = (
      <Button variant="secondary" busy={action.pending} onClick={() => action.run(() => shareLink(`Pass me ${relay.name}`, pathFor('runner', { handle: player.handle })))}>
        Share my runner link
      </Button>
    )
  } else {
    body = `${holder} chooses who carries the next leg. Set up your runner so they can pass the baton to you.`
    control = (
      <Button variant="primary" onClick={() => requireRunner(`Sign in to join the next leg of ${relay.name}.`, () => undefined)}>
        Set up my runner
      </Button>
    )
  }
  return (
    <section className="nr-panel" id="next-leg" aria-labelledby="next-leg-title">
      <h3 id="next-leg-title">Next leg</h3>
      <p>{body}</p>
      {control && <div className="nr-actions">{control}</div>}
    </section>
  )
}

function QuickMatch({ relay, snapshot, player }: { relay: RelayView; snapshot: NetworkSnapshot | undefined; player: Player | null }) {
  const action = useAction()
  const refresh = useRefreshNetwork()
  const quick = relay.quick
  if (!quick) return null
  const nameOf = (id: string) => (id === player?.id ? 'You' : (snapshot?.runners.find(runner => runner.id === id)?.name ?? 'Runner'))
  return (
    <section className="nr-section" aria-labelledby="quick-match">
      <SectionHeader id="quick-match" title={`Best of ${quick.bestOf}`} detail={`${quick.rounds} of ${quick.bestOf} rounds played. No wager and no prize money.`} />
      <div className="nr-scoreboard">
        {quick.players.map(id => (
          <div key={id} className={`nr-scoreboard__side${quick.winnerId === id ? ' nr-scoreboard__side--winner' : ''}`}>
            <span className="nr-scoreboard__score nr-num">{quick.scores[id] ?? 0}</span>
            <span className="nr-scoreboard__name">{nameOf(id)}</span>
          </div>
        ))}
      </div>
      {relay.status === 'completed' && player && quick.players.includes(player.id) && (
        <div className="nr-actions">
          <Button
            variant="primary"
            busy={action.pending}
            onClick={() =>
              action.run(async () => {
                const rematch = await api.rematchBaton(relay.id)
                refresh()
                navigate(pathFor('relay', { code: rematch.baton.code }))
              })
            }
          >
            Rematch
          </Button>
        </div>
      )}
    </section>
  )
}

export function JourneyScreen({ code, entryKey }: { code: string; entryKey: string }) {
  const { relay, detail, query } = useRelay(code)
  const { player } = useSession()
  const { snapshot } = useNetwork()
  const location = useLocation()
  const action = useAction()
  const refresh = useRefreshNetwork()
  const showDeparture = useDeparture(state => state.show)
  const now = useNow()
  const live = useFreshLive(detail?.live, query.dataUpdatedAt)
  const relayId = relay?.id ?? null

  useEffect(() => {
    if (relayId) void flyToRelay(relayId)
  }, [relayId])

  const wantsNextLeg = location.hash === '#next-leg'
  useEffect(() => {
    if (!wantsNextLeg || !relayId) return
    document.getElementById('next-leg')?.scrollIntoView({ block: 'start' })
  }, [wantsNextLeg, relayId])

  if (!relay) {
    const missing = query.error instanceof api.NetworkApiError && query.error.code === 'journey_not_found'
    return (
      <Screen title="Journey" entryKey={entryKey} peek="tall">
        {query.isPending ? (
          <Loading label="Opening the journey" />
        ) : missing ? (
          <EmptyState title="No relay uses this code" body={`Nothing on the network matches “${code}”. Check the link you followed, or pick a relay that’s moving now.`}>
            <LinkButton variant="secondary" to="/">
              Back to the world
            </LinkButton>
          </EmptyState>
        ) : (
          <EmptyState title="This journey didn’t load" body={playerMessage(query.error) ?? 'Try again in a moment.'}>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </EmptyState>
        )}
      </Screen>
    )
  }

  const isHolder = player?.id === relay.holder.id
  const pending = isHolder ? (detail?.pendingHandoff ?? (snapshot?.pendingHandoff?.batonId === relay.id ? snapshot.pendingHandoff : null)) : null
  const share = () => action.run(() => shareLink(relay.name, pathFor('relay', { code: relay.code })))
  const milestone = batonMilestone({ wallets: relay.transactingWallets, handoffs: relay.handoffCount })

  return (
    <Screen
      title={relay.name}
      kicker={relay.name === relay.identity ? 'Journey' : relay.identity}
      entryKey={entryKey}
      peek="tall"
      actions={
        <button type="button" className="nr-icon-button" aria-label="Share journey" onClick={share}>
          <Icon name="share" size={20} />
        </button>
      }
    >
      <div className="nr-identity">
        <BatonHero appearance={relay.appearance} label={`Baton of ${relay.name}`} size={104} />
        <div className="nr-identity__text">
          <div className="nr-identity__pills">
            {statusPill(relay)}
            <Pill tone="gold">{formatNim(relay.valueLuna)}</Pill>
          </div>
          <p className="nr-identity__route">{journeyHeadline(relay)}</p>
          <p className="nr-identity__meta">
            Started by {relay.origin.name} {formatSince(relay.createdAt, now)}. {isHolder ? 'You hold it' : `${relay.holder.name} holds it`}
            {relay.holder.country ? ` in ${countryName(relay.holder.country)}.` : '. Location not shared.'}
          </p>
        </div>
      </div>

      {live && <LiveLegPanel live={live} ghostName={detail?.ghost?.name ?? null} />}

      <StatRow columns={3} label="Journey statistics">
        <Stat value={formatCount(relay.handoffCount)} label="verified handoffs" gold />
        <Stat value={formatCount(relay.transactingWallets)} label="transacting wallets" />
        <Stat value={formatCount(relay.countries.length)} label="network-observed countries" />
        <Stat value={formatDuration(relay.aliveMs)} label={relay.status === 'active' ? 'alive' : 'journey time'} />
        <Stat value={formatCount(relay.runners)} label="historic runners" />
        <Stat value={formatCount(relay.ghostWins)} label="ghosts beaten" />
      </StatRow>

      {relay.status === 'stranded' && <p className="nr-note">This baton is waiting with {relay.holder.name}. NIM Relay can’t move anyone’s funds, so the journey continues when they return.</p>}

      <div className="nr-actions nr-actions--stack">
        {isHolder && pending ? (
          <PendingPass
            key={pending.id}
            intent={pending}
            onConfirmed={stage => {
              const recipient = snapshot?.runners.find(runner => runner.id === stage.intent.recipientId)
              playArrival(stage.intent.id, { relayId: relay.id, fromCountry: relay.holder.country, toCountry: recipient?.country ?? null })
              showDeparture({ key: stage.intent.id, batonName: relay.identity, leg: stage.intent.leg, recipientName: stage.intent.recipientName })
              refresh()
            }}
            onCancelled={refresh}
          />
        ) : isHolder && relay.status !== 'completed' ? (
          <>
            <LinkButton variant="primary" size="lg" block to={pathFor('leg', { code: relay.code })}>
              Carry this leg
            </LinkButton>
            <Button
              variant="secondary"
              block
              busy={action.pending}
              onClick={() =>
                action.run(async () => {
                  const invite = await api.createNetworkInvite(relay.id)
                  await shareLink(`Carry ${relay.name}`, invite.url)
                })
              }
            >
              Invite next runner
            </Button>
          </>
        ) : (
          <>
            {relay.previousRunId && (
              <LinkButton variant="primary" size="lg" block to={practicePath(relay.previousRunId, relay.code)} data-tour="ghost">
                Race this ghost in practice
              </LinkButton>
            )}
            <Button variant="secondary" block onClick={share}>
              Share journey
            </Button>
          </>
        )}
      </div>

      <NextLeg relay={relay} player={player} />
      <QuickMatch relay={relay} snapshot={snapshot} player={player} />
      {detail ? <JourneyRoute relay={relay} detail={detail} playerId={player?.id ?? null} /> : <Loading label="Loading the route" />}
      {detail && <JourneyRecords relay={relay} detail={detail} />}

      <section className="nr-section" aria-labelledby="journey-proof">
        <SectionHeader id="journey-proof" title="Proof and story" />
        <p className="nr-lede">
          {relay.handoffCount === 0
            ? `No handoff yet. The first verified transfer of ${formatNim(relay.valueLuna)} starts the public record.`
            : `${formatCount(relay.handoffCount)} verified ${relay.handoffCount === 1 ? 'transfer' : 'transfers'} of ${formatNim(relay.valueLuna)} on ${networkLabel(relay.network)}${detail?.handoffs.at(-1) ? `, latest in block ${formatCount(detail.handoffs.at(-1)?.blockNumber ?? 0)}` : ''}.`}
        </p>
        {milestone && (
          <div className="nr-panel nr-panel--gold">
            <h3>
              {relay.name} reached {formatCount(milestone.count)} {milestone.unit === 'wallets' ? 'transacting wallets' : 'verified handoffs'}
            </h3>
            <p>Counted from verified transfers only. A wallet is a linked account, not proof of a unique person.</p>
            <div className="nr-actions">
              <ShareCardButton
                variant="primary"
                card={{ kind: 'milestone', batonName: relay.name, code: relay.code, milestone, handoffs: relay.handoffCount, wallets: relay.transactingWallets, countries: relay.countries.length, network: relay.network }}
              >
                Share milestone card
              </ShareCardButton>
            </div>
          </div>
        )}
        <div className="nr-actions">
          <LinkButton variant="secondary" to={pathFor('chronicle', { code: relay.code })}>
            Read the Chronicle
          </LinkButton>
          <LinkButton variant="secondary" to={pathFor('proofRelay', { code: relay.code })}>
            See every transaction
          </LinkButton>
        </div>
        <p className="nr-note">Countries come from runners who chose to share their network country. They are never exact locations and never inferred.</p>
      </section>
    </Screen>
  )
}
