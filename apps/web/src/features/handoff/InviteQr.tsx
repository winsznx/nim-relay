import { useMemo } from 'react'
import { create as createQr } from 'qrcode'

/** A quiet zone of two modules keeps the code scannable while it sits on a small plate. */
const QUIET_ZONE = 2

/** One SVG path with a unit square per dark module, offset by the quiet zone; `size` includes the quiet zone. */
export function qrPath(url: string): { size: number; path: string } {
  const { modules } = createQr(url, { errorCorrectionLevel: 'L' })
  let path = ''
  for (let row = 0; row < modules.size; row++) {
    for (let column = 0; column < modules.size; column++) {
      if (modules.data[row * modules.size + column]) path += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
    }
  }
  return { size: modules.size + QUIET_ZONE * 2, path }
}

/** The invite URL as a QR code: dark modules on a light plate, which every phone camera reads. */
export function InviteQr({ url }: { url: string }) {
  const { size, path } = useMemo(() => qrPath(url), [url])
  return (
    <svg className="handoff-qr__code" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for the invite link" shapeRendering="crispEdges">
      <rect width={size} height={size} rx={1.2} className="handoff-qr__plate" />
      <path d={path} className="handoff-qr__modules" />
    </svg>
  )
}
