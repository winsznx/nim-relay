import { useId, useState } from 'react'
import type { NetworkRunner } from '@nim-relay/shared'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'

interface RunnerPickerProps {
  label: string
  runners: readonly NetworkRunner[]
  selfId: string
  /** A runner id, or a handle typed by the player. */
  value: string
  onChange(value: string): void
}

const LIMIT = 8

/** Search linked runners by name or handle, or send to an exact handle that isn't listed yet. */
export function RunnerPicker({ label, runners, selfId, value, onChange }: RunnerPickerProps) {
  const inputId = useId()
  const [query, setQuery] = useState('')
  const term = query.trim().replace(/^@/, '').toLowerCase()
  const others = runners.filter(runner => runner.id !== selfId)
  const matches = term ? others.filter(runner => runner.name.toLowerCase().includes(term) || runner.handle.toLowerCase().includes(term)) : others
  const selected = others.find(runner => runner.id === value)
  const exactHandle = term && !others.some(runner => runner.handle.toLowerCase() === term) ? term : null
  return (
    <div className="nr-field">
      <label className="nr-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="nr-input"
        type="search"
        placeholder="Search by name or @handle"
        value={query}
        onChange={event => setQuery(event.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <ul className="nr-picker">
        {matches.slice(0, LIMIT).map(runner => (
          <li key={runner.id}>
            <button type="button" className="nr-picker__option" aria-pressed={runner.id === value} onClick={() => onChange(runner.id)}>
              <RunnerAvatar name={runner.name} wallet={runner.wallet} country={runner.country} size={32} />
              <span className="nr-row__body">
                <span className="nr-row__title">{runner.name}</span>
                <span className="nr-row__meta">@{runner.handle}</span>
              </span>
            </button>
          </li>
        ))}
        {exactHandle && (
          <li>
            <button type="button" className="nr-picker__option" aria-pressed={value === exactHandle} onClick={() => onChange(exactHandle)}>
              <RunnerAvatar name={exactHandle} size={32} />
              <span className="nr-row__body">
                <span className="nr-row__title">Send to @{exactHandle}</span>
                <span className="nr-row__meta">Use their exact handle</span>
              </span>
            </button>
          </li>
        )}
        {matches.length === 0 && !exactHandle && <li className="nr-field__hint">No linked runners yet. Type a friend’s handle, or share an invite link instead.</li>}
      </ul>
      {(selected || (value && !selected)) && (
        <span className="nr-field__hint" role="status">
          Selected: {selected ? `${selected.name} (@${selected.handle})` : `@${value}`}
        </span>
      )}
    </div>
  )
}
