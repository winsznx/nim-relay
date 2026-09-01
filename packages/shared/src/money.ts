/**
 * All NIM amounts are integer Luna. Never floating point (PRD section 12.4).
 * 1 NIM = 100,000 Luna.
 */
export const LUNA_PER_NIM = 100_000n

export function nimToLuna(nim: number): bigint {
  if (!Number.isFinite(nim) || nim < 0) {
    throw new RangeError(`nimToLuna: invalid amount ${nim}`)
  }
  // Avoid float rounding drift: work in integer "milli-NIM" first.
  const milliNim = Math.round(nim * 1000)
  return (BigInt(milliNim) * LUNA_PER_NIM) / 1000n
}

export function lunaToNim(luna: bigint): number {
  if (luna < 0n) {
    throw new RangeError(`lunaToNim: invalid amount ${luna}`)
  }
  return Number(luna) / Number(LUNA_PER_NIM)
}

export const GLOBAL_RELAY_BATON_LUNA = LUNA_PER_NIM // exactly 1 NIM, PRD section 6.1
export const CREATOR_RELAY_BATON_CAP_LUNA = LUNA_PER_NIM // PRD section 6.6
