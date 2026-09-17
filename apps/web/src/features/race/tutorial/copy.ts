import { possessive } from '../format'
import type { CoachView } from './machine'
import type { CoachInput } from './steps'

export interface CoachCopy {
  heading: string
  line: string
}

/** A prompt's words: the control in the heading, how or why in one short line. Keyboard players read their keys. */
export function coachCopy(view: Pick<CoachView, 'step' | 'grinding'>, input: CoachInput, ghostName: string | null): CoachCopy {
  const touch = input === 'touch'
  switch (view.step) {
    case 'lane':
      return { heading: touch ? 'SWIPE LEFT OR RIGHT' : 'PRESS ← OR →', line: 'Change lanes.' }
    case 'jump':
      return { heading: touch ? 'SWIPE UP TO JUMP' : 'PRESS ↑ TO JUMP', line: 'Just before you reach it.' }
    case 'slide':
      return { heading: touch ? 'SWIPE DOWN TO SLIDE' : 'PRESS ↓ TO SLIDE', line: 'Just before you reach it.' }
    case 'ghostline':
      return { heading: 'FOLLOW OR BREAK THE GHOSTLINE', line: `Ride ${ghostName ? possessive(ghostName) : 'the'} line to build FLOW.` }
    case 'edge':
      return { heading: 'STAY OFF THE EDGE', line: view.grinding ? 'Steer back to save it.' : 'Steer back into a lane.' }
    case 'flow':
      return { heading: 'FILL YOUR FLOW', line: 'Clean lines and near misses make you faster.' }
  }
}
