import { useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { paymentAddress } from '@nim-relay/relay-protocol'
import type { NetworkNotification, NetworkSnapshot } from '@nim-relay/shared'
import type { Player } from '../../lib/auth-api'
import { acceptReservation, markNotificationRead } from '../relays/api'
import { useAction } from '../shell/use-action'
import { useBatonDetail, useLiveStatus, useNow, useRefreshNetwork, useStationProfile, type NetworkState } from '../relays/data'
import { useFreshLive } from '../relays/live'
import { tickerMoments, toRelayView, type RelayView } from '../relays/model'
import { linkProps, navigate, pathFor } from '../shell/router'
import { useRequireRunner } from '../shell/session'
import { Button } from '../shell/ui/Button'
import { Pill } from '../shell/ui/primitives'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { playArrival } from './globe-bridge'
import { EmptyHero, RelayHero } from './RelayHero'

interface WorldHomeProps {
  player: Player | null
  relays: readonly RelayView[]
  featured: RelayView | null
  network: NetworkState
}

function TopBar({ player, snapshot }: { player: Player | null; snapshot: NetworkSnapshot | undefined }) {
  const live = useLiveStatus()
  const requireRunner = useRequireRunner()
  const profile = useStationProfile()
  // The session carries the sign-in name; the courier name the runner chose lives on their station profile.
  const courierName = profile.data?.profile.name ?? player?.displayName ?? ''
  return (
    <header className="nr-topbar">
      <a className="nr-wordmark" {...linkProps('/')} aria-label="NIM Relay home">
        NIM RELAY
      </a>
      <div className="nr-topbar__side">
        {snapshot && (
          <Pill tone={live === 'live' ? 'live' : 'neutral'}>
            {snapshot.network === 'MainAlbatross' ? 'Mainnet' : 'Testnet'}
            <span className="nr-visually-hidden">{live === 'live' ? ', live updates on' : ', reconnecting'}</span>
          </Pill>
        )}
        {player ? (
          <a className="nr-topbar__avatar" {...linkProps('/profile')} aria-label={`Your profile, ${courierName}`}>
            <RunnerAvatar name={courierName} wallet={paymentAddress(player.walletAddress)} size={36} />
          </a>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => requireRunner('Sign in to receive batons and race for real.', () => undefined)}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  )
}

function PersonalBanner({ player, relays, snapshot }: { player: Player; relays: readonly RelayView[]; snapshot: NetworkSnapshot | undefined }) {
  const refresh = useRefreshNetwork()
  const incoming = snapshot?.inbox.find((item): item is NetworkNotification & { batonId: string } => item.type === 'incoming_baton' && item.readAt === null && item.batonId !== null)
  const arrived = incoming ? relays.find(relay => relay.id === incoming.batonId) : undefined
  const yourTurn = relays.find(relay => relay.holder.id === player.id && relay.status === 'active')
  const reserved = relays.find(relay => relay.status !== 'completed' && relay.next?.id === player.id && !relay.next.accepted)
  const action = useAction()

  useEffect(() => {
    if (!incoming || !arrived) return
    const previous = arrived.stops.length > 1 ? (arrived.stops.at(-2)?.countryCode ?? null) : null
    playArrival(incoming.id, { relayId: arrived.id, fromCountry: previous, toCountry: arrived.stops.at(-1)?.countryCode ?? null })
  }, [incoming, arrived])

  if (incoming && arrived) {
    const open = () => {
      markNotificationRead(incoming.id)
        .then(refresh)
        .catch((error: unknown) => console.warn('Notification stays unread', error))
      navigate(pathFor('relay', { code: arrived.code }))
    }
    return (
      <div className="nr-banner nr-banner--arrival" role="status">
        <div className="nr-banner__text">
          <p className="nr-banner__eyebrow">Incoming baton</p>
          <p className="nr-banner__title">{incoming.title}</p>
        </div>
        <Button variant="primary" size="sm" onClick={open}>
          Open
        </Button>
      </div>
    )
  }
  if (yourTurn) {
    return (
      <div className="nr-banner" role="status">
        <div className="nr-banner__text">
          <p className="nr-banner__eyebrow">Your turn</p>
          <p className="nr-banner__title">Carry {yourTurn.name}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate(pathFor('leg', { code: yourTurn.code }))}>
          Carry
        </Button>
      </div>
    )
  }
  if (reserved) {
    return (
      <div className="nr-banner" role="status">
        <div className="nr-banner__text">
          <p className="nr-banner__eyebrow">Reserved for you</p>
          <p className="nr-banner__title">
            {reserved.holder.name} saved the next leg of {reserved.name}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          busy={action.pending}
          onClick={() =>
            action.run(async () => {
              await acceptReservation(reserved.id)
              refresh()
            })
          }
        >
          Accept
        </Button>
      </div>
    )
  }
  return null
}

export function WorldHome({ player, relays, featured, network }: WorldHomeProps) {
  const reduced = useReducedMotion()
  const now = useNow()
  const featuredDetail = useBatonDetail(featured?.code ?? null)
  const detail = featuredDetail.data
  const live = useFreshLive(featured && detail?.baton.id === featured.id ? detail.live : null, featuredDetail.dataUpdatedAt)
  const snapshot = network.snapshot
  const hero = featured && detail?.baton.id === featured.id ? toRelayView(detail.baton, { runners: snapshot?.runners ?? [], rivals: snapshot?.rivals ?? [], detail, now }) : featured
  const moments = tickerMoments(relays, featured, detail)
  const latestReplay = detail?.handoffs.at(-1)?.runId ?? null
  return (
    <motion.div className="nr-home" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <TopBar player={player} snapshot={snapshot} />
      {player && <PersonalBanner player={player} relays={relays} snapshot={snapshot} />}
      <div className="nr-home__bottom">
        {hero ? (
          <RelayHero relay={hero} playerId={player?.id ?? null} latestReplay={latestReplay} moments={moments} now={now} live={live} />
        ) : network.loading ? (
          <div className="nr-hero nr-hero--status" role="status">
            <p className="nr-hero__identity">Finding live relays</p>
          </div>
        ) : network.failed && !snapshot ? (
          <div className="nr-hero nr-hero--status" role="alert">
            <p className="nr-hero__identity">Relay network unreachable</p>
            <p className="nr-hero__lead">The relay server isn’t answering. Your wallet and journeys are safe.</p>
            <Button variant="secondary" onClick={network.retry}>
              Try again
            </Button>
          </div>
        ) : (
          <EmptyHero network={snapshot?.network ?? null} />
        )}
      </div>
    </motion.div>
  )
}
