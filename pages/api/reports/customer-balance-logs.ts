import { withObservability } from '../../../lib/withObservability'
import { balanceLogRoute } from '../../../lib/balance-log-report'

/** A customer's balance-change log, or its counters (lib/balance-log-report.ts, shared). */
export default withObservability(balanceLogRoute('customer'))
