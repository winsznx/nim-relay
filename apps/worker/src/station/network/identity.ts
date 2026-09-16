import type { BatonMode } from '@nim-relay/shared'
import type { NetworkState } from './types'

const MODE_LABELS: Record<BatonMode, string> = {
  quick: 'Quick Relay',
  global: 'Global Relay',
  crew: 'Crew Relay',
  rival: 'Rival Relay',
}

export function shortCode(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
}

export function nextSerial(state: Pick<NetworkState, 'serials'>, mode: BatonMode): number {
  const serial = (state.serials[mode] ?? 0) + 1
  state.serials[mode] = serial
  return serial
}

/** The runner's title when they chose one, otherwise e.g. "Global Relay #001". */
export function batonDisplayName(mode: BatonMode, serial: number, title: string): string {
  const chosen = title.trim()
  if (chosen) return chosen
  return `${MODE_LABELS[mode]} #${String(serial).padStart(3, '0')}`
}
