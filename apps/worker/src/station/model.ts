import type { Chronicle, HandoffIntent, IssuedRace, RaceResult, RaceTrace, StationChallenge, StationCrew, StationProfile, StationSnapshot } from '@nim-relay/shared'

export interface Profile extends StationProfile {
  wallet: string
  rivals: string[]
  best: number
  bestRunId: string | null
  dailyBest: Record<string, number>
}

/** A server-replayed race. `inputTrace` and `result` always belong to the engine named by `issued.config`. */
export interface Run {
  issued: IssuedRace
  result: RaceResult
  inputTrace: RaceTrace
  at: number
}

/** Station product state persisted under the `state` key. */
export interface State {
  players: Record<string, Profile>
  crews: StationCrew[]
  challenges: StationChallenge[]
  chronicles: Chronicle[]
  global: StationSnapshot['global']
  latest: Record<string, string>
  intents: Record<string, HandoffIntent>
  usedTx: Record<string, string>
}

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code)
  }
}
