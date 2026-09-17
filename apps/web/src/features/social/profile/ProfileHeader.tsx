import { countryName, formatCount } from '../../relays/format'
import { levelProgress } from '../model/profile'
import { HexBadge } from '../../shell/ui/HexBadge'
import { ProgressBar } from '../../shell/ui/ProgressBar'
import { RunnerAvatar } from '../../shell/ui/RunnerAvatar'
import './profile.css'

interface ProfileHeaderProps {
  name: string
  handle: string
  wallet: string | null
  /** Consented, network-observed country. */
  country: string | null
  holder: boolean
  you: boolean
}

export function ProfileHeader({ name, handle, wallet, country, holder, you }: ProfileHeaderProps) {
  return (
    <header className="nr-runner-head" data-tour="profile-runner">
      <RunnerAvatar name={name} wallet={wallet} country={country} holder={holder} size={84} />
      <div className="nr-runner-head__text">
        <h2 className="nr-runner-head__name">{you ? `${name} (you)` : name}</h2>
        <p className="nr-runner-head__meta">
          @{handle}
          {country ? `, ${countryName(country)}` : ''}
        </p>
        {holder && <p className="nr-runner-head__holding">Holding a baton now</p>}
      </div>
    </header>
  )
}

interface LevelPlateProps {
  level: number
  seasonRank: string
  /** Only the runner's own profile knows its XP. */
  xp: number | null
}

/** Level and season rank, with the climb to the next level when the XP is known. */
export function LevelPlate({ level, seasonRank, xp }: LevelPlateProps) {
  const progress = xp === null ? null : levelProgress(xp, level)
  return (
    <section className="nr-level" aria-label={`Level ${level}, ${seasonRank}`}>
      <HexBadge size={58}>{String(level)}</HexBadge>
      <div className="nr-level__body">
        <p className="nr-level__title">
          <span>Level {formatCount(level)}</span>
          <span className="nr-level__rank">{seasonRank}</span>
        </p>
        {progress && xp !== null ? (
          <>
            <ProgressBar value={progress.into} max={progress.span} label={`XP toward level ${level + 1}`} valueText={`${formatCount(progress.into)} of ${formatCount(progress.span)} XP`} />
            <p className="nr-level__meta nr-num">
              {formatCount(progress.toNext)} XP to level {formatCount(level + 1)}. {formatCount(xp)} XP earned from verified rides and handoffs.
            </p>
          </>
        ) : (
          <p className="nr-level__meta">Season rank from verified rides and handoffs.</p>
        )}
      </div>
    </section>
  )
}
