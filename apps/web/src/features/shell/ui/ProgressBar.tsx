import type { CSSProperties } from 'react'
import './game.css'

interface ProgressBarProps {
  value: number
  max: number
  /** What is measured, for assistive technology. */
  label: string
  /** Spoken value, e.g. "250 of 500 XP". */
  valueText?: string
  /** `crew` takes its color from `--nr-crew-color` on an ancestor. */
  tone?: 'gold' | 'cyan' | 'crew'
  size?: 'sm' | 'md'
}

export function ProgressBar({ value, max, label, valueText, tone = 'gold', size = 'md' }: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div
      className={`nr-progress nr-progress--${tone} nr-progress--${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={valueText}
      style={{ '--nr-progress': ratio } as CSSProperties}
    >
      <span className="nr-progress__fill" />
    </div>
  )
}
