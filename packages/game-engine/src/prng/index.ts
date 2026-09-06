const MASK = (1n << 64n) - 1n
export function splitmix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK
  let value = next
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK
  return { state: next, value: (value ^ (value >> 31n)) & MASK }
}
/** UTF-16 code units are explicit so seed encoding needs no runtime APIs. */
export function seedState(seed: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < seed.length; i++) hash = ((hash ^ BigInt(seed.charCodeAt(i))) * 0x100000001b3n) & MASK
  return hash
}
