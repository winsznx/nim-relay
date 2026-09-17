import { useEffect, useId, useLayoutEffect, useRef, type SyntheticEvent } from 'react'
import { CoachMark } from './CoachMark'
import type { TourController, TourSnapshot } from './controller'
import { DEFAULT_PLACEMENTS } from './geometry'
import { Spotlight } from './spotlight'
import { TourFinale } from './TourFinale'

type ActiveSnapshot = Exclude<TourSnapshot, { phase: 'idle' }>

/** Taps and presses on the dimmed world do nothing while a tour step explains it. */
function swallow(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

/** The tour over the app: the veil with its cutout, the input blockers, the coach mark and the completion card. */
export function TourLayer({ snapshot, controller }: { snapshot: ActiveSnapshot; controller: TourController }) {
  const maskId = `nr-tour-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hole = useRef<SVGRectElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const above = useRef<HTMLDivElement>(null)
  const below = useRef<HTMLDivElement>(null)
  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const cover = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLSpanElement>(null)
  const spotlight = useRef<Spotlight | null>(null)

  useLayoutEffect(() => {
    if (!hole.current || !ring.current || !above.current || !below.current || !left.current || !right.current || !cover.current || !probe.current) return
    const instance = new Spotlight({ hole: hole.current, ring: ring.current, blockers: [above.current, below.current, left.current, right.current], cover: cover.current, probe: probe.current })
    spotlight.current = instance
    instance.start()
    return () => {
      instance.stop()
      spotlight.current = null
    }
  }, [])

  const view = snapshot.phase === 'step' ? snapshot.view : null
  const ready = view?.status === 'ready' ? view : null

  useLayoutEffect(() => {
    const instance = spotlight.current
    if (!instance) return
    if (snapshot.phase === 'complete') instance.setFocus(null)
    else if (!ready) instance.hold()
    else {
      instance.setFocus({
        target: ready.target,
        selector: ready.selector,
        measure: ready.primary ? (ready.step.measure ?? null) : null,
        shape: ready.shape,
        padding: ready.padding,
        interaction: ready.interaction,
        placements: ready.step.placement ?? DEFAULT_PLACEMENTS,
        card: card.current,
        arrow: arrow.current,
      })
    }
  }, [snapshot.phase, view, ready])

  useEffect(() => {
    if (!ready) return
    card.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({ preventScroll: true })
  }, [ready])

  // Delegated, so the tap still counts if a render replaced the target's element.
  useEffect(() => {
    if (ready?.interaction !== 'tap-target' || !ready.selector) return
    const selector = ready.selector
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(selector)) controller.activateTarget()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [ready, controller])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      controller.skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller])

  const announcement = ready ? `Step ${ready.number} of ${ready.total}. ${ready.copy.title}` : snapshot.phase === 'complete' ? snapshot.tour.completion.title : ''

  return (
    <div className="nr-tour" data-phase={snapshot.phase} data-step={view?.step.id}>
      <svg className="nr-tour__veil" aria-hidden="true">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect ref={hole} x="0" y="0" width="0" height="0" fill="black" />
          </mask>
        </defs>
        <rect className="nr-tour__veil-fill" x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`} />
      </svg>
      <div ref={ring} className="nr-tour__ring" aria-hidden="true" />
      {[above, below, left, right].map((blocker, index) => (
        <div key={index} ref={blocker} className="nr-tour__blocker" data-tour-blocker="" aria-hidden="true" onPointerDown={swallow} onClick={swallow} />
      ))}
      <div ref={cover} className="nr-tour__blocker" data-tour-blocker="cutout" aria-hidden="true" onPointerDown={swallow} onClick={swallow} />
      <div ref={probe} className="nr-tour__probe" aria-hidden="true" />
      {ready && (
        <CoachMark
          key={`${snapshot.phase === 'step' ? snapshot.runId : 0}-${ready.index}`}
          view={ready}
          cardRef={card}
          arrowRef={arrow}
          onBack={() => controller.back()}
          onNext={() => controller.next()}
          onSkip={() => controller.skip()}
          onSecondary={() => controller.runSecondaryAction()}
        />
      )}
      {snapshot.phase === 'complete' && <TourFinale completion={snapshot.tour.completion} onPrimary={() => controller.finish()} onSecondary={to => controller.finish(to)} />}
      <p className="nr-visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
