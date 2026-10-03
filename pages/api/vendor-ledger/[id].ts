import { withObservability } from '../../../lib/withObservability'
import { ledgerNoteRoute } from '../../../lib/api/ledger-note-route'

/** PATCH a vendor ledger row's note. */
export default withObservability(ledgerNoteRoute('vendor_ledger'))
