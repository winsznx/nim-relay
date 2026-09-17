import type { RelayNoteVisibility } from '@nim-relay/shared'
import './note.css'

interface RelayNoteQuoteProps {
  text: string
  /** Who wrote it, when the surrounding line doesn't already say. */
  from?: string | null
  /** Private notes are marked, since only the sender and the recipient ever see them. */
  visibility?: RelayNoteVisibility | null
  /** Phrasing content only, for notes inside buttons and single-line banners. */
  inline?: boolean
  className?: string
}

/** A note that travelled with a pass, quoted the way the runner wrote it. */
export function RelayNoteQuote({ text, from = null, visibility = null, inline = false, className }: RelayNoteQuoteProps) {
  const classes = ['nr-relay-note', inline ? 'nr-relay-note--inline' : '', className].filter(Boolean).join(' ')
  const byline = (from || visibility === 'private') && (
    <>
      {from && <span>{from}</span>}
      {visibility === 'private' && <span className="nr-relay-note__private">Only you two</span>}
    </>
  )
  if (inline) {
    return (
      <span className={classes}>
        <q className="nr-relay-note__text">{text}</q>
        {byline && <span className="nr-relay-note__by">{byline}</span>}
      </span>
    )
  }
  return (
    <figure className={classes}>
      <blockquote className="nr-relay-note__text">{text}</blockquote>
      {byline && <figcaption className="nr-relay-note__by">{byline}</figcaption>}
    </figure>
  )
}
