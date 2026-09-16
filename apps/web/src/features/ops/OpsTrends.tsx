import type { OpsDay, OpsReport } from '@nim-relay/shared'
import { formatCount } from '../relays/format'
import { SectionHeader } from '../shell/ui/primitives'
import { DEFINITIONS } from './copy'
import { utcDateTime, utcDay } from './dates'

type BarTone = 'ink' | 'gold' | 'cyan' | 'danger' | 'mist'
interface BarSegment {
  label: string
  value: number
  tone: BarTone
}
/** A day's segments, stacked bottom-up, or null for a day before its counter started. */
type SegmentsOf = (day: OpsDay) => readonly BarSegment[] | null

const BAR_WIDTH = 7
const BAR_GAP = 3
const CHART_HEIGHT = 44
/** A day with a single event still shows a visible bar. */
const MIN_BAR_HEIGHT = 1.5

function total(segments: readonly BarSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.value, 0)
}

function describe(segments: readonly BarSegment[]): string {
  return segments.map(segment => `${formatCount(segment.value)} ${segment.label}`).join(', ')
}

/**
 * One bar per UTC day, oldest on the left, scaled to the busiest day. A day whose counter was not recorded yet gets a
 * short dash on the baseline instead of a bar, so it never reads as a zero.
 */
function DayBars({ days, segmentsOf, label }: { days: readonly OpsDay[]; segmentsOf: SegmentsOf; label: string }) {
  const stacks = days.map(day => ({ day, segments: segmentsOf(day) }))
  const busiest = Math.max(1, ...stacks.map(({ segments }) => total(segments ?? [])))
  const width = days.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP
  return (
    <svg className="nr-ops-bars" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="nr-ops-bars__base" x1="0" x2={width} y1={CHART_HEIGHT - 0.5} y2={CHART_HEIGHT - 0.5} />
      {stacks.map(({ day, segments }, index) => {
        const x = index * (BAR_WIDTH + BAR_GAP)
        if (!segments) {
          return (
            <rect key={day.date} className="nr-ops-bars__unrecorded" x={x} y={CHART_HEIGHT - 3} width={BAR_WIDTH} height={2}>
              <title>{`${utcDay(day.date)}: not recorded`}</title>
            </rect>
          )
        }
        const heights = segments.map(segment => (segment.value > 0 ? Math.max(MIN_BAR_HEIGHT, (segment.value / busiest) * (CHART_HEIGHT - 2)) : 0))
        const tops = heights.map((_, part) => CHART_HEIGHT - 1 - heights.slice(0, part + 1).reduce((sum, height) => sum + height, 0))
        return (
          <g key={day.date}>
            <title>{`${utcDay(day.date)}: ${describe(segments)}`}</title>
            {segments.map((segment, part) => {
              const height = heights[part] ?? 0
              return height > 0 ? <rect key={segment.label} className={`nr-ops-bars__bar nr-ops-bars__bar--${segment.tone}`} x={x} y={tops[part]} width={BAR_WIDTH} height={height} /> : null
            })}
          </g>
        )
      })}
    </svg>
  )
}

interface TrendProps {
  title: string
  definition: string
  days: readonly OpsDay[]
  segmentsOf: SegmentsOf
  /** Wallets active on several days cannot be added up, so they show their busiest day instead of a total. */
  summary: 'total' | 'busiest'
}

function Trend({ title, definition, days, segmentsOf, summary }: TrendProps) {
  const recorded = days.flatMap(day => {
    const segments = segmentsOf(day)
    return segments ? [{ day, segments }] : []
  })
  const lastDay = days.at(-1)
  const today = lastDay ? segmentsOf(lastDay) : null
  const todayText = today ? describe(today) : 'not recorded'
  return (
    <li className="nr-ops-trend">
      <div className="nr-ops-trend__head">
        <h3>{title}</h3>
        <p className="nr-ops-trend__figures nr-num">
          <span>Today {todayText}</span>
          <span>{summary === 'total' ? windowTotals(recorded.map(entry => entry.segments), days.length) : busiestDay(recorded)}</span>
        </p>
      </div>
      <DayBars days={days} segmentsOf={segmentsOf} label={`${title} per UTC day. Today ${todayText}.`} />
      <p className="nr-ops-definition">{definition}</p>
    </li>
  )
}

