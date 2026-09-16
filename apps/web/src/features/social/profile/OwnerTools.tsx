import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StationSnapshot } from '@nim-relay/shared'
import * as station from '../../../station/api'
import * as api from '../../relays/api'
import { relayKeys, useRefreshNetwork } from '../../relays/data'
import { formatCount } from '../../relays/format'
import { copyText } from '../../shell/share'
import { useAction } from '../../shell/use-action'
import { Button } from '../../shell/ui/Button'
import { Icon } from '../../shell/ui/Icon'
import { SectionHeader } from '../../shell/ui/primitives'
import './profile.css'

const CATEGORY_LABELS: Record<StationSnapshot['cosmetics'][number]['category'], string> = { suit: 'Suit', helmet: 'Helmet', board: 'Board', trail: 'Trail' }

export function Locker({ data }: { data: StationSnapshot }) {
  const client = useQueryClient()
  const action = useAction()
  const { profile, cosmetics } = data
  return (
    <section className="nr-section" aria-labelledby="locker">
      <SectionHeader id="locker" title="Courier locker" detail={`${formatCount(profile.xp)} XP earned. Items unlock with XP from verified rides.`} />
      <ul className="nr-locker">
        {cosmetics.map(item => {
          const unlocked = profile.unlocked.includes(item.id)
          const equipped = profile.equipped[item.category] === item.id
          return (
            <li key={item.id} className={`nr-locker__item${equipped ? ' nr-locker__item--equipped' : ''}${unlocked ? '' : ' nr-locker__item--locked'}`}>
              <span className="nr-locker__category">{CATEGORY_LABELS[item.category]}</span>
              <span className="nr-locker__name">{item.name}</span>
              <Button
                variant={equipped ? 'quiet' : 'secondary'}
                size="sm"
                disabled={!unlocked || equipped || action.pending}
                onClick={() =>
                  action.run(async () => {
                    client.setQueryData(relayKeys.station, await station.customizeCourier({ category: item.category, cosmetic: item.id }))
                  })
                }
              >
                {equipped ? 'Equipped' : unlocked ? 'Equip' : `${formatCount(item.xp)} XP`}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface ProfileSettingsProps {
  currentName: string
  countryConsent: boolean | null
}

export function ProfileSettings({ currentName, countryConsent }: ProfileSettingsProps) {
  const client = useQueryClient()
  const refresh = useRefreshNetwork()
  const action = useAction()
  const [name, setName] = useState('')
  return (
    <section className="nr-section" aria-labelledby="settings">
      <SectionHeader id="settings" title="Settings" />
      <form
        className="nr-inline-form"
        onSubmit={event => {
          event.preventDefault()
          action.run(async () => {
            client.setQueryData(relayKeys.station, await station.customizeCourier({ name: name.trim() }))
            setName('')
            refresh()
          })
        }}
      >
        <label className="nr-field">
          <span className="nr-field__label">Runner name</span>
          <input className="nr-input" value={name} onChange={event => setName(event.target.value)} placeholder={currentName} maxLength={24} />
        </label>
        <Button type="submit" variant="secondary" disabled={name.trim().length < 2} busy={action.pending}>
          Save name
        </Button>
      </form>
      <label className="nr-check nr-check--setting">
        <input
          type="checkbox"
          checked={countryConsent ?? false}
          disabled={countryConsent === null || action.pending}
          onChange={event => {
            const consent = event.target.checked
            action.run(async () => {
              await api.setCountryConsent(consent)
              refresh()
            })
          }}
        />
        <span>
          Show my country on relay routes
          <span className="nr-field__hint">Approximate, from your network connection. Off by default. No exact location or IP address is kept.</span>
        </span>
      </label>
    </section>
  )
}

/** The wallet behind the runner, kept out of sight until the runner asks for it. */
export function ProofDisclosure({ wallet }: { wallet: string }) {
  const action = useAction()
  return (
    <details className="nr-proof-disclosure">
      <summary>
        <Icon name="shield" size={18} />
        <span>Proof</span>
        <span className="nr-proof-disclosure__hint">Your Nimiq address</span>
      </summary>
      <p className="nr-note">Every handoff you send or receive is a public Nimiq transaction from or to this address, so anyone can check it on an explorer.</p>
      <div className="nr-copyable">
        <code className="nr-hash">{wallet}</code>
        <button type="button" className="nr-icon-button" aria-label="Copy your Nimiq address" onClick={() => action.run(() => copyText(wallet, 'Address copied.'))}>
          <Icon name="copy" size={16} />
        </button>
      </div>
    </details>
  )
}
