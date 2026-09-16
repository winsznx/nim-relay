import type { ReactNode } from 'react'
import type { AchievementId, RelayArtifact, RunnerAchievement } from '@nim-relay/shared'
import { formatCount } from '../../relays/format'
import { achievementBadges, artifactTitle } from '../model/profile'
import { linkProps, pathFor } from '../../shell/router'
import { HexBadge } from '../../shell/ui/HexBadge'
import { SectionHeader } from '../../shell/ui/primitives'
import './profile.css'

const GLYPHS: Partial<Record<AchievementId, ReactNode>> = {
  'first-pass': <path d="M4 12h13M12.5 6.5 18 12l-5.5 5.5" />,
  'ghost-breaker': (
    <>
      <path d="M6.5 20V11a5.5 5.5 0 0 1 11 0v9l-2.75-2-2.75 2-2.75-2-2.75 2Z" />
      <path d="M10 11h.01M14 11h.01" />
    </>
  ),
  'ghost-wall': <path d="M4 5.5h16v13H4zM4 9.8h16M4 14.2h16M9 5.5v4.3M15 9.8v4.4M9 14.2v4.3" />,
  'crew-keeper': <path d="M12 21c3.6 0 6-2.5 6-5.8 0-3.5-2.7-5.3-3.9-8.3-.5 2-1.7 3.1-2.8 3.7-.1-2.4-.8-4.9-.3-7.6C7.6 5.4 6 9 6 12.6 6 17.7 8.4 21 12 21Z" />,
  'world-runner': <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.3 3.6 5.3 3.6 9s-1.2 6.7-3.6 9m0-18C9.6 5.3 8.4 8.3 8.4 12s1.2 6.7 3.6 9M3.5 9h17M3.5 15h17" />,
  'global-milestone': <path d="M6 21V3.5M6 4h11l-2.5 4.5L17 13H6" />,
  'daily-top-10': <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />,
  'rival-champion': <path d="M4 17 3 7.5l5 3.8L12 5l4 6.3 5-3.8-1 9.5H4ZM4.5 20.5h15" />,
  'handoffs-10': '10',
  'handoffs-50': '50',
  'handoffs-100': '100',
}

const GLYPH_BY_KIND = new Map<string, ReactNode>(Object.entries(GLYPHS))

/** Awards newer than this client get a plain hexagon instead of nothing. */
function glyphFor(kind: string): ReactNode {
  return GLYPH_BY_KIND.get(kind) ?? <path d="M12 8.5 15 10.3v3.4L12 15.5l-3-1.8v-3.4L12 8.5Z" />
}

const unlockDate = (at: number) => new Date(at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })

/** Earned badges in gold; locked ones dimmed, each saying exactly what unlocks it. */
export function AchievementShelf({ achievements }: { achievements: readonly RunnerAchievement[] }) {
  const badges = achievementBadges(achievements)
  const earned = badges.filter(badge => badge.unlockedAt !== null).length
  return (
    <section className="nr-section" aria-labelledby="achievements">
      <SectionHeader id="achievements" title="Achievements" detail={`${formatCount(earned)} of ${formatCount(badges.length)} unlocked`} />
      <ul className="nr-shelf">
        {badges.map(badge => {
          const locked = badge.unlockedAt === null
          return (
            <li key={badge.id} className={`nr-shelf__badge${locked ? ' nr-shelf__badge--locked' : ''}`}>
              <HexBadge locked={locked} size={52}>
                {glyphFor(badge.id)}
              </HexBadge>
              <span className="nr-shelf__title">{badge.title}</span>
              <span className="nr-shelf__detail">
                {badge.unlockedAt !== null ? (
                  <>
                    <span className="nr-visually-hidden">Unlocked </span>
                    {unlockDate(badge.unlockedAt)}
                  </>
                ) : (
                  <>
                    <span className="nr-visually-hidden">Locked. </span>
                    {badge.condition}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface ArtifactTilesProps {
  artifacts: readonly RelayArtifact[]
  /** Baton codes by id, so an artifact can open the journey that earned it. */
  codes: ReadonlyMap<string, string>
}

/** Keepsakes from each unlock, pointing at the verified moment that earned it. */
export function ArtifactTiles({ artifacts, codes }: ArtifactTilesProps) {
  if (artifacts.length === 0) return null
  return (
    <section className="nr-section" aria-labelledby="artifacts">
      <SectionHeader id="artifacts" title="Relay Artifacts" detail="Keepsakes of the verified moment behind each achievement" />
      <ul className="nr-artifact-grid">
        {artifacts.map(artifact => {
          const code = artifact.batonId ? codes.get(artifact.batonId) : undefined
          const body = (
            <>
              <span className="nr-artifact__top">
                <HexBadge size={30}>{glyphFor(artifact.kind)}</HexBadge>
                <time className="nr-artifact__date nr-num" dateTime={new Date(artifact.at).toISOString()}>
                  {unlockDate(artifact.at)}
                </time>
              </span>
              <span className="nr-artifact__title">{artifactTitle(artifact)}</span>
              <span className="nr-artifact__subtitle">{artifact.subtitle}</span>
            </>
          )
          return (
            <li key={artifact.id}>
              {code ? (
                <a className="nr-artifact nr-artifact--link" {...linkProps(pathFor('relay', { code }))}>
                  {body}
                </a>
              ) : (
                <div className="nr-artifact">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
