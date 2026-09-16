import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}

interface ToastState {
  current: ToastMessage | null
  show(text: string, tone?: ToastTone): void
  dismiss(id: number): void
}

let nextId = 1

export const useToasts = create<ToastState>(set => ({
  current: null,
  show: (text, tone = 'info') => set({ current: { id: nextId++, text, tone } }),
  dismiss: id => set(state => (state.current?.id === id ? { current: null } : state)),
}))

export const showToast = (text: string, tone?: ToastTone): void => useToasts.getState().show(text, tone)
