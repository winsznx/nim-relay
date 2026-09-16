import type { RelayArtifact, RunnerAchievement, RunnerProfile } from '@nim-relay/shared'
import { formatCount, formatDateTime } from '../relays/format'
import { linkProps, pathFor } from '../shell/router'
import { SectionHeader } from '../shell/ui/primitives'

const ROLE_LABELS: Record<RunnerProfile['historicBatons'][number]['role'], string> = { origin: 'Started it', holder: 'Holds it', runner: 'Carried a leg' }

export function RelayHistory({ batons }: { batons: readonly RunnerProfile['historicBatons'][number][] }) {
  return (
    <section className="nr-section" aria-labelledby="relay-history">
      <SectionHeader id="relay-history" title="Relays" />
      {batons.length === 0 ? (
        <p className="nr-note">No relays yet. Carrying one leg puts a relay here for good.</p>
      ) : (
        <ul className="nr-list">
          {batons.map(baton => (
            <li key={baton.id}>
              <a className="nr-row" {...linkProps(pathFor('relay', { code: baton.code }))}>
                <span className="nr-row__body">
                  <span className="nr-row__title">{baton.displayName}</span>
                  <span className="nr-row__meta">{ROLE_LABELS[baton.role]}</span>
                </span>
                <span className="nr-row__aside nr-num">{formatCount(baton.handoffCount)} handoffs</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface AchievementListProps {
  /** Titled achievements from the public runner profile, when the server provides them. */
  achievements: readonly RunnerAchievement[] | null
  /** Achievement names from the runner's own station profile. */
  legacy: readonly string[]
  artifacts: readonly RelayArtifact[]
}

export function AchievementList({ achievements, legacy, artifacts }: AchievementListProps) {
  const items = achievements ? achievements.map(item => ({ key: item.id, title: item.title, detail: `Unlocked ${formatDateTime(item.unlockedAt)}` })) : legacy.map(title => ({ key: title, title: title.replaceAll('-', ' '), detail: null }))
  return (
    <section className="nr-section" aria-labelledby="achievements">
      <SectionHeader id="achievements" title="Achievements" />
      {items.length === 0 ? (
        <p className="nr-note">Achievements unlock from verified moments, like a first pass or beating a ghost.</p>
      ) : (
        <ul className="nr-badges">
          {items.map(item => (
            <li key={item.key} className="nr-badge">
              <span className="nr-badge__hex" aria-hidden="true" />
              <span className="nr-badge__title">{item.title}</span>
              {item.detail && <span className="nr-badge__detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {artifacts.length > 0 && (
        <ul className="nr-list nr-artifacts">
          {artifacts.map(artifact => (
            <li key={artifact.id} className="nr-row">
              <span className="nr-echo-mark" aria-hidden="true" />
              <span className="nr-row__body">
                <span className="nr-row__title">{artifact.title}</span>
                <span className="nr-row__meta">{artifact.subtitle}</span>
              </span>
              <span className="nr-row__aside">{formatDateTime(artifact.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
