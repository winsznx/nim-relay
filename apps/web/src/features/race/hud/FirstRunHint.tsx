/** Shown once, for the first seconds of a courier's first race. */
export function FirstRunHint() {
  return (
    <div className="leg-hint" role="note">
      <svg className="leg-hint__glyph" viewBox="0 0 96 64" aria-hidden="true">
        <path className="leg-hint__track" d="M 14 44 H 82" />
        <path className="leg-hint__arrow leg-hint__arrow--up" d="M 48 20 l -6 7 h 12 z" />
        <path className="leg-hint__arrow leg-hint__arrow--down" d="M 48 60 l -6 -7 h 12 z" />
        <circle className="leg-hint__thumb" cx="48" cy="44" r="9" />
      </svg>
      <p>drag to steer, flick up to jump, flick down to slide</p>
    </div>
  )
}
