import type { NetworkSnapshot } from '@nim-relay/shared'
import { worldName } from '../relays/format'
import type { RelayView } from '../relays/model'
import { closeOverlay, navigate, pathFor } from './router'
import { BatonEmblem } from '../baton/BatonEmblem'
import { useRequireRunner } from './session'
import { setSoundEnabled, useSoundEnabled } from './sound'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { BottomSheet } from './ui/overlays'

interface PlaySheetProps {
  open: boolean
  playerId: string | null
  relays: readonly RelayView[]
  snapshot: NetworkSnapshot | undefined
}

/** The Play button's chooser: carry a baton you hold, ride the Daily, or practice. */
export function PlaySheet({ open, playerId, relays, snapshot }: PlaySheetProps) {
  const requireRunner = useRequireRunner()
  const sound = useSoundEnabled()
  const yourTurns = playerId ? relays.filter(relay => relay.holder.id === playerId && relay.status !== 'completed') : []
  const daily = snapshot?.daily
  return (
    <BottomSheet open={open} title="Play" onClose={closeOverlay}>
      <p className="nr-sheet-lead">Race a leg of the relay. Only a ride the server verifies can pass the baton on.</p>
      {yourTurns.length > 0 && (
        <section aria-labelledby="play-your-turn">
          <h3 id="play-your-turn" className="nr-sheet-heading">
            Your turn
          </h3>
          <ul className="nr-list">
            {yourTurns.map(relay => (
              <li key={relay.id}>
                <button type="button" className="nr-row nr-choice nr-choice--gold" onClick={() => navigate(pathFor('leg', { code: relay.code }))}>
                  <BatonEmblem appearance={relay.appearance} size={40} />
                  <span className="nr-row__body">
                    <span className="nr-row__title">Carry {relay.name}</span>
                    <span className="nr-row__meta">{relay.identity}, leg {relay.handoffCount + 1}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="nr-list">
        <li>
          <button type="button" className="nr-row nr-choice" onClick={() => navigate(pathFor('daily'))}>
            <span className="nr-choice__glyph" aria-hidden="true">
              <Icon name="world" size={22} />
            </span>
            <span className="nr-row__body">
              <span className="nr-row__title">Daily Circuit</span>
              <span className="nr-row__meta">{daily ? `Today on ${worldName(daily.world)}. One official ride, unlimited practice.` : 'One official ride a day, unlimited practice.'}</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        </li>
        <li>
          <button type="button" className="nr-row nr-choice" onClick={() => navigate('/leg/practice')}>
            <span className="nr-choice__glyph" aria-hidden="true">
              <Icon name="play" size={20} />
            </span>
            <span className="nr-row__body">
              <span className="nr-row__title">Practice a relay leg</span>
              <span className="nr-row__meta">No wallet and no NIM. Learn the line.</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        </li>
        <li>
          <button type="button" className="nr-row nr-choice" onClick={() => requireRunner('Sign in to start a relay with your own NIM.', () => navigate(pathFor('start')))}>
            <span className="nr-choice__glyph" aria-hidden="true">
              <BatonEmblem size={26} />
            </span>
            <span className="nr-row__body">
              <span className="nr-row__title">Start a relay</span>
              <span className="nr-row__meta">Put 1 NIM in motion and pick who carries it next.</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        </li>
        <li>
          <button type="button" className="nr-row nr-choice" onClick={() => navigate(pathFor('station'))}>
            <span className="nr-choice__glyph" aria-hidden="true">
              <Icon name="station" size={22} />
            </span>
            <span className="nr-row__body">
              <span className="nr-row__title">Relay Station</span>
              <span className="nr-row__meta">Departures, your vault and rankings in one place.</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        </li>
      </ul>
      <div className="nr-sheet-footer">
        <span className="nr-field__hint">Race sound and haptics</span>
        <Button variant="quiet" size="sm" aria-pressed={sound} onClick={() => setSoundEnabled(!sound)}>
          <Icon name={sound ? 'sound' : 'muted'} size={18} />
          {sound ? 'On' : 'Off'}
        </Button>
      </div>
    </BottomSheet>
  )
}
