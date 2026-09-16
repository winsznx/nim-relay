import * as THREE from 'three'
import type { StationProfile } from '@nim-relay/shared'
import type { BatonAppearance } from '../../../baton/baton-appearance'
import { createCourier, type Courier, type CourierDrive } from '../../../race/scene/courier'
import type { StationKit } from '../kit'
import { COLOR } from '../palette'

export type CourierCosmetics = StationProfile['equipped']

/** The station's view of a courier: the race courier standing idle, facing the deck. */
export interface CourierFigure {
  readonly object: THREE.Group
  /** Null cosmetics show the default courier; a baton appears in hand while the player holds one. */
  setLook(cosmetics: CourierCosmetics | null, carrying: BatonAppearance | null): void
  tick(time: number, delta: number): void
  dispose(): void
}

export function createCourierFigure(kit: StationKit): CourierFigure {
  const object = new THREE.Group()
  object.name = 'courier'
  let courier: Courier | null = null
  let lookKey: string | null = null
  const drive: CourierDrive = {
    time: 0,
    dt: 0,
    act: 'idle',
    actProgress: 0,
    lateralVelocity: 0,
    airborne: false,
    sliding: false,
    stumbling: false,
    railing: false,
    flow: 0,
    events: 0,
    batonLift: 0,
  }

  return {
    object,
    setLook(cosmetics, carrying) {
      const key = JSON.stringify([cosmetics, carrying])
      if (key === lookKey) return
      lookKey = key
      courier?.dispose()
      courier = createCourier({ cosmetics: cosmetics ?? {}, baton: carrying, rimColor: COLOR.lamp, castShadow: kit.settings.shadows })
      courier.group.rotation.y = Math.PI
      object.add(courier.group)
    },
    tick(time, delta) {
      if (!courier) return
      drive.time = time
      drive.dt = delta
      courier.update(drive)
    },
    dispose() {
      courier?.dispose()
      courier = null
      object.removeFromParent()
    },
  }
}
