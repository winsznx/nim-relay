import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATE_TIMEOUT_MS, TourController, type LocateRequest, type TourTrackEvent } from './controller'
import type { TourDefinition, TourStep } from './types'

/** Stand-in for an element: which selector found it. */
interface FakeTarget {
  selector: string
}

const step = (id: string, overrides: Partial<TourStep> = {}): TourStep => ({
  id,
  target: `[data-tour="${id}"]`,
  category: `Category ${id}`,
  title: `Title ${id}`,
  body: `Body ${id}.`,
  interaction: 'next',
  ...overrides,
})

const tour = (steps: TourStep[]): TourDefinition => ({ id: 'core', version: 'v1', steps, completion: { category: 'Done', title: 'Ready', primaryLabel: 'Explore', secondary: { label: 'Practice', to: '/leg/practice' } } })

/** A fake app: a path, the selectors on screen right now, and everything the controller asked for. */
function harness(initialPath = '/') {
  let path = initialPath
  const onScreen = new Set<string>()
  const pathListeners = new Set<() => void>()
  const waiting = new Set<() => void>()
  const calls = {
    navigations: [] as { path: string; replace: boolean }[],
    persisted: [] as string[],
    tracked: [] as TourTrackEvent[],
    missing: [] as string[],
    errors: [] as unknown[],
    revealed: [] as string[],
    locates: [] as LocateRequest[],
    focusRestored: 0,
    unsubscribed: 0,
  }
  const setPath = (next: string) => {
    path = next
    for (const listener of pathListeners) listener()
  }
  const find = (request: LocateRequest) => {
    const index = request.selectors.findIndex(selector => onScreen.has(selector))
    return index === -1 ? null : { element: { selector: request.selectors[index] ?? '' }, index }
  }
  const controller = new TourController<FakeTarget>({
    navigate: (to, options) => {
      calls.navigations.push({ path: to, replace: options.replace })
      setPath(to)
    },
    currentPath: () => path,
    subscribeToPath: listener => {
      pathListeners.add(listener)
      return () => {
        calls.unsubscribed++
        pathListeners.delete(listener)
      }
    },
    locate: request =>
      new Promise(resolve => {
        calls.locates.push(request)
        const check = () => {
          const found = find(request)
          if (!found) return
          waiting.delete(check)
          resolve(found)
        }
        waiting.add(check)
        request.signal.addEventListener('abort', () => {
          waiting.delete(check)
          resolve(null)
        })
        check()
      }),
    reveal: target => calls.revealed.push(target.selector),
    persist: (tourId, version, state) => calls.persisted.push(`${tourId}:${version}:${state}`),
    track: event => calls.tracked.push(event),
    reportMissing: message => calls.missing.push(message),
    reportError: error => calls.errors.push(error),
    captureFocus: () => () => {
      calls.focusRestored++
    },
    defer: work => setTimeout(work, 0),
  })
  return {
    controller,
    calls,
    setPath,
    path: () => path,
    /** Puts targets on screen, as a render would. */
    mount(...ids: string[]) {
      for (const id of ids) onScreen.add(`[data-tour="${id}"]`)
      for (const check of [...waiting]) check()
    },
    events: () => calls.tracked.map(event => (event.stepId ? `${event.event}:${event.stepId}` : event.event)),
    view() {
      const snapshot = controller.getSnapshot()
      return snapshot.phase === 'step' ? snapshot.view : null
    },
  }
}

