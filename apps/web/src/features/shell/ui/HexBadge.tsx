import { useId, type ReactNode } from 'react'
import './game.css'

interface HexBadgeProps {
  /** A glyph drawn on a 24 by 24 grid with `currentColor`, or one to three characters. */
  children: ReactNode
  /** Locked badges are dimmed outlines of the badge they will become. */
  locked?: boolean
  /** `crew` takes its color from `--nr-crew-color` on an ancestor. */
  tone?: 'gold' | 'crew'
  size?: number
}

const HEX = 'M28 2.5 52.5 16.6v30.8L28 61.5 3.5 47.4V16.6L28 2.5Z'
const INNER = 'M28 9.8 46.2 20.3v23.4L28 54.2 9.8 43.7V20.3L28 9.8Z'

/** The baton's hexagon as an achievement badge. Decorative: pair it with visible text. */
export function HexBadge({ children, locked = false, tone = 'gold', size = 56 }: HexBadgeProps) {
  const id = useId()
  const fill = `${id}-fill`
  return (
    <svg className={`nr-hex-badge nr-hex-badge--${tone}${locked ? ' nr-hex-badge--locked' : ''}`} width={size} height={(size * 64) / 56} viewBox="0 0 56 64" aria-hidden="true">
      <defs>
        <linearGradient id={fill} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="nr-hex-badge__stop-light" />
          <stop offset="0.55" className="nr-hex-badge__stop-mid" />
          <stop offset="1" className="nr-hex-badge__stop-deep" />
        </linearGradient>
      </defs>
      <path className="nr-hex-badge__frame" d={HEX} fill={locked ? undefined : `url(#${fill})`} />
      <path className="nr-hex-badge__inner" d={INNER} />
      {typeof children === 'string' ? (
        <text className="nr-hex-badge__text" x="28" y="32" textAnchor="middle" dominantBaseline="central">
          {children}
        </text>
      ) : (
        <svg className="nr-hex-badge__glyph" x="14" y="18" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      )}
    </svg>
  )
}
