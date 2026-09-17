import { useState } from 'react'
import { MAX_RELAY_NOTE_CHARS, type RelayNote, type RelayNoteVisibility } from '@nim-relay/shared'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { noteRefusalCopy } from './copy'
import { HoloCard } from './holo'
import { noteLength, type NoteRefusal, type RunnerChoice } from './machine'

interface NoteStepProps {
  recipient: RunnerChoice
  wallet: string | null
  draft: RelayNote | null
  refusal: NoteRefusal | null
  onAttach(note: RelayNote | null): void
  onChangeRunner(): void
}

/** Near the limit the counter warms up, so the last few characters are a choice rather than a surprise. */
const COUNTER_WARNING = MAX_RELAY_NOTE_CHARS - 8

/** Keeps typing and pasting inside the limit, counted in code points like the relay counts them. */
function clampNote(value: string): string {
  const points = Array.from(value)
  return points.length > MAX_RELAY_NOTE_CHARS ? points.slice(0, MAX_RELAY_NOTE_CHARS).join('') : value
}

/** One line for the next runner, sent with the pass. Optional, and private when the holder wants it to be. */
export function NoteStep({ recipient, wallet, draft, refusal, onAttach, onChangeRunner }: NoteStepProps) {
  const [text, setText] = useState(draft?.text ?? '')
  const [visibility, setVisibility] = useState<RelayNoteVisibility>(draft?.visibility ?? 'public')
  const length = noteLength(text)
  const written = text.trim() !== ''

  return (
    <HoloCard className="handoff-note" labelledBy="handoff-note-title">
      <div className="handoff-note__to">
        <RunnerAvatar name={recipient.name} wallet={wallet} size={36} />
        <p className="handoff-note__recipient">
          <span className="handoff-eyebrow">Handoff to</span> <strong>{recipient.name}</strong>
        </p>
        <button type="button" className="handoff-quiet handoff-quiet--inline" onClick={onChangeRunner}>
          Change
        </button>
      </div>
      <form
        className="handoff-note__form"
        onSubmit={event => {
          event.preventDefault()
          onAttach(written ? { text, visibility } : null)
        }}
      >
        <h2 id="handoff-note-title" className="handoff-title handoff-title--plate">
          Relay note
        </h2>
        <div className="handoff-note__field">
          <input
            className="handoff-note__input"
            value={text}
            onChange={event => setText(clampNote(event.target.value))}
            placeholder="Don’t drop the baton."
            aria-label="Relay note"
            aria-describedby="handoff-note-count handoff-note-reach"
            aria-invalid={refusal ? true : undefined}
            autoComplete="off"
            enterKeyHint="done"
          />
          <span id="handoff-note-count" className="handoff-note__count" data-warning={length >= COUNTER_WARNING ? 'true' : 'false'}>
            <span className="nr-visually-hidden">Characters used: </span>
            {length}/{MAX_RELAY_NOTE_CHARS}
          </span>
        </div>
        <div className="handoff-note__reach">
          <div className="handoff-toggle" role="group" aria-label="Who can read the note">
            <button type="button" aria-pressed={visibility === 'public'} onClick={() => setVisibility('public')}>
              Public
            </button>
            <button type="button" aria-pressed={visibility === 'private'} onClick={() => setVisibility('private')}>
              Only them
            </button>
          </div>
          <p id="handoff-note-reach" className="handoff-note__reach-copy">
            {visibility === 'public' ? 'Shows on the journey for everyone.' : `Only ${recipient.name} and you can read it.`}
          </p>
        </div>
        {refusal && (
          <p className="handoff-notice" role="alert">
            {noteRefusalCopy(refusal)}
          </p>
        )}
        <button type="submit" className="handoff-primary">
          {written ? 'Attach note' : 'Pass without a note'}
        </button>
      </form>
    </HoloCard>
  )
}
