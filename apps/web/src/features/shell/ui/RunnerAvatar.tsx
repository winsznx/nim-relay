import type { CSSProperties } from 'react'
import { flagFor, initials } from '../../relays/format'
import { useIdenticon } from './identicon'
import './game.css'

interface RunnerAvatarProps {
  name: string
  /** The runner's Nimiq address. Initials show until its identicon is ready, and stay when there is none. */
  wallet?: string | null | undefined
  /** Consented, network-observed country; shown as a small flag. */
  country?: string | null | undefined
  /** Gold ring for the runner currently holding a baton. */
  holder?: boolean
  size?: number
}

/** A runner as Nimiq Pay shows them: the identicon of their wallet. */
export function RunnerAvatar({ name, wallet = null, country = null, holder = false, size = 40 }: RunnerAvatarProps) {
  const identicon = useIdenticon(wallet)
  const flag = flagFor(country)
  const className = ['nr-avatar', identicon ? 'nr-avatar--identicon' : '', holder ? 'nr-avatar--holder' : ''].filter(Boolean).join(' ')
  return (
    <span className={className} style={{ '--nr-avatar-size': `${size}px` } as CSSProperties} aria-hidden="true">
      {identicon ? <img className="nr-avatar__identicon" src={identicon} alt="" draggable={false} /> : initials(name)}
      {flag && <span className="nr-avatar__flag">{flag}</span>}
    </span>
  )
}
