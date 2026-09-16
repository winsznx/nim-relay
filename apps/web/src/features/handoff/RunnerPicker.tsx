import { useMemo, useState } from 'react'
import { useRunnerWallets } from '../relays/data'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import type { RunnerChoice } from './machine'

export interface RunnerOption extends RunnerChoice {
  /** Short context shown under the name, e.g. "Crew · CT Humbs" or "Raced you yesterday". */
  context?: string
}

export interface RunnerGroup {
  title: string
  runners: RunnerOption[]
}

interface RunnerPickerProps {
  groups: RunnerGroup[]
  notice: string | null
  onSelect(runner: RunnerChoice): void
  onInvite(): void
}

export function RunnerPicker({ groups, notice, onSelect, onInvite }: RunnerPickerProps) {
  const wallets = useRunnerWallets()
  const [query, setQuery] = useState('')
  const total = groups.reduce((count, group) => count + group.runners.length, 0)
  const visibleGroups = useMemo(() => {
    const needle = query.trim().replace(/^@/, '').toLowerCase()
    if (!needle) return groups
    return groups
      .map(group => ({ ...group, runners: group.runners.filter(runner => runner.name.toLowerCase().includes(needle) || runner.handle.toLowerCase().includes(needle)) }))
      .filter(group => group.runners.length > 0)
  }, [groups, query])

  return (
    <section className="handoff-picker" aria-label="Choose the next runner">
      <p className="handoff-eyebrow">Handoff zone</p>
      <h2 className="handoff-title">Who carries it next?</h2>
      {notice && (
        <p className="handoff-notice" role="alert">
          {notice}
        </p>
      )}
      {total > 6 && (
        <input
          className="handoff-search"
          type="search"
          aria-label="Find a runner"
          placeholder="Find a runner"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      )}
      <div className="handoff-groups">
        {visibleGroups.map(group => (
          <div key={group.title} className="handoff-group">
            <h3>{group.title}</h3>
            <ul>
              {group.runners.map(runner => (
                <li key={`${group.title}-${runner.id}`}>
                  <button type="button" className="handoff-runner" onClick={() => onSelect(runner)}>
                    <RunnerAvatar name={runner.name} wallet={wallets.get(runner.id)} size={40} />
                    <span className="handoff-runner-text">
                      <strong>{runner.name}</strong>
                      <small>{runner.context ?? `@${runner.handle}`}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {total === 0 && <p className="handoff-muted">No other couriers have joined yet. Invite someone to carry the next leg.</p>}
      </div>
      <button type="button" className="handoff-secondary" onClick={onInvite}>
        Invite a new runner
      </button>
    </section>
  )
}
