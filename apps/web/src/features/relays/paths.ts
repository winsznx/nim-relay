const relaySuffix = (code: string | null) => (code ? `&relay=${encodeURIComponent(code)}` : '')

/** Replay of a verified ride. `code` is the relay to return to when the replay was opened from a link. */
export const watchPath = (runId: string, code: string | null) => `/leg/watch?run=${encodeURIComponent(runId)}${relaySuffix(code)}`

/** A practice leg against a verified ghost. */
export const practicePath = (runId: string, code: string | null) => `/leg/practice?ghost=${encodeURIComponent(runId)}${relaySuffix(code)}`
