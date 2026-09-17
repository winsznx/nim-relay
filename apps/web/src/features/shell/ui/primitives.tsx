import type { CSSProperties, ReactNode } from 'react'

export type PillTone = 'neutral' | 'live' | 'verified' | 'gold' | 'danger'

/** Status badge. Cyan tones mean live or verified; gold means the baton or its holder. */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`nr-pill nr-pill--${tone}`}>
      <span className="nr-pill__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function Stat({ value, label, gold = false }: { value: ReactNode; label: string; gold?: boolean }) {
  return (
    <div className="nr-stat">
      <span className={`nr-stat__value${gold ? ' nr-stat__value--gold' : ''}`}>{value}</span>
      <span className="nr-stat__label">{label}</span>
    </div>
  )
}

/** `relay` sizes four columns for the standard relay stats: handoffs, wallets, countries, time alive. */
export function StatRow({ columns = 4, children, label, relay = false }: { columns?: number; children: ReactNode; label?: string; relay?: boolean }) {
  return (
    <div className={`nr-stat-row${relay ? ' nr-stat-row--relay' : ''}`} style={{ '--nr-stat-columns': columns } as CSSProperties} role="group" aria-label={label}>
      {children}
    </div>
  )
}

export function SectionHeader({ title, detail, action, id }: { title: string; detail?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="nr-section-header">
      <div>
        <h2 id={id}>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  )
}

/** `tour` names the empty state as a guided-tour target. */
export function EmptyState({ title, body, children, tour }: { title: string; body: ReactNode; children?: ReactNode; tour?: string }) {
  return (
    <div className="nr-empty" data-tour={tour}>
      <svg width="34" height="38" viewBox="0 0 34 38" aria-hidden="true">
        <path d="M17 1.8 31.5 10v18L17 36.2 2.5 28V10L17 1.8Z" fill="none" stroke="rgba(245,166,35,0.55)" strokeWidth="1.5" />
        <path d="M17 11.5 24.5 15.8v6.4L17 26.5l-7.5-4.3v-6.4L17 11.5Z" fill="rgba(245,166,35,0.16)" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="nr-loading" role="status">
      {label}
    </p>
  )
}
