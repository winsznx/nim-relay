import { useState, type CSSProperties } from 'react'
import type { BatonMode } from '@nim-relay/shared'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork } from '../relays/data'
import { navigate, pathFor, searchParam, useLocation } from '../shell/router'
import { useSession } from '../shell/session'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Loading } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { RunnerPicker } from './RunnerPicker'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

type StartMode = Extract<BatonMode, 'global' | 'quick' | 'crew'>

const MODES: readonly { mode: StartMode; label: string; description: string }[] = [
  { mode: 'global', label: 'Global', description: 'An open journey. Anyone the holder chooses can carry the next leg.' },
  { mode: 'quick', label: 'Quick', description: 'You and one friend pass the baton back and forth, best of three or five.' },
  { mode: 'crew', label: 'Crew', description: 'A baton that only moves between members of your crew.' },
]

function initialMode(value: string | null): StartMode {
  return value === 'quick' || value === 'crew' ? value : 'global'
}

export function StartRelayScreen({ entryKey }: { entryKey: string }) {
  const location = useLocation()
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const action = useAction()
  const refresh = useRefreshNetwork()
  const [mode, setMode] = useState<StartMode>(() => initialMode(searchParam(location, 'mode')))
  const [title, setTitle] = useState('')
  const [recipient, setRecipient] = useState('')
  const [bestOf, setBestOf] = useState<3 | 5>(3)

  if (!player) {
    return (
      <Screen title="Start a relay" entryKey={entryKey}>
        <SignInPrompt title="Put one NIM in motion" body="A relay starts with 1 NIM in your own wallet. Each verified pass moves it to the next runner." reason="Sign in to start a relay with your own NIM." />
      </Screen>
    )
  }
  const crew = snapshot?.crews.find(item => item.members.some(member => member.id === player.id))
  const selected = MODES.find(item => item.mode === mode) ?? MODES[0]
  const titleLength = title.trim().length
  const ready = (titleLength === 0 || titleLength >= 3) && (mode !== 'quick' || recipient !== '') && (mode !== 'crew' || crew !== undefined)

  return (
    <Screen title="Start a relay" entryKey={entryKey}>
      <form
        onSubmit={event => {
          event.preventDefault()
          action.run(async () => {
            const created = await api.createBaton({
              mode,
              title: title.trim(),
              ...(mode === 'quick' ? { recipient, bestOf } : {}),
              ...(mode === 'crew' && crew ? { crewId: crew.id } : {}),
            })
            refresh()
            navigate(pathFor('relay', { code: created.baton.code }), { replace: true })
          })
        }}
      >
        <fieldset className="nr-fieldset">
          <legend className="nr-field__label">Relay type</legend>
          <div className="nr-segmented" style={{ '--nr-segments': MODES.length } as CSSProperties}>
            {MODES.map(item => (
              <button key={item.mode} type="button" aria-pressed={item.mode === mode} onClick={() => setMode(item.mode)}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="nr-field__hint">{selected?.description}</p>
        </fieldset>

        <label className="nr-field">
          <span className="nr-field__label">Journey name (optional)</span>
          <input className="nr-input" value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={60} placeholder={mode === 'global' ? 'For example, Lagos to anywhere' : 'Name this relay'} />
          <span className="nr-field__hint">Leave it empty and the relay is named by its number, like {mode === 'quick' ? 'Quick Relay' : mode === 'crew' ? 'Crew Relay' : 'Global Relay'} #001.</span>
        </label>

        {mode === 'quick' &&
          (snapshot ? (
            <>
              <RunnerPicker label="Your opponent" runners={snapshot.runners} selfId={player.id} value={recipient} onChange={setRecipient} />
              <fieldset className="nr-fieldset">
                <legend className="nr-field__label">Match length</legend>
                <div className="nr-segmented" style={{ '--nr-segments': 2 } as CSSProperties}>
                  {([3, 5] as const).map(value => (
                    <button key={value} type="button" aria-pressed={bestOf === value} onClick={() => setBestOf(value)}>
                      Best of {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            loading && <Loading label="Loading runners" />
          ))}

        {mode === 'crew' && !crew && (
          <div className="nr-panel">
            <p>Crew relays need a crew. Create one or join with a code first.</p>
            <div className="nr-actions">
              <LinkButton variant="secondary" to={pathFor('crew')}>
                Go to Crew
              </LinkButton>
            </div>
          </div>
        )}

        <div className="nr-panel nr-panel--gold">
          <h3>Keep 1 NIM ready</h3>
          <p>The baton is 1 NIM from your own wallet. Every pass is a real transfer you approve in Nimiq Pay. Scores earn recognition, never money.</p>
        </div>

        <div className="nr-actions nr-actions--stack">
          <Button type="submit" variant="primary" size="lg" block busy={action.pending} disabled={!ready}>
            Start relay
          </Button>
        </div>
      </form>
    </Screen>
  )
}
