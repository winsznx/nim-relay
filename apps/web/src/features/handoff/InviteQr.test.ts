import { describe, expect, it } from 'vitest'
import { qrPath } from './InviteQr'

const INVITE = `https://nimrelay.app/invite/${'a1'.repeat(32)}`

describe('invite QR code', () => {
  it('draws a version 5 symbol for an invite link, with a two-module quiet zone', () => {
    // #given an invite URL as the Worker issues them
    // #when it is encoded
    const { size, path } = qrPath(INVITE)

    // #then 37 modules plus the quiet zone on each side fill the plate
    expect(size).toBe(41)
    // #and the top-left finder pattern starts right after the quiet zone: a dark row of seven modules
    for (let column = 0; column < 7; column++) expect(path).toContain(`M${column + 2} 2h1v1h-1z`)
    // #and nothing is drawn inside the quiet zone
    expect(path).not.toMatch(/M[01] |M\d+ [01]h/)
  })
})
