import { withObservability } from '../../../lib/withObservability'
import { ledgerReportRoute } from '../../../lib/ledger-report'

/** One vendor's ledger with an opening balance (lib/ledger-report.ts, shared with customers). */
export default withObservability(ledgerReportRoute('vendor'))
