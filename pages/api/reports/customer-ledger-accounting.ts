import { withObservability } from '../../../lib/withObservability'
import { ledgerReportRoute } from '../../../lib/ledger-report'

/** One customer's ledger with an opening balance (lib/ledger-report.ts, shared with vendors) - SA-18. */
export default withObservability(ledgerReportRoute('customer'))
