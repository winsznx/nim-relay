import { describe, expect, it } from 'vitest'
import type { LegProgressInput } from '@nim-relay/shared'
import { createRaceFrame, type RaceFrame } from '../race/race-frame'
import { LegProgressReporter, PROGRESS_REPORT_EVERY_MS } from './progress-reporter'

function frame(overrides: Partial<RaceFrame>): RaceFrame {
  return { ...createRaceFrame(), running: true, tick: 300, dist: 150 * 65536, finishDist: 1500 * 65536, ...overrides }
}

function recorder(): { sent: LegProgressInput[]; send: (input: LegProgressInput) => Promise<unknown> } {
  const sent: LegProgressInput[] = []
  return {
    sent,
    send: input => {
      sent.push(input)
      return Promise.resolve({ accepted: true })
    },
  }
}

describe('LegProgressReporter', () => {
  it('reports the ride from its simulation state, with the ghost gap in milliseconds', () => {
    // #given a reporter for an issued run
    const { sent, send } = recorder()
    const reporter = new LegProgressReporter('run-1', send)
    // #when a racing frame on the risk path arrives, 0.3104 s behind the ghost
    reporter.frame(frame({ path: 'risk', ghostDelta: 0.3104 }), 1_000)
    // #then that exact state is reported
    expect(sent).toEqual([{ runId: 'run-1', tick: 300, dist: 150 * 65536, finishDist: 1500 * 65536, ghostDeltaMs: 310, path: 'risk' }])
  })

  it('reports at most once per interval', () => {
    // #given a reporter that just reported
    const { sent, send } = recorder()
    const reporter = new LegProgressReporter('run-1', send)
    reporter.frame(frame({ tick: 300 }), 1_000)
    // #when frames keep coming just before and at the interval
    reporter.frame(frame({ tick: 400 }), 1_000 + PROGRESS_REPORT_EVERY_MS - 1)
    reporter.frame(frame({ tick: 420 }), 1_000 + PROGRESS_REPORT_EVERY_MS)
    // #then only the frame at the interval is reported next
    expect(sent.map(input => input.tick)).toEqual([300, 420])
  })

  it('stays quiet through the opening, while paused and after the finish', () => {
    // #given a reporter
    const { sent, send } = recorder()
    const reporter = new LegProgressReporter('run-1', send)
    // #when the count-in, the start line, a pause and the finish go by
    reporter.frame(frame({ tick: -40 }), 0)
    reporter.frame(frame({ tick: 0 }), 5_000)
    reporter.frame(frame({ running: false, tick: 900 }), 10_000)
    // #then nothing is reported
    expect(sent).toEqual([])
  })

  it('swallows a refused report so the ride carries on', async () => {
    // #given a server that refuses every report
    const reporter = new LegProgressReporter('run-1', () => Promise.reject(new Error('offline')))
    // #when a frame is reported and the refusal settles
    const report = () => reporter.frame(frame({}), 0)
    // #then the ride is not interrupted, and vitest fails the run on any unhandled rejection
    expect(report).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
