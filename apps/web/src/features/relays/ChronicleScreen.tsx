import type { BatonChronicle, ChronicleMoment } from '@nim-relay/shared'
import { playerMessage } from '../shell/errors'
import { linkProps, pathFor } from '../shell/router'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { EmptyState, Loading, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { BatonEmblem } from '../baton/BatonEmblem'
import { batonAppearance } from '../baton/baton-appearance'
import * as api from './api'
import { trackShare, useChronicle } from './data'
import { countryName, flagFor, formatCount, formatDateTime, formatDuration, formatNim, formatRaceTime, modeLabel, serialLabel, shortHash } from './format'
import { watchPath } from './JourneyRoute'
import { shareJourneyCard } from './share-card'
import './relays.css'

function momentDetail(moment: ChronicleMoment): string {
  const leg = `Leg ${moment.leg}, ${moment.runner.name}`
  switch (moment.kind) {
    case 'fastest-leg':
      return typeof moment.value === 'number' ? `${leg} in ${formatRaceTime(moment.value)}` : leg
    case 'closest-ghost-race':
      return typeof moment.value === 'number' ? `${leg}, ${formatRaceTime(moment.value)} from the ghost` : leg
    case 'longest-surviving-ghost':
      return typeof moment.value === 'number' ? `${leg}, unbeaten for ${moment.value} ${moment.value === 1 ? 'leg' : 'legs'}` : leg
    case 'first-new-country':
      return typeof moment.value === 'string' ? `${leg} brought it to ${countryName(moment.value)}` : leg
    case 'milestone':
      return typeof moment.value === 'number' ? `Handoff ${formatCount(moment.value)}, carried by ${moment.runner.name}` : leg
    case 'rescue':
      return `${leg} moved it on after it stalled`
    case 'final-runner':
      return `${moment.runner.name} held it at the finish`
  }
}

function headline(chronicle: BatonChronicle): string {
  const handoffs = chronicle.qualifiedHandoffs
  if (handoffs === 0) return 'Waiting for its first handoff'
  const passes = `${formatCount(handoffs)} verified ${handoffs === 1 ? 'handoff' : 'handoffs'}`
  const countries = chronicle.countries > 0 ? ` across ${formatCount(chronicle.countries)} ${chronicle.countries === 1 ? 'country' : 'countries'}` : ''
  return `${passes}${countries} in ${formatDuration(chronicle.aliveMs)}`
}

function ChronicleBody({ chronicle }: { chronicle: BatonChronicle }) {
  const action = useAction()
  const { baton } = chronicle
  const identity = `${modeLabel(baton.mode)} ${serialLabel(baton.serial)}`
  const path = pathFor('chronicle', { code: baton.code })
  const countriesInOrder = chronicle.stops.map(stop => stop.countryCode)
  const route = countriesInOrder.length > 1 ? `${countryName(countriesInOrder[0] ?? null)} → ${countryName(countriesInOrder.at(-1) ?? null)}` : countryName(countriesInOrder[0] ?? null)
  const appearance = batonAppearance({ handoffCount: chronicle.qualifiedHandoffs, ageMs: chronicle.aliveMs, countries: chronicle.countries, ghostWins: 0, milestones: chronicle.moments.filter(moment => moment.kind === 'rescue').map(() => 'rescue') })
  return (
    <>
      <header className="nr-chronicle-cover">
        <BatonEmblem appearance={appearance} size={72} />
        <p className="nr-chronicle-cover__value nr-num">{formatNim(baton.value)}</p>
        <h2 className="nr-chronicle-cover__headline">{headline(chronicle)}</h2>
        <p className="nr-chronicle-cover__meta">
          {baton.status === 'completed' ? 'Finished' : baton.status === 'stranded' ? 'Waiting with its holder' : 'Still moving'}. Started {formatDateTime(baton.createdAt)} by {baton.origin.name}.
        </p>
      </header>

      <StatRow label="Chronicle statistics" relay>
        <Stat value={formatCount(chronicle.qualifiedHandoffs)} label="verified handoffs" gold />
        <Stat value={formatCount(chronicle.transactingWallets)} label="transacting wallets" />
        <Stat value={formatCount(chronicle.countries)} label="network-observed countries" />
        <Stat value={formatDuration(chronicle.aliveMs)} label="alive" />
      </StatRow>

      <section className="nr-section" aria-labelledby="chronicle-route">
        <SectionHeader id="chronicle-route" title="Route" detail={route} />
        <ol className="nr-stops">
          {chronicle.stops.map((stop, index) => (
            <li key={`${stop.leg}-${stop.runner.id}`} className="nr-stops__stop">
              {index > 0 && (
                <span className="nr-stops__arrow" aria-hidden="true">
                  ↓
                </span>
              )}
              <div className="nr-stops__row">
                <span className="nr-stops__flag" aria-hidden="true">
                  {flagFor(stop.countryCode) ?? '○'}
                </span>
                <div>
                  <p className="nr-stops__place">{countryName(stop.countryCode)}</p>
                  <p className="nr-stops__who">
                    {stop.leg === 0 ? 'Started by ' : `Leg ${stop.leg}, received by `}
                    <a {...linkProps(pathFor('runner', { handle: stop.runner.handle }))}>{stop.runner.name}</a>
                    <span className="nr-route__time">{formatDateTime(stop.at)}</span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {chronicle.moments.length > 0 && (
        <section className="nr-section" aria-labelledby="chronicle-moments">
          <SectionHeader id="chronicle-moments" title="Moments" />
          <ul className="nr-list">
            {chronicle.moments.map(moment => (
              <li key={`${moment.kind}-${moment.leg}`} className="nr-row">
                <span className="nr-echo-mark" aria-hidden="true" />
                <span className="nr-row__body">
                  <span className="nr-row__title">{moment.title}</span>
                  <span className="nr-row__meta">{momentDetail(moment)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="nr-section" aria-labelledby="chronicle-runners">
        <SectionHeader id="chronicle-runners" title="Runners" detail={`${formatCount(chronicle.runners.length)} carried this baton`} />
        <ul className="nr-chips">
          {chronicle.runners.map(runner => (
            <li key={runner.id}>
              <a className="nr-chip" {...linkProps(pathFor('runner', { handle: runner.handle }))}>
                {runner.name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="nr-section" aria-labelledby="chronicle-proof">
        <SectionHeader id="chronicle-proof" title="Proof" detail="Each handoff is a public Nimiq transaction and a replayed race." />
        {chronicle.transactions.length === 0 ? (
          <p className="nr-note">No transactions yet. The first verified pass will appear here.</p>
        ) : (
          <ul className="nr-list">
            {chronicle.transactions.map(transaction => (
              <li key={transaction.txHash} className="nr-row">
                <span className="nr-rank nr-num" aria-hidden="true">
                  {transaction.leg}
                </span>
                <span className="nr-row__body">
                  <a className="nr-row__title nr-hash" {...linkProps(`${pathFor('proofRelay', { code: baton.code })}#tx-${transaction.txHash}`)}>
                    {shortHash(transaction.txHash)}
                  </a>
                  <span className="nr-row__meta">Block {formatCount(transaction.blockNumber)}</span>
                </span>
                <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(watchPath(transaction.runId, baton.code))}>
                  Replay
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="nr-actions nr-actions--stack">
        <Button
          variant="primary"
          block
          busy={action.pending}
          onClick={() =>
            action.run(async () => {
              await shareJourneyCard({
                code: baton.code,
                identity,
                name: baton.displayName,
                network: baton.network,
                valueLuna: baton.value,
                handoffs: chronicle.qualifiedHandoffs,
                transactingWallets: chronicle.transactingWallets,
                countries: chronicle.countries,
                aliveMs: chronicle.aliveMs,
                route,
                runnerNames: chronicle.stops.map(stop => stop.runner.name),
              })
              trackShare('chronicle')
            })
          }
        >
          Share Chronicle card
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() =>
            action.run(async () => {
              await shareLink(`${identity}: ${baton.displayName}`, path)
              trackShare('chronicle')
            })
          }
        >
          Share link
        </Button>
        <LinkButton variant="quiet" block to={pathFor('relay', { code: baton.code })}>
          Open the live journey
        </LinkButton>
      </div>
    </>
  )
}

export function ChronicleScreen({ code, entryKey }: { code: string; entryKey: string }) {
  const chronicle = useChronicle(code)
  const data = chronicle.data
  const missing = chronicle.error instanceof api.NetworkApiError && chronicle.error.status === 404
  return (
    <Screen title={data ? data.baton.displayName : 'Chronicle'} kicker={data ? 'Chronicle' : undefined} entryKey={entryKey} peek="tall" parent={pathFor('relay', { code })}>
      {data ? (
        <ChronicleBody chronicle={data} />
      ) : chronicle.isPending ? (
        <Loading label="Opening the Chronicle" />
      ) : missing ? (
        <EmptyState title="No Chronicle for this code" body={`No relay matches “${code}”, so there’s no story to tell yet. Check the link, or start a relay of your own.`}>
          <LinkButton variant="secondary" to="/">
            Back to the world
          </LinkButton>
        </EmptyState>
      ) : (
        <EmptyState title="The Chronicle didn’t load" body={playerMessage(chronicle.error) ?? 'Try again in a moment.'}>
          <Button variant="secondary" onClick={() => void chronicle.refetch()}>
            Try again
          </Button>
        </EmptyState>
      )}
    </Screen>
  )
}
