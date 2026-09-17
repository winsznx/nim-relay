import { useState } from 'react'
import { searchRunners, type OpenRoster, type RunnerOption } from '../leg/runner-groups'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { HoloCard, HoloItem, HoloList } from './holo'

interface RunnerPickerProps {
  roster: OpenRoster
  notice: string | null
  onSelect(runner: RunnerOption): void
}

function emptyCopy(rule: OpenRoster['rule']): string {
  switch (rule) {
    case 'crew':
      return 'Nobody else is in your crew yet. Share your crew code from the Crew tab, then pass the baton.'
    case 'match':
      return 'Your match opponent isn’t on the relay network right now. Keep the baton until they’re back.'
    case null:
      return 'No one you’ve relayed with yet. Send the invite link, or find a runner by handle.'
  }
}

interface Group {
  id: string
  title: string
  runners: RunnerOption[]
  featured: boolean
}

/**
 * Nobody is waiting for this baton yet. The runners the player relays with sit on one rail, grouped as friends,
 * crew and recent opponents, with the most recently active runner recommended at the end.
 */
export function RunnerPicker({ roster, notice, onSelect }: RunnerPickerProps) {
  const groups: Group[] = [
    ...roster.sections.map(section => ({ id: section.id, title: section.title, runners: section.runners, featured: false })),
    ...(roster.recommended ? [{ id: 'recommended', title: 'Recommended', runners: [roster.recommended], featured: true }] : []),
  ]
  return (
    <HoloCard className="handoff-picker" role="region" label="Choose the next runner">
      <header className="handoff-picker__head">
        <p className="handoff-eyebrow">Handoff zone</p>
        <h2 className="handoff-title handoff-title--picker">Who carries it next?</h2>
      </header>
      {notice && (
        <p className="handoff-notice" role="alert">
          {notice}
        </p>
      )}
      {groups.length > 0 ? (
        <div className="handoff-rail">
          {groups.map(group => (
            <section key={group.id} className="handoff-rail__group" aria-labelledby={`handoff-group-${group.id}`}>
              <h3 id={`handoff-group-${group.id}`} className="handoff-rail__title">
                {group.title}
              </h3>
              <HoloList className="handoff-rail__list">
                {group.runners.map(runner => (
                  <HoloItem key={runner.id}>
                    <button type="button" className={`handoff-tile${group.featured ? ' handoff-tile--featured' : ''}`} onClick={() => onSelect(runner)}>
                      <RunnerAvatar name={runner.name} wallet={runner.wallet} country={runner.country} size={40} />
                      <span className="handoff-tile__name">{runner.name}</span>
                      <span className="handoff-tile__context">{runner.context}</span>
                    </button>
                  </HoloItem>
                ))}
              </HoloList>
            </section>
          ))}
        </div>
      ) : (
        <p className="handoff-muted">{emptyCopy(roster.rule)}</p>
      )}
      <RunnerSearch directory={roster.directory} crewOnly={roster.rule === 'crew'} onSelect={onSelect} />
    </HoloCard>
  )
}

function RunnerSearch({ directory, crewOnly, onSelect }: { directory: readonly RunnerOption[]; crewOnly: boolean; onSelect(runner: RunnerOption): void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  if (directory.length === 0) return null
  if (!open) {
    return (
      <button type="button" className="handoff-quiet handoff-search-open" onClick={() => setOpen(true)}>
        Find a runner by handle
      </button>
    )
  }
  const results = searchRunners(directory, query)
  return (
    <div className="handoff-search">
      <input
        className="handoff-input"
        type="search"
        aria-label="Runner handle or name"
        placeholder="@handle"
        value={query}
        onChange={event => setQuery(event.target.value)}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {query.trim() !== '' &&
        (results.length > 0 ? (
          <ul className="handoff-search__results" aria-label="Matching runners">
            {results.map(runner => (
              <li key={runner.id}>
                <button type="button" className="handoff-row" onClick={() => onSelect(runner)}>
                  <RunnerAvatar name={runner.name} wallet={runner.wallet} country={runner.country} size={36} />
                  <span className="handoff-row__text">
                    <span className="handoff-row__name">{runner.name}</span>
                    <span className="handoff-row__context">{runner.context}</span>
                  </span>
                  <span className="handoff-row__go" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="handoff-muted" role="status">
            {crewOnly ? 'No one in your crew matches that.' : 'No runner on the relay network matches that. Send them the invite link instead.'}
          </p>
        ))}
    </div>
  )
}
