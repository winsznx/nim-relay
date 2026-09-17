import type { RunnerProfile } from '@nim-relay/shared'
import { formatCount, formatRaceTime } from '../../relays/format'
import { linkProps, pathFor } from '../../shell/router'
import { SectionHeader, Stat, StatRow } from '../../shell/ui/primitives'
import { RunnerAvatar } from '../../shell/ui/RunnerAvatar'
import { Icon } from '../../shell/ui/Icon'
import './profile.css'

const record = (wins: number, losses: number) => `${formatCount(wins)}–${formatCount(losses)}`

/** Verified career numbers. A stat that doesn't apply yet, like a crew streak without a crew, is left out. */
export function RunnerStats({ profile }: { profile: RunnerProfile }) {
  return (
    <StatRow columns={3} label="Runner record">
      <Stat value={formatCount(profile.qualifiedHandoffs)} label="verified handoffs" gold />
      <Stat value={formatCount(profile.legs)} label="relay legs" />
      <Stat value={record(profile.ghostWins, profile.ghostLosses)} label="ghost race record" />
      <Stat value={record(profile.quick.wins, profile.quick.losses)} label="Quick record" />
      {profile.crew && <Stat value={formatCount(profile.crew.streak)} label="day crew streak" />}
      {profile.daily.bestTimeMs !== null && <Stat value={formatRaceTime(profile.daily.bestTimeMs)} label={`best Daily in ${profile.daily.entries === 1 ? '1 ride' : `${formatCount(profile.daily.entries)} rides`}`} />}
    </StatRow>
  )
}

const ROLE_LABELS: Record<RunnerProfile['historicBatons'][number]['role'], string> = { origin: 'Started it', holder: 'Holds it now', runner: 'Carried a leg' }

/** Every baton the runner started, holds or carried. Each opens its journey. */
export function RelayHistory({ batons }: { batons: readonly RunnerProfile['historicBatons'][number][] }) {
  return (
    <section className="nr-section" aria-labelledby="relay-history" data-tour="profile-history">
      <SectionHeader id="relay-history" title="Batons" detail={batons.length > 0 ? `${formatCount(batons.length)} carried into history` : undefined} />
      {batons.length === 0 ? (
        <p className="nr-note">No batons yet. Carrying one leg puts a baton here for good.</p>
      ) : (
        <ul className="nr-list">
          {batons.map(baton => (
            <li key={baton.id}>
              <a className="nr-row" {...linkProps(pathFor('relay', { code: baton.code }))}>
                <span className={`nr-baton-mark nr-baton-mark--${baton.role}`} aria-hidden="true" />
                <span className="nr-row__body">
                  <span className="nr-row__title">{baton.displayName}</span>
                  <span className="nr-row__meta">{ROLE_LABELS[baton.role]}</span>
                </span>
                <span className="nr-row__aside nr-num">{formatCount(baton.handoffCount)} handoffs</span>
                <Icon name="chevron" size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface RecentRunnersProps {
  runners: RunnerProfile['recentRunners']
  /** Nimiq addresses by handle, for identicons. */
  wallets: ReadonlyMap<string, string>
}

/** Runners this runner recently passed to or received from. */
export function RecentRunners({ runners, wallets }: RecentRunnersProps) {
  if (runners.length === 0) return null
  return (
    <section className="nr-section" aria-labelledby="recent-runners">
      <SectionHeader id="recent-runners" title="Recent runners" detail="Passed to or received from, newest first" />
      <ul className="nr-people">
        {runners.map(runner => (
          <li key={runner.handle}>
            <a className="nr-person" {...linkProps(pathFor('runner', { handle: runner.handle }))}>
              <RunnerAvatar name={runner.name} wallet={wallets.get(runner.handle)} size={44} />
              <span className="nr-person__name">{runner.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
