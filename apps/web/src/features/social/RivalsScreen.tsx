import { useState } from 'react'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork } from '../relays/data'
import { formatCount } from '../relays/format'
import { linkProps, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { useAction } from '../shell/use-action'
import { Button } from '../shell/ui/Button'
import { EmptyState, Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { RunnerPicker } from './RunnerPicker'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

export function RivalsScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const action = useAction()
  const refresh = useRefreshNetwork()
  const [title, setTitle] = useState('')
  const [opponent, setOpponent] = useState('')
  const [target, setTarget] = useState(10)

  return (
    <Screen title="Rivals" entryKey={entryKey} parent={pathFor('crew')}>
      <p className="nr-lede">Two separate batons, one of 1 NIM each. The first team to reach the target of verified handoffs takes the title. Nothing is wagered and nobody wins money.</p>
      {!player ? (
        <SignInPrompt title="Start a rivalry" body="Pick a runner, name the rivalry and race your batons across the network." reason="Sign in to start a rivalry." />
      ) : !snapshot ? (
        loading && <Loading label="Loading rivalries" />
      ) : (
        <form
          className="nr-panel"
          onSubmit={event => {
            event.preventDefault()
            action.run(async () => {
              await api.createNetworkRival({ title: title.trim(), opponent, target })
              setTitle('')
              setOpponent('')
              refresh()
            })
          }}
        >
          <label className="nr-field">
            <span className="nr-field__label">Rivalry name</span>
            <input className="nr-input" value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={60} required placeholder="For example, North vs South" />
          </label>
          <RunnerPicker label="Rival runner" runners={snapshot.runners} selfId={player.id} value={opponent} onChange={setOpponent} />
          <label className="nr-field">
            <span className="nr-field__label">Handoffs to win</span>
            <input className="nr-input nr-num" type="number" inputMode="numeric" min={2} max={50} value={target} onChange={event => setTarget(Math.max(2, Math.min(50, Number(event.target.value) || 2)))} />
          </label>
          <Button type="submit" variant="primary" block busy={action.pending} disabled={title.trim().length < 3 || !opponent}>
            Start rivalry
          </Button>
        </form>
      )}

      {snapshot && (
        <section className="nr-section" aria-labelledby="rivalries">
          <SectionHeader id="rivalries" title="Rivalries" />
          {snapshot.rivals.length === 0 ? (
            <EmptyState title="No rivalries yet" body="The first rivalry on the network starts with two runners and two batons." />
          ) : (
            <ul className="nr-list">
              {snapshot.rivals.map(rival => {
                const [first, second] = rival.batonIds.map(id => snapshot.batons.find(baton => baton.id === id))
                return (
                  <li key={rival.id} className="nr-rivalry">
                    <p className="nr-rivalry__title">{rival.title}</p>
                    <div className="nr-rivalry__score">
                      {[first, second].map((baton, index) => (
                        <a key={rival.batonIds[index]} className={`nr-rivalry__team nr-rivalry__team--${index === 0 ? 'gold' : 'cyan'}`} {...linkProps(pathFor('relay', { code: baton?.code ?? rival.batonIds[index] ?? '' }))}>
                          <span className="nr-rivalry__points nr-num">{formatCount(rival.scores[index] ?? 0)}</span>
                          <span className="nr-rivalry__name">{baton?.origin.name ?? `Team ${index + 1}`}</span>
                        </a>
                      ))}
                    </div>
                    <p className="nr-row__meta">
                      {rival.winnerId
                        ? `Won by ${snapshot.batons.find(baton => baton.id === rival.winnerId)?.origin.name ?? 'a team'}.`
                        : `First to ${rival.target} handoffs. Ends ${new Date(rival.endsAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}.`}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </Screen>
  )
}
