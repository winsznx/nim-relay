/** Q16.16 values are safe integers; BigInt intermediates prevent precision loss. */
export type Fixed = number
export const ONE = 65536
export const HALF = 32768
function integer(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError('Expected a safe integer')
  return BigInt(value)
}
function bounded(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new RangeError('Fixed-point overflow')
  return result
}
export const add = (a: Fixed, b: Fixed): Fixed => bounded(integer(a) + integer(b))
export const sub = (a: Fixed, b: Fixed): Fixed => bounded(integer(a) - integer(b))
export const mul = (a: Fixed, b: Fixed): Fixed => bounded(integer(a) * integer(b) / 65536n)
export const div = (a: Fixed, b: Fixed): Fixed => bounded(integer(a) * 65536n / integer(b))
export const ratio = (a: number, b: number): Fixed => div(a, b)
export const quotient = (a: number, b: number): number => bounded(integer(a) / integer(b))
export const clamp = (value: Fixed, min = 0, max = ONE): Fixed => value < min ? min : value > max ? max : value
export const lerp = (a: Fixed, b: Fixed, t: Fixed): Fixed => add(a, mul(sub(b, a), t))
export function sqrt(value: Fixed): Fixed {
  const scaled = integer(value) * 65536n
  if (scaled < 0n) throw new RangeError('Negative square root')
  if (scaled < 2n) return Number(scaled)
  let x = scaled
  let next = (x + 1n) / 2n
  while (next < x) { x = next; next = (x + scaled / x) / 2n }
  return bounded(x)
}
export const abs = (value: number): number => value < 0 ? -value : value
