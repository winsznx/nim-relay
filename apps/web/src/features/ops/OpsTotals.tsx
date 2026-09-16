import { useId, type ReactNode } from 'react'
import type { OpsTotals as Totals, ShareSurface } from '@nim-relay/shared'
import { formatCount, formatDuration } from '../relays/format'
import { SectionHeader } from '../shell/ui/primitives'
import { DEFINITIONS, SURFACE_LABELS } from './copy'

interface Part {
  label: string
  value: number
  /** Marks a part that needs attention whenever it is above zero. */
  watch?: boolean
}

const SURFACES: readonly ShareSurface[] = ['result', 'handoff', 'chronicle', 'daily', 'crew']

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="nr-ops-group" role="group" aria-labelledby={id}>
      <h3 id={id} className="nr-ops-group__title">
        {title}
      </h3>
      <dl className="nr-ops-metrics">{children}</dl>
    </div>
  )
}

function Metric({ label, value, definition, gold = false }: { label: string; value: string; definition: string; gold?: boolean }) {
  return (
    <div className="nr-ops-metric">
      <dt>{label}</dt>
      <dd className={`nr-ops-metric__value nr-num${gold ? ' nr-ops-metric__value--gold' : ''}`}>{value}</dd>
      <dd className="nr-ops-definition">{definition}</dd>
    </div>
  )
}

function SplitMetric({ label, total, parts, definition }: { label: string; total?: number; parts: readonly Part[]; definition: string }) {
  return (
    <div className="nr-ops-metric">
      <dt>{label}</dt>
      {total !== undefined && <dd className="nr-ops-metric__value nr-num">{formatCount(total)}</dd>}
      <dd className="nr-ops-split">
        <ul>
          {parts.map(part => (
            <li key={part.label} className={part.watch && part.value > 0 ? 'nr-ops-split__part nr-ops-split__part--watch' : 'nr-ops-split__part'}>
              <span className="nr-num">{formatCount(part.value)}</span> {part.label}
            </li>
          ))}
        </ul>
      </dd>
      <dd className="nr-ops-definition">{definition}</dd>
    </div>
  )
}

/** All-time totals, grouped the way an operator reads them: who is here, what moved, who is talking about it. */
export function OpsTotals({ totals }: { totals: Totals }) {
  const { batons, invites, shares, evidence } = totals
  const shareParts: Part[] = SURFACES.map(surface => ({ label: SURFACE_LABELS[surface].toLowerCase(), value: shares.bySurface[surface] }))
  if (shares.unattributed > 0) shareParts.push({ label: 'before surfaces were tracked', value: shares.unattributed })
  return (
    <section className="nr-section" aria-labelledby="ops-totals">
      <SectionHeader id="ops-totals" title="Network totals" detail="Everything this Worker has recorded." />
      <div className="nr-ops-groups">
        <Group title="Wallets">
          <Metric label="Linked wallets" value={formatCount(totals.linkedWallets)} definition={DEFINITIONS.linkedWallets} />
          <Metric label="Transacting wallets" value={formatCount(totals.transactingWallets)} definition={DEFINITIONS.transactingWallets} />
          <Metric label="Returning wallets" value={formatCount(totals.returningWallets)} definition={DEFINITIONS.returningWallets} />
        </Group>
        <Group title="Handoffs and batons">
          <Metric gold label="Qualified handoffs" value={formatCount(totals.qualifiedHandoffs)} definition={DEFINITIONS.qualifiedHandoffs} />
          <SplitMetric
            label="Batons"
            parts={[
              { label: 'active', value: batons.active },
              { label: 'stranded', value: batons.stranded, watch: true },
              { label: 'completed', value: batons.completed },
            ]}
            definition={DEFINITIONS.batons}
          />
          <SplitMetric
            label="Evidence split"
            parts={[
              { label: 'mainnet handoffs', value: evidence.mainnetHandoffs },
              { label: 'testnet handoffs', value: evidence.testnetHandoffs },
              { label: 'wallets in test evidence', value: evidence.controlledWallets },
            ]}
            definition={DEFINITIONS.evidence}
          />
        </Group>
        <Group title="Crews, rivals and invites">
          <Metric label="Crews" value={formatCount(totals.crews)} definition={DEFINITIONS.crews} />
          <Metric label="Rivalries" value={formatCount(totals.rivals)} definition={DEFINITIONS.rivals} />
          <SplitMetric
            label="Invites"
            parts={[
              { label: 'created', value: invites.created },
              { label: 'opened', value: invites.opened },
              { label: 'accepted', value: invites.converted },
            ]}
            definition={DEFINITIONS.invites}
          />
        </Group>
        <Group title="Attention">
          <SplitMetric label="Shares" total={shares.total} parts={shareParts} definition={DEFINITIONS.shares} />
          <Metric label="Chronicle views" value={formatCount(totals.chronicleViews)} definition={DEFINITIONS.chronicleViews} />
          <Metric label="Foreground time" value={formatDuration(totals.foregroundSeconds * 1000)} definition={DEFINITIONS.foregroundSeconds} />
        </Group>
      </div>
    </section>
  )
}
