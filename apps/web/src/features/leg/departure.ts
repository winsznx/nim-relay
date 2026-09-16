import { create } from 'zustand'

/** The moment a verified handoff leaves the player's world, shown over the globe. */
export interface Departure {
  key: string
  batonName: string
  leg: number
  recipientName: string
}

interface DepartureState {
  current: Departure | null
  show(departure: Departure): void
  clear(key: string): void
}

export const useDeparture = create<DepartureState>(set => ({
  current: null,
  show: departure => set({ current: departure }),
  clear: key => set(state => (state.current?.key === key ? { current: null } : state)),
}))
