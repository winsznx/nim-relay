import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { fromQ, type Route } from '../route'
import type { EventParts } from './parts'
import { RED } from './kit'

/**
 * The world's side of a fall: when the courier goes over an open edge, chunks
 * of the edge lip and a spray of sparks follow them down, so the drop below
 * the deck reads as a real height with the courier falling through it.
 */

const CHUNKS = 12
const SECONDS = 3.2
const GRAVITY = 9.8
const LIP = new THREE.Color(0.24, 0.22, 0.22)
const SPARK = new THREE.Color(3.6, 1.7, 0.5)

function hash(value: number): number {
  const x = Math.sin(value * 91.7 + 17.3) * 43758.5453
  return x - Math.floor(x)
}

export class FallDebris {
  private started = -1
  private d = 0
  private lateral = 0
  private side: -1 | 1 = 1
  private falling = false
  private readonly color = new THREE.Color()

  constructor(
    private readonly route: Route,
    private readonly parts: EventParts,
  ) {}

  draw(state: relayLeg.State, time: number): void {
    const falling = state.motion === 'falling'
    if (falling && !this.falling && state.edgeSide !== 0) {
      this.started = time
      this.side = state.edgeSide
      this.d = fromQ(state.dist)
      this.lateral = this.route.pathOffset(state.path, this.d) + this.side * this.route.halfWidth(state.path, this.d)
    }
    this.falling = falling
    if (this.started < 0) return
    const t = time - this.started
    if (t > SECONDS) {
      this.started = -1
      return
    }
    for (let i = 0; i < CHUNKS; i++) {
      const along = this.d + (hash(i) - 0.3) * 3 + t * (2 + hash(i + 1) * 4)
      const out = this.lateral + this.side * (0.2 + t * (0.6 + hash(i + 2) * 1.8))
      const height = -0.1 + t * (hash(i + 3) * 2) - 0.5 * GRAVITY * t * t
      const size = 0.12 + hash(i + 4) * 0.3
      this.parts.put('body', along, out, height, size, size * 0.7, size, LIP, t * 5 * hash(i + 5), t * 7 * hash(i + 6), t * 3)
    }
    if (t < 0.8) {
      const fade = 1 - t / 0.8
      for (let i = 0; i < 8; i++) {
        const spread = t * (3 + hash(i + 20) * 4)
        this.parts.put('spark', this.d + hash(i + 21) * 2, this.lateral + this.side * spread * 0.4, -spread * 0.6, 0.3, 0.3, 0.3, this.color.copy(i % 3 === 0 ? RED : SPARK).multiplyScalar(fade))
      }
    }
  }
}