function windowTotals(recorded: readonly (readonly BarSegment[])[], windowDays: number): string {
  if (recorded.length === 0) return 'Not recorded yet'
  const sums = new Map<string, BarSegment>()
  for (const segment of recorded.flat()) {
    const sum = sums.get(segment.label)
    sums.set(segment.label, { ...segment, value: (sum?.value ?? 0) + segment.value })
  }
  const span = recorded.length === windowDays ? `${windowDays} days` : `${recorded.length} recorded ${recorded.length === 1 ? 'day' : 'days'}`
  return `${describe([...sums.values()])} over ${span}`
}

function busiestDay(recorded: readonly { day: OpsDay; segments: readonly BarSegment[] }[]): string {
  const busiest = recorded.reduce<{ day: OpsDay; value: number } | null>((best, entry) => {
    const value = total(entry.segments)
    return value > (best?.value ?? 0) ? { day: entry.day, value } : best
  }, null)
  return busiest ? `Busiest ${utcDay(busiest.day.date)} with ${formatCount(busiest.value)}` : 'None this month'
}

const single = (label: string, tone: BarTone, value: number | null): BarSegment[] | null => (value === null ? null : [{ label, value, tone }])

/** Thirty UTC days of activity as small multiples, each on its own scale. */
export function OpsTrends({ report }: { report: OpsReport }) {
  const { days, countingSince } = report
  const first = days[0]
  const partlyRecorded = first !== undefined && (first.runsSubmitted === null || first.shares === null)
  return (
    <section className="nr-section" aria-labelledby="ops-trends">
      <SectionHeader id="ops-trends" title={`Last ${report.windowDays} UTC days`} detail={first ? `From ${utcDay(first.date)}, oldest on the left. Each chart has its own scale.` : undefined} />
      <ul className="nr-ops-trends">
        <Trend title="New linked wallets" definition={DEFINITIONS.newWallets} days={days} summary="total" segmentsOf={day => single('new', 'ink', day.newWallets)} />
        <Trend title="Active wallets" definition={DEFINITIONS.activeWallets} days={days} summary="busiest" segmentsOf={day => single('active', 'ink', day.activeWallets)} />
        <Trend title="Qualified handoffs" definition={DEFINITIONS.dailyHandoffs} days={days} summary="total" segmentsOf={day => single('qualified', 'gold', day.qualifiedHandoffs)} />
        <Trend title="Official Daily attempts" definition={DEFINITIONS.dailyAttempts} days={days} summary="total" segmentsOf={day => single('entered', 'ink', day.dailyAttempts)} />
        <Trend title="Runs submitted" definition={DEFINITIONS.runs} days={days} summary="total" segmentsOf={runSegments} />
        <Trend title="Shares" definition={DEFINITIONS.dailyShares} days={days} summary="total" segmentsOf={day => single('shared', 'ink', day.shares)} />
      </ul>
      {partlyRecorded && (
        <p className="nr-note">
          Run counts started {utcDateTime(countingSince.runs)} and daily share counts {utcDateTime(countingSince.shares)}. Earlier days show a dash on the baseline, not a zero.
        </p>
      )}
    </section>
  )
}

function runSegments(day: OpsDay): BarSegment[] | null {
  if (day.runsVerified === null || day.runsRejected === null || day.runsRefused === null) return null
  return [
    { label: 'verified', value: day.runsVerified, tone: 'cyan' },
    { label: 'rejected', value: day.runsRejected, tone: 'danger' },
    { label: 'refused', value: day.runsRefused, tone: 'mist' },
  ]
}
