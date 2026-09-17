import { pathFor } from '../shell/router'
import { globeDisc } from '../world/globe-bridge'
import { tourTarget } from './targets'
import type { TourDefinition, TourRect, TourStep } from './types'

/** The first-run product tour of NIM Relay: the world, the baton, the inbox, the race, the social modes and history. */

export const CORE_TOUR_ID = 'core'
export const CORE_TOUR_VERSION = 'v1'
export const PRACTICE_PATH = '/leg/practice'

/** What is really on screen when the tour starts, so no step promises something that isn't there. */
export interface CoreTourContext {
  /** A relay is featured on the world home, so its card and journey link exist. */
  featuredCode: string | null
  /** The featured relay's journey offers a verified ghost to race in practice. */
  ghostOnJourney: boolean
}

function globeBox(): TourRect | null {
  const disc = globeDisc()
  return disc ? { x: disc.x - disc.radius, y: disc.y - disc.radius, width: disc.radius * 2, height: disc.radius * 2 } : null
}

export function coreTour({ featuredCode, ghostOnJourney }: CoreTourContext): TourDefinition {
  const journey = featuredCode ? pathFor('relay', { code: featuredCode }) : null
  const steps: TourStep[] = [
    {
      id: 'relay-world',
      route: '/',
      target: tourTarget('relay-world'),
      measure: globeBox,
      shape: 'circle',
      padding: 6,
      fallbackTargets: [{ target: tourTarget('relay-world-fallback'), shape: 'rect', padding: 10, copy: { body: 'Batons pass between real people. This device can’t draw the globe, so relays are listed below.' } }],
      category: 'The relay world',
      title: 'Watch NIM move',
      body: featuredCode
        ? 'This is the Relay Atlas: stations in the game world and the routes between them. Batons travel them as real NIM passes from person to person.'
        : 'This is the Relay Atlas: stations in the game world and the routes between them. Routes light up as real NIM batons pass from person to person.',
      interaction: 'next',
    },
    {
      id: 'featured-relay',
      route: '/',
      target: tourTarget('featured-relay'),
      fallbackTargets: [{ target: tourTarget('relay-empty'), copy: { title: 'Every relay starts with one NIM', body: 'No baton is moving here yet. Start the first one with 1 NIM, or practice a leg.' } }],
      whenMissing: { title: 'Every relay carries one real NIM', body: 'Each verified handoff adds another runner to its journey. Live relays show on this card.' },
      category: 'The baton',
      title: 'This is what everyone carries',
      body: 'One real NIM. Each verified handoff adds another runner to its journey.',
      placement: ['top', 'bottom'],
      padding: 6,
      interaction: 'next',
    },
  ]
  if (featuredCode) {
    steps.push({
      id: 'open-journey',
      route: '/',
      target: tourTarget('open-journey'),
      category: 'Follow a journey',
      title: 'Every stop, on the record',
      body: 'Tap View journey to see everyone who has carried this baton so far.',
      placement: ['top', 'bottom'],
      padding: 4,
      interaction: 'tap-target',
    })
  }
  steps.push(
    {
      id: 'nav-inbox',
      target: tourTarget('nav-inbox'),
      category: 'Your relay inbox',
      title: 'Batons find you here',
      body: 'When someone passes you a baton, beats your ghost or invites you to a match, it lands here.',
      placement: ['top'],
      padding: 4,
      interaction: 'next',
    },
    {
      id: 'inbox-turns',
      route: pathFor('inbox'),
      target: tourTarget('inbox-turns'),
      fallbackTargets: [tourTarget('inbox-updates')],
      category: 'When the baton reaches you',
      title: 'Your turn shows up first',
      body: 'When a baton reaches you, it waits here with the time you have left to carry it.',
      interaction: 'next',
    },
    {
      id: 'nav-play',
      target: tourTarget('nav-play'),
      shape: 'circle',
      padding: 6,
      category: 'Run your leg',
      title: 'Race to pass it on',
      body: 'Play opens your leg, the Daily and practice. Only a verified ride passes the baton on.',
      placement: ['top'],
      interaction: 'next',
    },
    {
      id: 'ghost',
      ...(ghostOnJourney && journey ? { route: journey, target: tourTarget('ghost') } : { target: null }),
      whenMissing: { body: 'When a runner came before you, you race their ghost, replayed from the ride the server verified.' },
      category: 'Race a real run',
      title: 'Beat the ghost',
      body: ghostOnJourney ? 'This ghost replays the last runner’s verified ride. Race it in practice, no wallet needed.' : 'When a runner came before you, you race their ghost, replayed from the ride the server verified.',
      placement: ['bottom', 'top'],
      padding: 6,
      interaction: 'next',
    },
    {
      id: 'social-modes',
      route: pathFor('crew'),
      target: tourTarget('social-modes'),
      fallbackTargets: [tourTarget('nav-crew')],
      category: 'Don’t run alone',
      title: 'Crews and rivals',
      body: 'Keep a daily streak with up to five runners, or race two batons head to head in Rivals.',
      padding: 6,
      interaction: 'next',
    },
    {
      id: 'daily',
      route: pathFor('daily'),
      target: tourTarget('daily'),
      category: 'Today’s route',
      title: 'One course for everyone',
      body: 'Everyone rides the same Daily course. One official ride counts, and practice is unlimited.',
      interaction: 'next',
    },
    {
      id: 'profile-history',
      route: pathFor('profile'),
      target: tourTarget('profile-history'),
      fallbackTargets: [
        { target: tourTarget('profile-signin'), copy: { body: 'Sign in once, and every baton you carry stays on your profile with its proof.' } },
        { target: tourTarget('profile-runner'), copy: { body: 'Your runner level, achievements and every baton you carry stay on your profile.' } },
      ],
      category: 'Your relay history',
      title: 'Every leg stays with you',
      body: 'Batons you carried, the achievements they earned and your runner level all stay here.',
      interaction: 'next',
    },
  )
  return {
    id: CORE_TOUR_ID,
    version: CORE_TOUR_VERSION,
    steps,
    completion: {
      category: 'You’re ready',
      // No-break spaces keep each sentence on one line.
      title: 'Catch\u00a0it. Carry\u00a0it. Pass\u00a0it\u00a0on.',
      primaryLabel: 'Explore NIM Relay',
      secondary: { label: 'Try a practice run', to: PRACTICE_PATH },
      note: 'Replay this tour any time from your profile.',
    },
  }
}
