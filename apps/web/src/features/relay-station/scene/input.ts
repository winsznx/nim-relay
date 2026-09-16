export interface StationInputHandlers {
  /** Element-relative CSS pixel coordinates of a tap or click. */
  tap(x: number, y: number): void
  drag(dx: number, dy: number): void
  zoom(factor: number): void
  /** Mouse position for hover affordance; null when the pointer leaves. */
  hover(x: number | null, y: number | null): void
}

const TAP_SLOP_PX = 9
const TAP_MAX_MS = 450

interface TrackedPointer {
  id: number
  x: number
  y: number
}

/** Pointer gestures on the canvas: tap, one-finger orbit, pinch and wheel zoom. */
export function attachStationInput(element: HTMLElement, handlers: StationInputHandlers): () => void {
  const pointers: TrackedPointer[] = []
  let tapCandidate = false
  let downX = 0
  let downY = 0
  let downAt = 0
  let pinchDistance = 0

  const find = (id: number) => pointers.find(pointer => pointer.id === id)
  const spread = () => {
    const [a, b] = pointers
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (pointers.length >= 2) return
    element.setPointerCapture(event.pointerId)
    pointers.push({ id: event.pointerId, x: event.clientX, y: event.clientY })
    if (pointers.length === 1) {
      tapCandidate = true
      downX = event.clientX
      downY = event.clientY
      downAt = event.timeStamp
    } else {
      tapCandidate = false
      pinchDistance = spread()
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const pointer = find(event.pointerId)
    if (!pointer) {
      if (event.pointerType === 'mouse') hoverAt(event)
      return
    }
    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (pointers.length === 2) {
      const distance = spread()
      if (pinchDistance > 0 && distance > 0) handlers.zoom(pinchDistance / distance)
      pinchDistance = distance
      return
    }
    if (tapCandidate && Math.hypot(event.clientX - downX, event.clientY - downY) < TAP_SLOP_PX) return
    tapCandidate = false
    handlers.drag(dx, dy)
  }

  function onPointerUp(event: PointerEvent): void {
    const index = pointers.findIndex(pointer => pointer.id === event.pointerId)
    if (index < 0) return
    pointers.splice(index, 1)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    if (event.type === 'pointerup' && tapCandidate && pointers.length === 0 && event.timeStamp - downAt < TAP_MAX_MS) {
      const rect = element.getBoundingClientRect()
      handlers.tap(event.clientX - rect.left, event.clientY - rect.top)
    }
    if (pointers.length < 2) pinchDistance = 0
    tapCandidate = false
  }

  function hoverAt(event: PointerEvent): void {
    const rect = element.getBoundingClientRect()
    handlers.hover(event.clientX - rect.left, event.clientY - rect.top)
  }

  function onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') handlers.hover(null, null)
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    handlers.zoom(Math.exp(Math.max(-60, Math.min(60, event.deltaY)) * 0.0022))
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerUp)
  element.addEventListener('pointerleave', onPointerLeave)
  element.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerUp)
    element.removeEventListener('pointerleave', onPointerLeave)
    element.removeEventListener('wheel', onWheel)
  }
}
