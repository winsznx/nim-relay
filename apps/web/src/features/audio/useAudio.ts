import { useSyncExternalStore } from 'react'
import { getAudioDirector, type AudioDirector, type AudioStatus } from './director'

export interface AudioControls {
  director: AudioDirector
  muted: boolean
  status: AudioStatus
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
}

const setMuted = (muted: boolean): void => getAudioDirector().setMuted(muted)

const toggleMuted = (): void => {
  const director = getAudioDirector()
  director.setMuted(!director.muted)
}

/** The app-wide AudioDirector with its mute and unlock state; re-renders only when those change. */
export function useAudio(): AudioControls {
  const director = getAudioDirector()
  const { muted, status } = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot)
  return { director, muted, status, setMuted, toggleMuted }
}
