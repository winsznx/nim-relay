import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { RelayNetwork } from '@nim-relay/shared'
import { countryName, formatAgo, formatCount, formatDuration, formatNim } from '../relays/format'
import { journeyHeadline, type Moment, type RelayView } from '../relays/model'
import { linkProps, navigate, pathFor } from '../shell/router'
import { useRequireRunner } from '../shell/session'
import { Button, LinkButton } from '../shell/ui/Button'
import { Stat, StatRow } from '../shell/ui/primitives'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { flyToRelay } from './globe-bridge'

const TICK_MS = 4800

function Ticker({ moments, now }: { moments: readonly Moment[]; now: number }) {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (reduced || moments.length < 2) return
    const timer = window.setInterval(() => setIndex(current => (current + 1) % moments.length), TICK_MS)
    return () => window.clearInterval(timer)
  }, [reduced, moments.length])
  const moment = moments[index % Math.max(1, moments.length)]
  if (!moment) return null
  return (
    <div className="nr-ticker">
      <span className="nr-ticker__dot" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.a
          key={moment.id}
          className="nr-ticker__text"
          {...(moment.batonCode ? linkProps(pathFor('relay', { code: moment.batonCode })) : {})}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
        >
          {moment.text}
        </motion.a>
      </AnimatePresence>
      <span className="nr-ticker__time nr-num">{formatAgo(moment.at, now)}</span>
    </div>
  )
}

interface RelayHeroProps {
  relay: RelayView
  playerId: string | null
  latestReplay: string | null
  moments: readonly Moment[]
  now: number
}

/** The featured relay, framed like a boarding pass for one NIM. */
export function RelayHero({ relay, playerId, latestReplay, moments, now }: RelayHeroProps) {
  const requireRunner = useRequireRunner()
  const [watching, setWatching] = useState(false)
  const isHolder = playerId === relay.holder.id
  const journey = pathFor('relay', { code: relay.code })
  const watch = () => {
    setWatching(true)
    flyToRelay(relay.id)
      .then(() => {
        if (latestReplay) navigate(`/leg/watch?run=${encodeURIComponent(latestReplay)}&relay=${encodeURIComponent(relay.code)}`)
      })
      .finally(() => setWatching(false))
  }
  const status = relay.status === 'active' ? 'Live' : relay.status === 'stranded' ? 'Waiting on holder' : 'Finished'
  return (
    <article className="nr-hero" aria-labelledby="hero-route">
      <div className="nr-hero__head">
        <p className={`nr-hero__identity nr-hero__identity--${relay.status}`}>
          <span className="nr-hero__status-dot" aria-hidden="true" />
          {relay.identity}
          <span className="nr-visually-hidden">, {status}</span>
        </p>
        <span className="nr-hero__value nr-num">{formatNim(relay.valueLuna)}</span>
      </div>
      <a className="nr-hero__route" id="hero-route" {...linkProps(journey)}>
        {journeyHeadline(relay)}
      </a>
      {relay.name !== relay.identity && <p className="nr-hero__name">{relay.name}</p>}
      <StatRow label="Relay statistics" relay>
        <Stat value={<span className="nr-num">{formatCount(relay.handoffCount)}</span>} label="verified handoffs" />
        <Stat value={<span className="nr-num">{formatCount(relay.transactingWallets)}</span>} label="transacting wallets" />
        <Stat value={<span className="nr-num">{formatCount(relay.countries.length)}</span>} label="network-observed countries" />
        <Stat value={<span className="nr-num">{formatDuration(relay.aliveMs)}</span>} label={relay.status === 'active' ? 'alive' : 'journey time'} />
      </StatRow>
      <div className="nr-hero__tear" aria-hidden="true" />
      <div className="nr-hero__people">
        <div className="nr-hero__person">
          <p className="nr-hero__label">Current holder</p>
          <div className="nr-hero__runner">
            <RunnerAvatar name={relay.holder.name} wallet={relay.holder.wallet} country={relay.holder.country} holder size={34} />
            <span>
              <span className="nr-hero__runner-name">{isHolder ? 'You' : relay.holder.name}</span>
              <span className="nr-hero__runner-place">{countryName(relay.holder.country)}</span>
            </span>
          </div>
        </div>
        <div className="nr-hero__person">
          <p className="nr-hero__label">Next</p>
          <div className="nr-hero__runner">
            {relay.next ? <RunnerAvatar name={relay.next.name} wallet={relay.next.wallet} size={34} /> : <span className="nr-hero__open-slot" aria-hidden="true" />}
            <span>
              <span className="nr-hero__runner-name">{relay.status !== 'active' ? 'No next leg' : relay.next ? (relay.next.id === playerId ? 'You' : relay.next.name) : 'Awaiting runner'}</span>
              <span className="nr-hero__runner-place">{relay.next ? 'Reserved' : relay.status === 'active' ? 'Open to invite' : ' '}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="nr-hero__actions">
        <Button variant="secondary" onClick={watch} busy={watching}>
          Watch
        </Button>
        {isHolder && relay.status !== 'completed' ? (
          <LinkButton variant="primary" to={pathFor('leg', { code: relay.code })}>
            Carry this leg
          </LinkButton>
        ) : (
          <Button
            variant="primary"
            disabled={relay.status === 'completed'}
            onClick={() => requireRunner(`Sign in to join the next leg of ${relay.name}.`, () => navigate(`${journey}#next-leg`))}
          >
            Join next leg
          </Button>
        )}
        <LinkButton variant="quiet" to={journey}>
          View journey
        </LinkButton>
      </div>
      <Ticker key={moments[0]?.id ?? 'none'} moments={moments} now={now} />
    </article>
  )
}

export function EmptyHero({ network }: { network: RelayNetwork | null }) {
  const requireRunner = useRequireRunner()
  return (
    <article className="nr-hero nr-hero--empty" aria-labelledby="empty-hero-title">
      <p className="nr-hero__identity">The first baton is waiting</p>
      <h1 className="nr-hero__headline" id="empty-hero-title">
        How far can one NIM travel?
      </h1>
      <p className="nr-hero__lead">
        No relay is moving on {network === 'MainAlbatross' ? 'Nimiq mainnet' : network === 'TestAlbatross' ? 'the Nimiq testnet' : 'the network'} yet. Start the first one with 1 NIM, or learn the leg in practice.
      </p>
      <div className="nr-hero__stack">
        <Button variant="primary" size="lg" block onClick={() => requireRunner('Sign in to start Global Relay #001 with 1 NIM from your wallet.', () => navigate('/start?mode=global'))}>
          Start Global Relay #001
        </Button>
        <LinkButton variant="secondary" size="lg" block to="/leg/practice">
          Practice a relay leg
        </LinkButton>
      </div>
    </article>
  )
}
