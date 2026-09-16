import type { StationController } from './controller'

/** Owns overlapping held keys and one captured touch; action keys are edges. */
export class RaceControls {
  private keys = new Set<string>()
  private pointer: { id: number; x: number; y: number } | null = null
  constructor(private readonly controller: StationController) {}
  keyDown(key: string, repeat = false): void {
    this.keys.add(key.toLowerCase())
    this.syncKeys()
    if (!repeat && (key === 'ArrowUp' || key.toLowerCase() === 'w')) this.controller.jump()
    if (!repeat && (key === 'ArrowDown' || key.toLowerCase() === 's')) this.controller.duck()
    if (key === 'Escape') { this.reset(); this.controller.pause() }
  }
  keyUp(key: string): void { this.keys.delete(key.toLowerCase()); this.syncKeys() }
  private syncKeys(): void {
    const left = this.keys.has('arrowleft') || this.keys.has('a')
    const right = this.keys.has('arrowright') || this.keys.has('d')
    if (!this.pointer) this.controller.setSteer((Number(right) - Number(left)) * 64)
    this.controller.setBoost(this.pointer !== null || this.keys.has(' '))
  }
  pointerDown(id: number, x: number, y: number): boolean {
    if (this.pointer) return false
    this.pointer = { id, x, y }; this.controller.setBoost(true); return true
  }
  pointerMove(id: number, x: number, y: number): void {
    const start = this.pointer
    if (!start || start.id !== id) return
    this.controller.setSteer((x - start.x) / 1.5)
    if (y - start.y < -45) { this.controller.jump(); start.y = y }
    else if (y - start.y > 45) { this.controller.duck(); start.y = y }
  }
  pointerUp(id: number): void { if (this.pointer?.id === id) { this.pointer = null; this.syncKeys() } }
  reset(): void { this.pointer = null; this.keys.clear(); this.controller.setBoost(false); this.controller.setSteer(0) }
}
