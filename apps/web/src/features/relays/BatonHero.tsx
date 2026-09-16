import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { BatonAppearance } from '../baton/baton-appearance'
import { createBatonObject } from '../baton/baton-mesh'
import { BatonEmblem } from '../baton/BatonEmblem'

interface BatonHeroProps {
  appearance: BatonAppearance
  label: string
  size?: number
}

/** The relay's baton in 3D, drawn from its verified history. Falls back to the flat emblem without WebGL. */
export function BatonHero({ appearance, label, size = 132 }: BatonHeroProps) {
  const host = useRef<HTMLDivElement>(null)
  const [flat, setFlat] = useState(false)
  const baton = useRef<ReturnType<typeof createBatonObject> | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch (error) {
      console.warn('3D baton unavailable, showing the emblem', error)
      setFlat(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(size, size * 1.25, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.85
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
    element.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 20)
    // Far enough that the baton's glow fades out inside the frame instead of filling it.
    camera.position.set(0, 0.1, 3.9)
    camera.lookAt(0, 0, 0)
    scene.add(new THREE.AmbientLight(0xb8c4e0, 1.1))
    const key = new THREE.DirectionalLight(0xffe2b0, 2.6)
    key.position.set(1.5, 2, 2.5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6f8fd8, 1.4)
    rim.position.set(-2, -0.5, -1.5)
    scene.add(rim)
    // Built fresh; the effect below applies this relay's appearance and keeps it current.
    const object = createBatonObject(undefined, { length: 1.25 })
    object.object.rotation.z = -0.32
    scene.add(object.object)
    baton.current = object

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = true
    let frame = 0
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
    })
    observer.observe(element)
    const render = (now: number) => {
      frame = requestAnimationFrame(render)
      if (!visible || document.hidden) return
      const time = now / 1000
      object.object.rotation.y = reduced.matches ? 0.6 : time * 0.45
      object.update(reduced.matches ? 0 : time, 0.15)
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      object.dispose()
      baton.current = null
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [size])

  useEffect(() => {
    baton.current?.setAppearance(appearance)
  }, [appearance])

  if (flat) return <BatonEmblem appearance={appearance} size={size} label={label} />
  return <div ref={host} className="nr-baton-hero" style={{ width: size, height: size * 1.25 }} role="img" aria-label={label} />
}