/** Lets resolved locates reach the controller. */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('tour controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks forward and back through the steps, then completes', async () => {
    // #given three steps whose targets are on screen
    const app = harness()
    app.mount('one', 'two', 'three')
    // #when the runner starts, goes forward twice, back once, forward twice
    app.controller.start(tour([step('one'), step('two'), step('three')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    const first = app.view()
    app.controller.next()
    await settle()
    app.controller.next()
    await settle()
    const third = app.view()
    app.controller.back()
    await settle()
    const backAtTwo = app.view()
    app.controller.next()
    await settle()
    app.controller.next()
    // #then each view says where it is, and the run is recorded as completed
    expect({
      first: { title: first?.copy.title, number: first?.number, total: first?.total, canGoBack: first?.canGoBack },
      third: { number: third?.number, last: third?.last },
      backAtTwo: backAtTwo?.step.id,
      phase: app.controller.getSnapshot().phase,
      persisted: app.calls.persisted,
      events: app.events(),
    }).toEqual({
      first: { title: 'Title one', number: 1, total: 3, canGoBack: false },
      third: { number: 3, last: true },
      backAtTwo: 'two',
      phase: 'complete',
      persisted: ['core:v1:started', 'core:v1:completed'],
      events: ['started', 'step_viewed:one', 'step_completed:one', 'step_viewed:two', 'step_completed:two', 'step_viewed:three', 'step_viewed:two', 'step_completed:two', 'step_viewed:three', 'step_completed:three', 'completed'],
    })
  })

  it('skips a step whose target never shows up, after a bounded wait, and reports it', async () => {
    // #given a middle step whose target is not on screen
    const app = harness()
    app.mount('one', 'three')
    app.controller.start(tour([step('one'), step('two'), step('three')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when the runner moves on and the wait runs out
    app.controller.next()
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS - 1)
    const stillLooking = app.view()?.status
    await vi.advanceTimersByTimeAsync(1)
    // #then the tour moved to the next step, counting one step fewer, and said which step it skipped
    expect({
      stillLooking,
      now: app.view()?.step.id,
      number: app.view()?.number,
      total: app.view()?.total,
      tracked: app.events().includes('target_missing:two'),
      missing: app.calls.missing.length,
    }).toEqual({ stillLooking: 'locating', now: 'three', number: 2, total: 2, tracked: true, missing: 1 })
  })

  it('points at a fallback target, with its own copy and interaction, when the step’s target is absent', async () => {
    // #given a step whose own target is absent but whose fallback is on screen
    const app = harness()
    app.mount('empty-hero')
    const hero = step('hero', { interaction: 'tap-target', fallbackTargets: ['[data-tour="missing"]', { target: '[data-tour="empty-hero"]', copy: { title: 'The first baton is waiting' }, interaction: 'next' }] })
    // #when the tour starts
    app.controller.start(tour([hero]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #then the step shows at the fallback, as an explanatory step with the fallback's title
    const view = app.view()
    expect({ target: view?.target?.selector, primary: view?.primary, title: view?.copy.title, body: view?.copy.body, interaction: view?.interaction, revealed: app.calls.revealed }).toEqual({
      target: '[data-tour="empty-hero"]',
      primary: false,
      title: 'The first baton is waiting',
      body: 'Body hero.',
      interaction: 'next',
      revealed: ['[data-tour="empty-hero"]'],
    })
  })

  it('explains itself on a centered card when nothing is on screen and the step says what to say', async () => {
    // #given a step with copy for when its target is missing
    const app = harness()
    const ghost = step('ghost', { interaction: 'tap-target', whenMissing: { title: 'Every leg races a ghost' } })
    // #when its wait runs out
    app.controller.start(tour([ghost]), { mode: 'first-run', entryRoute: '/' })
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS)
    // #then it shows a centered explanatory card instead of skipping
    const view = app.view()
    expect({ target: view?.target, title: view?.copy.title, interaction: view?.interaction, missing: app.calls.missing }).toEqual({ target: null, title: 'Every leg races a ghost', interaction: 'next', missing: [] })
  })

  it('navigates to each step’s route, replacing history, and waits for the target to mount there', async () => {
    // #given a step on the inbox, which mounts its target after navigation
    const app = harness('/')
    app.mount('one')
    app.controller.start(tour([step('one'), step('inbox', { route: '/inbox' })]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when the runner moves on
    app.controller.next()
    await settle()
    const beforeMount = app.view()?.status
    app.mount('inbox')
    await settle()
    // #then the tour navigated without pushing history and showed the step once its target mounted
    expect({ navigations: app.calls.navigations, path: app.path(), beforeMount, after: app.view()?.status }).toEqual({ navigations: [{ path: '/inbox', replace: true }], path: '/inbox', beforeMount: 'locating', after: 'ready' })
  })

  it('skips mid-tour back to where it started, records the skip and lets go of its listeners', async () => {
    // #given a tour that moved from the home to the inbox
    const app = harness('/')
    app.mount('one', 'inbox')
    app.controller.start(tour([step('one'), step('inbox', { route: '/inbox' }), step('three')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    app.controller.next()
    await settle()
    // #when the runner skips the tour
    app.controller.skip()
    // #then the tour closed, went back home, recorded the skip at the inbox step and released the path listener
    const signals = app.calls.locates.map(request => request.signal.aborted)
    expect({
      phase: app.controller.getSnapshot().phase,
      path: app.path(),
      persisted: app.calls.persisted,
      last: app.calls.tracked.at(-1),
      unsubscribed: app.calls.unsubscribed,
      focusRestored: app.calls.focusRestored,
      openLocates: signals.filter(aborted => !aborted).length,
    }).toEqual({
      phase: 'idle',
      path: '/',
      persisted: ['core:v1:started', 'core:v1:skipped'],
      last: { event: 'skipped', tourId: 'core', version: 'v1', stepId: 'inbox', stepNumber: 2 },
      unsubscribed: 1,
      focusRestored: 1,
      openLocates: 0,
    })
  })

  it('never records first-run progress or the funnel during a replay', async () => {
    // #given a finished first run
    const app = harness('/profile')
    app.mount('one', 'two')
    // #when the runner replays the tour to the end and closes the card
    app.controller.start(tour([step('one', { route: '/' }), step('two')]), { mode: 'replay', entryRoute: '/profile' })
    await settle()
    app.controller.next()
    await settle()
    app.controller.next()
    const completed = app.controller.getSnapshot().phase
    app.controller.finish()
    // #then nothing was persisted, only the replay was tracked, and the runner is back on their profile
    expect({ completed, persisted: app.calls.persisted, events: app.events(), path: app.path() }).toEqual({ completed: 'complete', persisted: [], events: ['replayed'], path: '/profile' })
  })

  it('moves on when the target of a tap-target step is used, keeping the navigation that tap caused', async () => {
    // #given a tap-target step on the home
    const app = harness('/')
    app.mount('open-journey', 'nav-inbox')
    app.controller.start(tour([step('open-journey', { interaction: 'tap-target' }), step('nav-inbox')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when the runner taps the target, which opens the journey
    app.controller.activateTarget()
    app.setPath('/relay/G7K2M9Q4XA')
    await settle()
    // #then the tour is on the next step, still running, over the journey
    expect({ step: app.view()?.step.id, path: app.path(), events: app.events() }).toEqual({ step: 'nav-inbox', path: '/relay/G7K2M9Q4XA', events: ['started', 'step_viewed:open-journey', 'step_completed:open-journey', 'step_viewed:nav-inbox'] })
  })

  it('ignores activation of an explanatory step', async () => {
    // #given an explanatory step
    const app = harness()
    app.mount('one', 'two')
    app.controller.start(tour([step('one'), step('two')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when something reports its target was used
    app.controller.activateTarget()
    await settle()
    // #then the step stays
    expect(app.view()?.step.id).toBe('one')
  })

  it('ends when the runner leaves the tour’s screen another way, without dragging them back', async () => {
    // #given a running tour on the home
    const app = harness('/')
    app.mount('one', 'two')
    app.controller.start(tour([step('one'), step('two')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when the system back gesture changes the path
    app.setPath('/daily')
    // #then the tour ended as skipped and left the runner where they went
    expect({ phase: app.controller.getSnapshot().phase, path: app.path(), persisted: app.calls.persisted.at(-1), navigations: app.calls.navigations }).toEqual({ phase: 'idle', path: '/daily', persisted: 'core:v1:skipped', navigations: [] })
  })

  it('closes, back where it started, when a step throws while entering', async () => {
    // #given a second step that throws before it shows
    const app = harness('/')
    app.mount('one')
    const broken = step('broken', {
      route: '/inbox',
      beforeEnter: () => {
        throw new Error('sheet would not close')
      },
    })
    app.controller.start(tour([step('one'), broken]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #when the runner moves on
    app.controller.next()
    // #then the error was reported and nothing of the tour is left on screen
    expect({ phase: app.controller.getSnapshot().phase, errors: app.calls.errors.length, path: app.path() }).toEqual({ phase: 'idle', errors: 1, path: '/' })
  })

  it('finishes to another path when the completion card’s second action is chosen', async () => {
    // #given a completed tour
    const app = harness('/')
    app.mount('one')
    app.controller.start(tour([step('one')]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    app.controller.next()
    // #when the runner picks the practice run
    app.controller.finish('/leg/practice')
    // #then the app opened it as a new history entry
    expect({ phase: app.controller.getSnapshot().phase, navigations: app.calls.navigations }).toEqual({ phase: 'idle', navigations: [{ path: '/leg/practice', replace: false }] })
  })

  it('passes a step’s measure to the locator so an unmeasurable target doesn’t count as found', async () => {
    // #given a step with custom geometry
    const app = harness()
    app.mount('relay-world')
    const measure = vi.fn(() => null)
    // #when it starts
    app.controller.start(tour([step('relay-world', { measure })]), { mode: 'first-run', entryRoute: '/' })
    await settle()
    // #then the locator received it
    expect(app.calls.locates[0]?.measure).toBe(measure)
  })
})
