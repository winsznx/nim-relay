/** Nimiq's 20-byte address rendered as its base32/IBAN payment address. */
export function paymentAddress(value: string): string {
  const compact = value.replace(/\s/g, '').toUpperCase()
  if (!/^[0-9A-F]{40}$/.test(compact)) return compact
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  let encoded = '', bits = 0, accumulator = 0
  for (let index = 0; index < compact.length; index += 2) {
    accumulator = (accumulator << 8) | Number.parseInt(compact.slice(index, index + 2), 16)
    bits += 8
    while (bits >= 5) { bits -= 5; encoded += alphabet[(accumulator >>> bits) & 31] }
  }
  let remainder = 0
  for (const character of `${encoded}NQ00`) {
    const digits = /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return `NQ${String(98 - remainder).padStart(2, '0')}${encoded}`
}
