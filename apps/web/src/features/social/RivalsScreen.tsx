import { useState } from 'react'
import type { NetworkSnapshot } from '@nim-relay/shared'
import * as api from '../relays/api'
import { useNetwork, useNow, useRefreshNetwork } from '../relays/data'
import { pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { useAction } from '../shell/use-action'
import { Button } from '../shell/ui/Button'
import { Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { rivalView, sortRivals } from './model/rivals'
import { RivalRace } from './rivals/RivalRace'
import { RunnerPicker } from './RunnerPicker'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

function StartRivalry({ snapshot, playerId, onDone }: { snapshot: NetworkSnapshot; playerId: string; onDone(): void }) {
  const action = useAction()
  const refresh = useRefreshNetwork()
  const [title, setTitle] = useState('')
  const [opponent, setOpponent] = useState('')
  const [target, setTarget] = useState(10)
  return (
    <form
      className="nr-panel"
      onSubmit={event => {
        event.preventDefault()
        action.run(async () => {
          await api.createNetworkRival({ title: title.trim(), opponent, target })
          setTitle('')
          setOpponent('')
          refresh()
          onDone()
        })
      }}
    >
      <label className="nr-field">
        <span className="nr-field__label">Rivalry name</span>
        <input className="nr-input" value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={60} required placeholder="For example, North vs South" />
      </label>
      <RunnerPicker label="Rival runner" runners={snapshot.runners} selfId={playerId} value={opponent} onChange={setOpponent} />
      <label className="nr-field">
        <span className="nr-field__label">Handoffs to win</span>
        <input className="nr-input nr-num" type="number" inputMode="numeric" min={2} max={50} value={target} onChange={event => setTarget(Math.max(2, Math.min(50, Number(event.target.value) || 2)))} />
      </label>
      <Button type="submit" variant="primary" block busy={action.pending} disabled={title.trim().length < 3 || !opponent}>
        Start rivalry
      </Button>
    </form>
  )
}

export function RivalsScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const now = useNow()
  const [composing, setComposing] = useState(false)
  const playerId = player?.id ?? null
  const views = snapshot ? sortRivals(snapshot.rivals.map(rival => rivalView(rival, snapshot.batons, playerId, now)), new Map(snapshot.rivals.map(rival => [rival.id, rival.createdAt]))) : []

  return (
    <Screen title="Rivals" entryKey={entryKey} parent={pathFor('crew')}>
      <p className="nr-lede">Gold against cyan: two batons of 1 NIM each. The first team to reach the target of verified handoffs takes the rivalry. Nothing is wagered and nobody wins money.</p>

      {!snapshot && loading && <Loading label="Loading rivalries" />}
      {views.length > 0 && (
        <section className="nr-section" aria-labelledby="rivalries">
          <SectionHeader id="rivalries" title="Rivalries" />
          <div className="nr-rivals">
            {views.map(view => (
              <RivalRace key={view.id} view={view} playerId={playerId} />
            ))}
          </div>
        </section>
      )}

      <section className="nr-section" aria-labelledby="start-rivalry">
        <SectionHeader
          id="start-rivalry"
          title={snapshot && views.length === 0 ? 'No rivalries yet' : 'Start a rivalry'}
          detail={snapshot && views.length === 0 ? 'The first rivalry on the network starts with two runners and two batons.' : undefined}
          action={
            player && snapshot && views.length > 0 ? (
              <Button variant="quiet" aria-expanded={composing} onClick={() => setComposing(value => !value)}>
                {composing ? 'Close' : 'New rivalry'}
              </Button>
            ) : undefined
          }
        />
        {!player ? (
          <SignInPrompt title="Challenge a runner" body="Pick a runner, name the rivalry and race your batons across the network." reason="Sign in to start a rivalry." />
        ) : snapshot && (composing || views.length === 0) ? (
          <StartRivalry snapshot={snapshot} playerId={player.id} onDone={() => setComposing(false)} />
        ) : null}
      </section>
    </Screen>
  )
}
