import { useId } from 'react'
import { FRESH_BATON, MAX_MARKERS, RING_THRESHOLDS, type BatonAppearance } from './baton-appearance'

interface BatonEmblemProps {
  /** Omitted or undefined draws a fresh baton. */
  appearance?: BatonAppearance | undefined
  /** Rendered size in CSS pixels. */
  size?: number | undefined
  /** Accessible name. Omit when the emblem sits next to text that already names the baton. */
  label?: string | undefined
  className?: string | undefined
}

const AURA_GLOW = { none: 0, warm: 0.35, radiant: 0.6, legendary: 0.85 } as const

function hexPoints(cx: number, cy: number, radius: number): string {
  const points: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`)
  }
  return points.join(' ')
}

/** Small 2D baton for lists and cards, drawn from the same appearance as the 3D baton. */
export function BatonEmblem({ appearance = FRESH_BATON, size = 32, label, className }: BatonEmblemProps) {
  const id = useId().replace(/:/g, '')
  const rings = Math.min(RING_THRESHOLDS.length, appearance.rings)
  const markers = Math.min(MAX_MARKERS, appearance.markers)
  const glow = AURA_GLOW[appearance.aura]
  const decorative = label === undefined

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative ? true : undefined}
    >
      <defs>
        <linearGradient id={`${id}-core`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="0.45" stopColor="#f5a623" />
          <stop offset="1" stopColor="#b8650a" />
        </linearGradient>
        <radialGradient id={`${id}-aura`}>
          <stop offset="0" stopColor="#ffcf6b" stopOpacity={glow} />
          <stop offset="1" stopColor="#f5a623" stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow > 0 && <circle cx="32" cy="32" r="31" fill={`url(#${id}-aura)`} />}
      {Array.from({ length: rings }, (_, i) => (
        <polygon
          key={`ring-${i}`}
          points={hexPoints(32, 32, 20 + i * 1.6)}
          fill="none"
          stroke="#ffd98a"
          strokeOpacity={0.75 - i * 0.07}
          strokeWidth="0.9"
        />
      ))}
      <polygon points={hexPoints(32, 32, 17)} fill={`url(#${id}-core)`} />
      <polygon points={hexPoints(32, 32, 9)} fill="#fff1cf" fillOpacity={0.55 + appearance.pulse * 0.35} />
      {Array.from({ length: Math.min(3, appearance.scars) }, (_, i) => (
        <path
          key={`scar-${i}`}
          d={`M ${22 + i * 5} ${24 + i * 6} l 6 3 l 3 -2 l 7 4`}
          fill="none"
          stroke="#3a1a02"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {Array.from({ length: markers }, (_, i) => {
        const angle = (i / Math.max(1, markers)) * Math.PI * 2 - Math.PI / 2
        return <circle key={`marker-${i}`} cx={32 + Math.cos(angle) * 28} cy={32 + Math.sin(angle) * 28} r="1.7" fill="#ffe2a3" />
      })}
    </svg>
  )
}
