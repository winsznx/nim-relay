import { linkProps, openOverlay, type RouteMatch } from './router'
import { Icon, type IconName } from './ui/Icon'

export const PLAY_OVERLAY = 'play'

interface Destination {
  label: string
  to: string
  icon: IconName
  /** Guided-tour target name. */
  tour: string
  matches: readonly RouteMatch['name'][]
}

const LEFT: readonly Destination[] = [
  { label: 'World', to: '/', icon: 'world', tour: 'nav-world', matches: ['world', 'relay', 'chronicle', 'proof', 'proofRelay', 'station'] },
  { label: 'Inbox', to: '/inbox', icon: 'inbox', tour: 'nav-inbox', matches: ['inbox', 'invite'] },
]
const RIGHT: readonly Destination[] = [
  { label: 'Crew', to: '/crew', icon: 'crew', tour: 'nav-crew', matches: ['crew', 'rivals'] },
  { label: 'Profile', to: '/profile', icon: 'profile', tour: 'nav-profile', matches: ['profile', 'runner', 'privacy'] },
]

function NavLink({ destination, current, badge }: { destination: Destination; current: RouteMatch['name']; badge?: number }) {
  const active = destination.matches.includes(current)
  return (
    <a className="nr-nav__item" aria-current={active ? 'page' : undefined} aria-label={badge ? `${destination.label}, ${badge} unread` : undefined} data-tour={destination.tour} {...linkProps(destination.to)}>
      <span className="nr-nav__icon">
        <Icon name={destination.icon} size={22} />
        {badge ? (
          <span className="nr-nav__badge nr-num" aria-hidden="true">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      <span className="nr-nav__label">{destination.label}</span>
    </a>
  )
}

export function BottomNav({ current, unread }: { current: RouteMatch['name']; unread: number }) {
  return (
    <nav className="nr-nav" aria-label="Main" data-tour="bottom-nav">
      {LEFT.map(destination => (
        <NavLink key={destination.to} destination={destination} current={current} badge={destination.to === '/inbox' ? unread : 0} />
      ))}
      <button type="button" className="nr-nav__play" onClick={() => openOverlay(PLAY_OVERLAY)} aria-haspopup="dialog">
        <span className="nr-nav__play-mark" aria-hidden="true" data-tour="nav-play">
          <svg width="26" height="30" viewBox="0 0 26 30">
            <path d="M13 1.5 24.5 8v14L13 28.5 1.5 22V8L13 1.5Z" fill="currentColor" />
            <path d="M13 8.5 18.6 11.7v6.6L13 21.5l-5.6-3.2v-6.6L13 8.5Z" fill="rgba(255,248,230,0.55)" />
          </svg>
        </span>
        <span className="nr-nav__label">Play</span>
      </button>
      {RIGHT.map(destination => (
        <NavLink key={destination.to} destination={destination} current={current} />
      ))}
    </nav>
  )
}
