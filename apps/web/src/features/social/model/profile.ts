import type { AchievementId, RelayArtifact, RunnerAchievement } from '@nim-relay/shared'

/** apps/worker grants 250 XP per verified handoff and sets level = 1 + floor(xp / 500). */
export const XP_PER_LEVEL = 500

export interface LevelProgress {
  level: number
  /** XP earned inside the current level. */
  into: number
  span: number
  toNext: number
}

/** Progress to the next level, or null when the reported level doesn't follow the server's rule, so no bar is shown that can't be vouched for. */
export function levelProgress(xp: number, level: number): LevelProgress | null {
  if (!Number.isFinite(xp) || xp < 0 || 1 + Math.floor(xp / XP_PER_LEVEL) !== level) return null
  const into = xp % XP_PER_LEVEL
  return { level, into, span: XP_PER_LEVEL, toNext: XP_PER_LEVEL - into }
}

export interface AchievementDefinition {
  id: AchievementId
  title: string
  /** What unlocks it, in the words of the server's rule (apps/worker achievements.ts). */
  condition: string
}

/** Every achievement the relay network awards, in the order a runner tends to earn them. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'first-pass', title: 'First pass', condition: 'Pass a baton in a verified handoff.' },
  { id: 'handoffs-10', title: '10 verified handoffs', condition: 'Pass batons in 10 verified handoffs.' },
  { id: 'ghost-breaker', title: 'Ghost breaker', condition: 'Beat the ghost on 10 legs you pass on.' },
  { id: 'crew-keeper', title: 'Crew keeper', condition: 'Pass a crew baton during a crew streak that reaches 7 days.' },
  { id: 'world-runner', title: 'World runner', condition: 'Pass batons after legs in all five worlds.' },
  { id: 'daily-top-10', title: 'Daily top 10%', condition: 'Finish in the top 10% of a Daily with at least 10 official riders.' },
  { id: 'ghost-wall', title: 'Ghost wall', condition: 'Set a leg the next 5 runners on its sector fail to outscore.' },
  { id: 'global-milestone', title: 'Global milestone', condition: 'Pass or receive handoff 10, 25, 50, 100 or 250 of a Global Relay.' },
  { id: 'rival-champion', title: 'Rival champion', condition: 'Carry the baton that wins a rivalry.' },
  { id: 'handoffs-50', title: '50 verified handoffs', condition: 'Pass batons in 50 verified handoffs.' },
  { id: 'handoffs-100', title: '100 verified handoffs', condition: 'Pass batons in 100 verified handoffs.' },
]

const DEFINITIONS = new Map(ACHIEVEMENTS.map(definition => [definition.id, definition]))

export interface AchievementBadge extends AchievementDefinition {
  unlockedAt: number | null
}

/** Unlocked achievements first, oldest unlock first, then locked ones in earning order. Awards this client doesn't know yet still appear. */
export function achievementBadges(unlocked: readonly RunnerAchievement[]): AchievementBadge[] {
  const earned = [...unlocked]
    .sort((a, b) => a.unlockedAt - b.unlockedAt)
    .map(item => ({ ...(DEFINITIONS.get(item.id) ?? { id: item.id, title: sentenceCase(item.title), condition: '' }), unlockedAt: item.unlockedAt }))
  const earnedIds = new Set(earned.map(item => item.id))
  const locked = ACHIEVEMENTS.filter(definition => !earnedIds.has(definition.id)).map(definition => ({ ...definition, unlockedAt: null }))
  return [...earned, ...locked]
}

/** The artifact's title in the catalog's casing, falling back to the server's title. */
export function artifactTitle(artifact: RelayArtifact): string {
  return DEFINITIONS.get(artifact.kind)?.title ?? sentenceCase(artifact.title)
}

function sentenceCase(title: string): string {
  const lower = title.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
