import { getAudioDirector } from '../audio/director'
import { useAudio } from '../audio/useAudio'

/** Sound preference for the whole app. The audio director owns and persists it. */
export function soundEnabled(): boolean {
  return !getAudioDirector().muted
}

export function setSoundEnabled(next: boolean): void {
  const director = getAudioDirector()
  director.setMuted(!next)
  if (next) void director.unlock()
}

export function useSoundEnabled(): boolean {
  return !useAudio().muted
}
