import type { OpsReport } from '@nim-relay/shared'
import { networkLabel } from '../relays/format'
import { playerMessage } from '../shell/errors'
import { useSession } from '../shell/session'
import { Button } from '../shell/ui/Button'
import { EmptyState, Loading, Pill } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { OpsAlerts } from './OpsAlerts'
import { OpsFunnel } from './OpsFunnel'
import { OpsOnboarding } from './OpsOnboarding'
import { OpsFlaggedRuns, OpsNimFlow } from './OpsRecords'
import { OpsTotals } from './OpsTotals'
import { OpsGrants } from '../grants/OpsGrants'
import { OpsTrends } from './OpsTrends'
import { OPS_REFRESH_MS, isOperatorRefusal, useOpsReport } from './use-ops-report'
import './ops.css'

const TITLE = 'Operator report'

function ReportHeader({ report, refreshFailed, onRetry }: { report: OpsReport; refreshFailed: boolean; onRetry: () => void }) {
  const testnet = report.network === 'TestAlbatross'
  const other = networkLabel(testnet ? 'MainAlbatross' : 'TestAlbatross')
  const updated = `${new Date(report.generatedAt).toISOString().slice(11, 19)} UTC`
  return (
    <header className="nr-ops-head">
      <div className="nr-ops-head__status">
        <Pill tone={testnet ? 'neutral' : 'verified'}>{networkLabel(report.network)}</Pill>
        {refreshFailed ? <Pill tone="danger">Refresh failed</Pill> : <Pill tone="live">Live</Pill>}
      </div>
      <p>
        This Worker serves {networkLabel(report.network)} only{testnet ? ', so everything here is test evidence' : ''}. {other} has its own Worker and its own report.
      </p>
      <p className="nr-num">
        {refreshFailed ? `Showing the report from ${updated}. ` : `Updated ${updated}. `}
        Refreshes every {OPS_REFRESH_MS / 1000} seconds while this page is open.
        {refreshFailed && (
          <>
            {' '}
            <button type="button" className="nr-ops-retry" onClick={onRetry}>
              Refresh now
            </button>
          </>
        )}
      </p>
    </header>
  )
}

/** Operators only: signed-out visitors and runners the Worker does not list get the same plain answer. */
export function OpsScreen({ entryKey }: { entryKey: string }) {
  const { player, checking } = useSession()
  const report = useOpsReport(player !== null)

  if (checking) {
    return (
      <Screen title={TITLE} entryKey={entryKey}>
        <Loading label="Checking your session" />
      </Screen>
    )
  }
  if (!player || isOperatorRefusal(report.error)) {
    return (
      <Screen title={TITLE} entryKey={entryKey}>
        <EmptyState title="Operators only" body="This report is for the team that runs NIM Relay." />
      </Screen>
    )
  }
  if (!report.data) {
    return (
      <Screen title={TITLE} entryKey={entryKey}>
        {report.isPending ? (
          <Loading label="Loading the operator report" />
        ) : (
          <EmptyState title="The report didn’t load" body={playerMessage(report.error) ?? 'Try again in a moment.'}>
            <Button variant="secondary" onClick={() => void report.refetch()}>
              Try again
            </Button>
          </EmptyState>
        )}
      </Screen>
    )
  }

  const data = report.data
  return (
    <Screen title={TITLE} entryKey={entryKey}>
      <div className="nr-ops">
        <ReportHeader report={data} refreshFailed={report.isError} onRetry={() => void report.refetch()} />
        <OpsAlerts alerts={data.alerts} />
        <OpsTotals totals={data.totals} />
        <OpsTrends report={data} />
        <OpsFunnel report={data} />
        <OpsOnboarding report={data} />
        <OpsFlaggedRuns report={data} />
        <OpsNimFlow report={data} />
        <OpsGrants />
      </div>
    </Screen>
  )
}
